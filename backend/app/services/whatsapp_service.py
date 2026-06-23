from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.module_guard import ensure_tenant_module_enabled, ensure_tenant_module_usage_available
from app.core.object_ids import parse_object_id, serialize_document
from app.core.permissions import get_owned_tenant_or_403
from app.db.mongodb import get_database
from app.integrations.whatsapp.provider import WhatsAppSendError, send_whatsapp_text
from app.schemas.whatsapp_schema import WhatsAppMockInboundRequest, WhatsAppOutboundRequest, WhatsAppSettingsRequest
from app.services.ai_chat_service import build_ai_reply, detect_language_mode, load_conversation_messages, save_message

HANDOFF_REPLY = (
    "I have marked this conversation for owner handoff. The business team can review it from the dashboard."
)


def normalize_phone(value: str | None) -> str:
    phone = re.sub(r"[^0-9+]", "", str(value or "").strip())
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    if phone and not phone.startswith("+"):
        # Pakistan-friendly default for local FYP demos.
        if phone.startswith("0") and len(phone) >= 10:
            phone = "+92" + phone[1:]
        elif phone.startswith("92"):
            phone = "+" + phone
    return phone


def mask_secret(value: str | None) -> str:
    if not value:
        return ""
    value = str(value)
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


def serialize_whatsapp_settings(settings_doc: dict | None, tenant: dict | None = None) -> dict:
    if not settings_doc:
        tenant_contact = (tenant or {}).get("contact") or {}
        business_number = tenant_contact.get("whatsapp") or tenant_contact.get("phone") or ""
        return {
            "id": "",
            "tenantId": str((tenant or {}).get("_id", "")),
            "provider": settings.whatsapp_provider,
            "businessWhatsAppNumber": business_number,
            "normalizedBusinessWhatsAppNumber": normalize_phone(business_number),
            "displayName": (tenant or {}).get("name", ""),
            "phoneNumberId": settings.whatsapp_phone_number_id,
            "apiVersion": settings.whatsapp_api_version,
            "webhookVerifyToken": settings.whatsapp_verify_token,
            "accessTokenMasked": "",
            "isConnected": False,
            "autoReplyEnabled": True,
            "handoffEnabled": True,
            "handoffKeywords": ["human", "agent", "admin", "owner"],
            "welcomeMessage": "Assalam o Alaikum! Main BizXus AI assistant hoon. Aap products, prices, timing ya order ke bare mein pooch sakte hain.",
            "status": "not_configured",
            "lastInboundAt": None,
            "lastOutboundAt": None,
        }
    data = serialize_document(settings_doc)
    data["accessTokenMasked"] = mask_secret(settings_doc.get("accessToken"))
    data.pop("accessToken", None)
    return data


async def _get_tenant_for_whatsapp_owner(tenant_id: str, user: dict) -> tuple[ObjectId, dict]:
    tenant_oid = parse_object_id(tenant_id, "tenantId")
    tenant = await get_owned_tenant_or_403(tenant_oid, user)
    await ensure_tenant_module_enabled(tenant_oid, "whatsapp_agent")
    await ensure_tenant_module_enabled(tenant_oid, "ai_chat")
    return tenant_oid, tenant


async def get_whatsapp_settings_for_owner(tenant_id: str, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    settings_doc = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid})
    return {"tenant": serialize_document(tenant), "settings": serialize_whatsapp_settings(settings_doc, tenant)}


async def upsert_whatsapp_settings(tenant_id: str, payload: WhatsAppSettingsRequest, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    now = datetime.now(timezone.utc)
    existing = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid})
    normalized_number = normalize_phone(payload.businessWhatsAppNumber)
    if not normalized_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid WhatsApp number.")

    webhook_token = existing.get("webhookVerifyToken") if existing else ""
    if not webhook_token:
        webhook_token = secrets.token_urlsafe(24)

    update_doc = {
        "tenantId": tenant_oid,
        "provider": payload.provider,
        "businessWhatsAppNumber": payload.businessWhatsAppNumber,
        "normalizedBusinessWhatsAppNumber": normalized_number,
        "displayName": payload.displayName or tenant.get("name", ""),
        "phoneNumberId": payload.phoneNumberId.strip(),
        "apiVersion": payload.apiVersion.strip() or settings.whatsapp_api_version,
        "webhookVerifyToken": webhook_token,
        "autoReplyEnabled": payload.autoReplyEnabled,
        "handoffEnabled": payload.handoffEnabled,
        "handoffKeywords": [str(word).strip().lower() for word in payload.handoffKeywords if str(word).strip()],
        "welcomeMessage": payload.welcomeMessage.strip(),
        "isConnected": True,
        "status": "connected_mock" if payload.provider == "mock" else "connected_meta_cloud",
        "updatedAt": now,
    }
    if payload.accessToken.strip():
        update_doc["accessToken"] = payload.accessToken.strip()
    elif not existing:
        update_doc["accessToken"] = ""

    await db.whatsapp_integrations.update_one(
        {"tenantId": tenant_oid},
        {"$set": update_doc, "$setOnInsert": {"createdAt": now}},
        upsert=True,
    )
    settings_doc = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid})
    return {"tenant": serialize_document(tenant), "settings": serialize_whatsapp_settings(settings_doc, tenant)}


