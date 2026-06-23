from fastapi import APIRouter, Depends

from app.core.responses import success_response
from app.core.security import get_current_business_user
from app.schemas.payment_schema import PaymentRecordRequest, PaymentRefundRequest, PaymentSettingsRequest
from app.services.payment_service import get_payment_settings, list_payment_overview, record_transaction_payment, refund_transaction_payment, update_payment_settings

router = APIRouter(prefix="/tenants/{tenantId}/payments", tags=["payments"])


@router.get("/settings")
async def get_settings(tenantId: str, current_user: dict = Depends(get_current_business_user)):
    data = await get_payment_settings(tenantId, current_user)
    return success_response("Payment settings fetched successfully.", data)


@router.put("/settings")
async def update_settings(tenantId: str, payload: PaymentSettingsRequest, current_user: dict = Depends(get_current_business_user)):
    data = await update_payment_settings(tenantId, payload, current_user)
    return success_response("Payment settings updated successfully.", data)


@router.get("/overview")
async def overview(tenantId: str, page: int = 1, limit: int = 20, current_user: dict = Depends(get_current_business_user)):
    data = await list_payment_overview(tenantId, current_user, page, limit)
    return success_response("Payment overview fetched successfully.", {"settings": data["settings"], "records": data["records"], "outstandingTransactions": data["outstandingTransactions"], "summary": data["summary"]}, data["pagination"])


@router.post("/transactions/{transactionId}/record")
async def record_payment(tenantId: str, transactionId: str, payload: PaymentRecordRequest, current_user: dict = Depends(get_current_business_user)):
    data = await record_transaction_payment(tenantId, transactionId, payload, current_user)
    return success_response("Payment recorded successfully.", data)


@router.post("/transactions/{transactionId}/refund")
async def refund_payment(tenantId: str, transactionId: str, payload: PaymentRefundRequest, current_user: dict = Depends(get_current_business_user)):
    data = await refund_transaction_payment(tenantId, transactionId, payload, current_user)
    return success_response("Refund recorded successfully.", data)
