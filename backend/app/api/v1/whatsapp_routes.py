from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import PlainTextResponse

from app.core.responses import success_response
from app.core.security import get_current_business_user
from app.schemas.whatsapp_schema import WhatsAppMockInboundRequest, WhatsAppOutboundRequest, WhatsAppSettingsRequest
from app.services.whatsapp_service import (
    disconnect_whatsapp_settings,
    get_whatsapp_settings_for_owner,
    list_whatsapp_conversations,
    process_whatsapp_webhook_payload,
    send_owner_whatsapp_test,
    simulate_whatsapp_inbound,
    upsert_whatsapp_settings,
    verify_whatsapp_webhook,
)

router = APIRouter(tags=["whatsapp-agent"])


@router.get("/webhooks/whatsapp")
async def whatsapp_webhook_verify(
    mode: str | None = Query(default=None, alias="hub.mode"),
    verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    challenge: str | None = Query(default=None, alias="hub.challenge"),
):
    challenge_text = await verify_whatsapp_webhook(mode, verify_token, challenge)
    return PlainTextResponse(challenge_text)


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook_receive(request: Request):
    payload = await request.json()
    data = await process_whatsapp_webhook_payload(payload)
    return success_response("WhatsApp webhook processed successfully.", data)


@router.get("/tenants/{tenantId}/whatsapp/settings")
async def whatsapp_settings(tenantId: str, current_user: dict = Depends(get_current_business_user)):
    data = await get_whatsapp_settings_for_owner(tenantId, current_user)
    return success_response("WhatsApp settings fetched successfully.", data)


@router.put("/tenants/{tenantId}/whatsapp/settings")
async def save_whatsapp_settings(
    tenantId: str,
    payload: WhatsAppSettingsRequest,
    current_user: dict = Depends(get_current_business_user),
):
    data = await upsert_whatsapp_settings(tenantId, payload, current_user)
    return success_response("WhatsApp agent connected successfully.", data)


@router.post("/tenants/{tenantId}/whatsapp/disconnect")
async def disconnect_whatsapp(tenantId: str, current_user: dict = Depends(get_current_business_user)):
    data = await disconnect_whatsapp_settings(tenantId, current_user)
    return success_response("WhatsApp agent disconnected successfully.", data)


@router.get("/tenants/{tenantId}/whatsapp/conversations")
async def whatsapp_conversations(
    tenantId: str,
    page: int = 1,
    limit: int = 20,
    current_user: dict = Depends(get_current_business_user),
):
    data = await list_whatsapp_conversations(tenantId, current_user, page, limit)
    return success_response("WhatsApp conversations fetched successfully.", data["items"], data["pagination"] | {"tenant": data["tenant"]})


@router.post("/tenants/{tenantId}/whatsapp/mock/inbound")
async def whatsapp_mock_inbound(
    tenantId: str,
    payload: WhatsAppMockInboundRequest,
    current_user: dict = Depends(get_current_business_user),
):
    data = await simulate_whatsapp_inbound(tenantId, payload, current_user)
    return success_response("Mock WhatsApp inbound message processed successfully.", data)


@router.post("/tenants/{tenantId}/whatsapp/send-test")
async def whatsapp_send_test(
    tenantId: str,
    payload: WhatsAppOutboundRequest,
    current_user: dict = Depends(get_current_business_user),
):
    data = await send_owner_whatsapp_test(tenantId, payload, current_user)
    return success_response("WhatsApp test message processed successfully.", data)