async def disconnect_whatsapp_settings(tenant_id: str, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    now = datetime.now(timezone.utc)
    await db.whatsapp_integrations.update_one(
        {"tenantId": tenant_oid},
        {"$set": {"isConnected": False, "status": "disconnected", "updatedAt": now}},
    )
    settings_doc = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid})
    return {"tenant": serialize_document(tenant), "settings": serialize_whatsapp_settings(settings_doc, tenant)}


async def find_whatsapp_integration_for_inbound(*, tenant_id: ObjectId | None = None, phone_number_id: str = "", business_number: str = "") -> tuple[dict, dict]:
    db = get_database()
    integration = None
    if tenant_id:
        integration = await db.whatsapp_integrations.find_one({"tenantId": tenant_id, "isConnected": True})
    if not integration and phone_number_id:
        integration = await db.whatsapp_integrations.find_one({"phoneNumberId": phone_number_id, "isConnected": True})
    if not integration and business_number:
        integration = await db.whatsapp_integrations.find_one(
            {"normalizedBusinessWhatsAppNumber": normalize_phone(business_number), "isConnected": True}
        )
    if not integration:
        if not (tenant_id or phone_number_id or business_number):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to map WhatsApp message to a business.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No connected WhatsApp integration matched this message.")
    tenant = await db.tenants.find_one({"_id": integration["tenantId"], "status": "active"})
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connected business is not active.")
    if "ai_chat" not in tenant.get("enabledModuleCodes", []) or "whatsapp_agent" not in tenant.get("enabledModuleCodes", []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="AI Chat and WhatsApp Agent modules must be enabled.")
    return integration, tenant


async def get_or_create_whatsapp_conversation(tenant: dict, customer_phone: str, customer_name: str = "", wa_id: str = "") -> dict:
    db = get_database()
    normalized_phone = normalize_phone(customer_phone)
    now = datetime.now(timezone.utc)
    conversation = await db.conversations.find_one(
        {
            "tenantId": tenant["_id"],
            "channel": "whatsapp",
            "externalCustomerPhone": normalized_phone,
            "status": "open",
        }
    )
    if conversation:
        updates = {"lastMessageAt": now, "updatedAt": now}
        if customer_name and not conversation.get("externalCustomerName"):
            updates["externalCustomerName"] = customer_name
        if wa_id and not conversation.get("waId"):
            updates["waId"] = wa_id
        if len(updates) > 2:
            await db.conversations.update_one({"_id": conversation["_id"]}, {"$set": updates})
            conversation = await db.conversations.find_one({"_id": conversation["_id"]})
        return conversation

    conversation = {
        "tenantId": tenant["_id"],
        "branchId": None,
        "customerId": None,
        "customerUserId": None,
        "channel": "whatsapp",
        "status": "open",
        "externalCustomerPhone": normalized_phone,
        "externalCustomerName": customer_name or "WhatsApp Customer",
        "waId": wa_id or normalized_phone,
        "languageDetected": "english",
        "pendingOrderDraft": {},
        "summary": "",
        "lastIntent": "",
        "lastIntentConfidence": 0.0,
        "lastAssistantSource": "",
        "lastKnowledgeCount": 0,
        "lastMessageAt": now,
        "createdAt": now,
        "updatedAt": now,
    }
    conversation["_id"] = (await db.conversations.insert_one(conversation)).inserted_id
    return conversation


def _needs_handoff(message_text: str, integration: dict) -> bool:
    if not integration.get("handoffEnabled", True):
        return False
    normalized = message_text.lower()
    return any(keyword and keyword in normalized for keyword in integration.get("handoffKeywords", []))


async def _log_inbound_message(
    *,
    tenant_id: ObjectId,
    conversation_id: ObjectId | None,
    customer_phone: str,
    message_text: str,
    provider: str,
    provider_message_id: str = "",
    raw_payload: dict | None = None,
) -> dict:
    db = get_database()
    now = datetime.now(timezone.utc)
    log = {
        "tenantId": tenant_id,
        "conversationId": conversation_id,
        "provider": provider,
        "direction": "inbound",
        "fromPhone": customer_phone,
        "messageText": message_text,
        "providerMessageId": provider_message_id,
        "deliveryStatus": "received",
        "rawPayload": raw_payload or {},
        "createdAt": now,
        "updatedAt": now,
    }
    log["_id"] = (await db.whatsapp_message_logs.insert_one(log)).inserted_id
    return log


