from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.config import settings
from app.db.mongodb import get_database


class WhatsAppSendError(Exception):
    """Raised when a WhatsApp provider cannot deliver an outbound message."""


def _normalize_provider(provider: str | None) -> str:
    normalized = str(provider or settings.whatsapp_provider or "mock").strip().lower()
    return normalized if normalized in {"mock", "meta_cloud"} else "mock"


async def send_whatsapp_text(
    *,
    tenant_id,
    conversation_id=None,
    provider: str | None = None,
    to_phone: str,
    message_text: str,
    integration: dict | None = None,
    raw_context: dict | None = None,
) -> dict:
    """Send a WhatsApp text message.

    The mock provider stores a delivery log only. The Meta Cloud branch is intentionally
    lightweight so the project can run as an FYP without a paid WhatsApp setup, while
    still being ready for real credentials later.
    """
    db = get_database()
    normalized_provider = _normalize_provider(provider)
    now = datetime.now(timezone.utc)
    log = {
        "tenantId": tenant_id,
        "conversationId": conversation_id,
        "provider": normalized_provider,
        "direction": "outbound",
        "toPhone": to_phone,
        "messageText": message_text,
        "deliveryStatus": "queued",
        "rawContext": raw_context or {},
        "createdAt": now,
        "updatedAt": now,
    }

    if normalized_provider == "mock":
        log.update(
            {
                "deliveryStatus": "mock_sent",
                "providerMessageId": f"mock-{int(now.timestamp())}",
                "providerResponse": {"mock": True, "note": "Message was logged locally instead of sent to WhatsApp."},
            }
        )
        log["_id"] = (await db.whatsapp_message_logs.insert_one(log)).inserted_id
        return log

    access_token = (integration or {}).get("accessToken") or settings.whatsapp_access_token
    phone_number_id = (integration or {}).get("phoneNumberId") or settings.whatsapp_phone_number_id
    api_version = (integration or {}).get("apiVersion") or settings.whatsapp_api_version
    if not access_token or not phone_number_id:
        log.update(
            {
                "deliveryStatus": "failed",
                "error": "Missing Meta WhatsApp access token or phone number ID.",
            }
        )
        log["_id"] = (await db.whatsapp_message_logs.insert_one(log)).inserted_id
        raise WhatsAppSendError(log["error"])

    endpoint = f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {"preview_url": False, "body": message_text[:3900]},
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(endpoint, headers={"Authorization": f"Bearer {access_token}"}, json=payload)
            response.raise_for_status()
            provider_response = response.json()
        provider_message_id = None
        messages = provider_response.get("messages") if isinstance(provider_response, dict) else None
        if messages:
            provider_message_id = messages[0].get("id")
        log.update(
            {
                "deliveryStatus": "sent",
                "providerMessageId": provider_message_id,
                "providerResponse": provider_response,
            }
        )
        log["_id"] = (await db.whatsapp_message_logs.insert_one(log)).inserted_id
        return log
    except Exception as exc:
        log.update({"deliveryStatus": "failed", "error": str(exc)})
        log["_id"] = (await db.whatsapp_message_logs.insert_one(log)).inserted_id
        raise WhatsAppSendError(str(exc)) from exc