async def process_whatsapp_inbound(
    *,
    integration: dict,
    tenant: dict,
    customer_phone: str,
    message_text: str,
    customer_name: str = "",
    provider_message_id: str = "",
    raw_payload: dict | None = None,
) -> dict:
    db = get_database()
    if not message_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WhatsApp message text is empty.")

    await ensure_tenant_module_usage_available(tenant["_id"], "ai_chat")
    await ensure_tenant_module_usage_available(tenant["_id"], "whatsapp_agent")
    conversation = await get_or_create_whatsapp_conversation(tenant, customer_phone, customer_name, wa_id=customer_phone)
    await _log_inbound_message(
        tenant_id=tenant["_id"],
        conversation_id=conversation["_id"],
        customer_phone=customer_phone,
        message_text=message_text,
        provider=integration.get("provider", "mock"),
        provider_message_id=provider_message_id,
        raw_payload=raw_payload,
    )

    language_mode = detect_language_mode(message_text)
    await save_message(conversation, tenant["_id"], "customer", message_text, intent="whatsapp_inbound", confidence=1.0)
    recent_messages = await load_conversation_messages(conversation["_id"])

    if _needs_handoff(message_text, integration):
        ai_text = HANDOFF_REPLY
        draft_order = {}
        rag_sources = []
        tool_calls = [{"tool": "handoff_detector", "handoffRequested": True}]
        reply_meta = {
            "intent": "handoff_requested",
            "confidence": 1.0,
            "responseSource": "handoff_rule",
            "knowledgeCount": 0,
            "localizationScore": 1.0,
        }
        await db.conversations.update_one({"_id": conversation["_id"]}, {"$set": {"status": "handoff", "handoffRequestedAt": datetime.now(timezone.utc)}})
    elif integration.get("autoReplyEnabled", True):
        ai_text, draft_order, rag_sources, tool_calls, reply_meta = await build_ai_reply(tenant, message_text, recent_messages, channel="whatsapp")
    else:
        ai_text = integration.get("welcomeMessage") or "Your message has been received. The business team will reply soon."
        draft_order = {}
        rag_sources = []
        tool_calls = [{"tool": "auto_reply_gate", "autoReplyEnabled": False}]
        reply_meta = {
            "intent": "manual_review",
            "confidence": 1.0,
            "responseSource": "manual_review_rule",
            "knowledgeCount": 0,
            "localizationScore": 1.0,
        }

    now = datetime.now(timezone.utc)
    await db.conversations.update_one(
        {"_id": conversation["_id"]},
        {
            "$set": {
                "languageDetected": language_mode,
                "pendingOrderDraft": draft_order,
                "summary": ai_text,
                "lastIntent": reply_meta["intent"],
                "lastIntentConfidence": reply_meta["confidence"],
                "lastAssistantSource": reply_meta["responseSource"],
                "lastKnowledgeCount": reply_meta["knowledgeCount"],
                "lastLocalizationScore": reply_meta.get("localizationScore", 0),
                "lastMessageAt": now,
                "updatedAt": now,
            }
        },
    )
    conversation = await db.conversations.find_one({"_id": conversation["_id"]})
    await save_message(
        conversation,
        tenant["_id"],
        "ai",
        ai_text,
        intent=reply_meta["intent"],
        confidence=reply_meta["confidence"],
        rag_sources=rag_sources,
        tool_calls=tool_calls,
    )

    outbound_log = None
    outbound_error = ""
    if integration.get("autoReplyEnabled", True):
        try:
            outbound_log = await send_whatsapp_text(
                tenant_id=tenant["_id"],
                conversation_id=conversation["_id"],
                provider=integration.get("provider", "mock"),
                to_phone=normalize_phone(customer_phone),
                message_text=ai_text,
                integration=integration,
                raw_context={"source": "whatsapp_agent_auto_reply"},
            )
            await db.whatsapp_integrations.update_one(
                {"_id": integration["_id"]},
                {"$set": {"lastInboundAt": now, "lastOutboundAt": now, "updatedAt": now}},
            )
        except WhatsAppSendError as exc:
            outbound_error = str(exc)
            await db.whatsapp_integrations.update_one(
                {"_id": integration["_id"]},
                {"$set": {"lastInboundAt": now, "lastError": outbound_error, "updatedAt": now}},
            )
    else:
        await db.whatsapp_integrations.update_one({"_id": integration["_id"]}, {"$set": {"lastInboundAt": now, "updatedAt": now}})

    messages = await load_conversation_messages(conversation["_id"])
    return {
        "tenant": serialize_document(tenant),
        "settings": serialize_whatsapp_settings(integration, tenant),
        "conversation": serialize_document(conversation),
        "messages": messages,
        "reply": ai_text,
        "draftOrder": serialize_document(conversation.get("pendingOrderDraft")) or {},
        "outboundLog": serialize_document(outbound_log) if outbound_log else None,
        "outboundError": outbound_error,
    }


async def simulate_whatsapp_inbound(tenant_id: str, payload: WhatsAppMockInboundRequest, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    integration = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid, "isConnected": True})
    if not integration:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect WhatsApp before testing inbound messages.")
    return await process_whatsapp_inbound(
        integration=integration,
        tenant=tenant,
        customer_phone=payload.customerPhone,
        customer_name=payload.customerName,
        message_text=payload.messageText,
        provider_message_id=payload.providerMessageId or f"mock-in-{int(datetime.now(timezone.utc).timestamp())}",
        raw_payload={"mock": True, "source": "dashboard_simulator"},
    )


async def send_owner_whatsapp_test(tenant_id: str, payload: WhatsAppOutboundRequest, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    integration = await db.whatsapp_integrations.find_one({"tenantId": tenant_oid, "isConnected": True})
    if not integration:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect WhatsApp before sending a test message.")
    try:
        log = await send_whatsapp_text(
            tenant_id=tenant_oid,
            provider=integration.get("provider", "mock"),
            to_phone=normalize_phone(payload.toPhone),
            message_text=payload.messageText,
            integration=integration,
            raw_context={"source": "owner_test_message"},
        )
    except WhatsAppSendError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unable to send WhatsApp test: {exc}") from exc
    return {"tenant": serialize_document(tenant), "log": serialize_document(log)}


async def list_whatsapp_conversations(tenant_id: str, user: dict, page: int = 1, limit: int = 20) -> dict:
    db = get_database()
    tenant_oid, tenant = await _get_tenant_for_whatsapp_owner(tenant_id, user)
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    query = {"tenantId": tenant_oid, "channel": "whatsapp"}
    total = await db.conversations.count_documents(query)
    cursor = db.conversations.find(query).sort("lastMessageAt", -1).skip((page - 1) * limit).limit(limit)
    items = [serialize_document(conversation) async for conversation in cursor]
    return {
        "tenant": serialize_document(tenant),
        "items": items,
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": (total + limit - 1) // limit},
    }


async def verify_whatsapp_webhook(mode: str | None, verify_token: str | None, challenge: str | None) -> str:
    if mode != "subscribe" or not verify_token or challenge is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WhatsApp webhook verification request.")
    db = get_database()
    token_matches_integration = await db.whatsapp_integrations.find_one({"webhookVerifyToken": verify_token, "isConnected": True})
    if verify_token == settings.whatsapp_verify_token or token_matches_integration:
        return str(challenge)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid WhatsApp verify token.")


def _extract_text_from_meta_message(message: dict) -> str:
    message_type = message.get("type")
    if message_type == "text":
        return ((message.get("text") or {}).get("body") or "").strip()
    if message_type == "button":
        return ((message.get("button") or {}).get("text") or "").strip()
    if message_type == "interactive":
        interactive = message.get("interactive") or {}
        if interactive.get("type") == "button_reply":
            return ((interactive.get("button_reply") or {}).get("title") or "").strip()
        if interactive.get("type") == "list_reply":
            return ((interactive.get("list_reply") or {}).get("title") or "").strip()
    return ""


async def process_whatsapp_webhook_payload(payload: dict) -> dict:
    processed: list[dict] = []
    entries = payload.get("entry") or []
    for entry in entries:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = str(metadata.get("phone_number_id") or "")
            display_phone_number = str(metadata.get("display_phone_number") or "")
            contacts_by_wa_id = {
                str(contact.get("wa_id") or contact.get("input") or ""): contact for contact in value.get("contacts") or []
            }
            for message in value.get("messages") or []:
                text = _extract_text_from_meta_message(message)
                if not text:
                    continue
                from_phone = str(message.get("from") or "")
                contact = contacts_by_wa_id.get(from_phone) or {}
                customer_name = ((contact.get("profile") or {}).get("name") or "WhatsApp Customer").strip()
                integration, tenant = await find_whatsapp_integration_for_inbound(
                    phone_number_id=phone_number_id,
                    business_number=display_phone_number,
                )
                result = await process_whatsapp_inbound(
                    integration=integration,
                    tenant=tenant,
                    customer_phone=from_phone,
                    customer_name=customer_name,
                    message_text=text,
                    provider_message_id=str(message.get("id") or ""),
                    raw_payload={"entry": entry, "change": change, "message": message},
                )
                processed.append(
                    {
                        "tenantId": result["tenant"]["id"],
                        "conversationId": result["conversation"]["id"],
                        "customerPhone": normalize_phone(from_phone),
                        "reply": result["reply"],
                    }
                )
    return {"processedCount": len(processed), "items": processed}
