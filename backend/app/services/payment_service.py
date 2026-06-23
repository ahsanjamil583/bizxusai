from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.module_guard import ensure_tenant_module_enabled
from app.core.object_ids import parse_object_id, serialize_document
from app.core.permissions import get_owned_tenant_or_403
from app.db.mongodb import get_database
from app.services.business_notification_service import create_business_notification
from app.services.customer_notification_service import create_customer_notification
from app.services.transaction_workflow_service import get_allowed_payment_statuses

PAYMENT_METHODS = {"cod", "manual", "jazzcash", "easypaisa", "bank_transfer"}
PAYMENT_RECORD_STATUSES = {"pending", "completed", "failed", "refunded"}
PAYABLE_TRANSACTION_TYPES = {"order", "booking_request", "quote_request"}


def _default_settings(tenant_id: ObjectId, actor_user_id: ObjectId | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "tenantId": tenant_id,
        "codEnabled": True,
        "manualEnabled": True,
        "jazzCashEnabled": False,
        "easyPaisaEnabled": False,
        "jazzCashNumber": "",
        "easyPaisaNumber": "",
        "bankAccountTitle": "",
        "bankAccountNumber": "",
        "defaultMethod": "cod",
        "customerInstructions": "Cash on delivery and manual payments are available. The business owner will verify payment before completion.",
        "createdBy": actor_user_id,
        "createdAt": now,
        "updatedAt": now,
    }


def _normalize_method(method: str | None) -> str:
    normalized = str(method or "cod").strip().lower().replace(" ", "_")
    if normalized not in PAYMENT_METHODS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid payment method.")
    return normalized


def _normalize_record_status(value: str | None) -> str:
    normalized = str(value or "completed").strip().lower()
    if normalized not in PAYMENT_RECORD_STATUSES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid payment record status.")
    return normalized


async def _ensure_payment_access(tenant_id: str, user: dict) -> tuple[ObjectId, dict]:
    tenant_oid = parse_object_id(tenant_id, "tenantId")
    tenant = await get_owned_tenant_or_403(tenant_oid, user)
    await ensure_tenant_module_enabled(tenant_oid, "payments")
    return tenant_oid, tenant


async def get_payment_settings(tenant_id: str, user: dict) -> dict:
    db = get_database()
    tenant_oid, _ = await _ensure_payment_access(tenant_id, user)
    settings = await db.payment_settings.find_one({"tenantId": tenant_oid})
    if not settings:
        settings = _default_settings(tenant_oid, user.get("_id"))
        settings["_id"] = (await db.payment_settings.insert_one(settings)).inserted_id
    return serialize_document(settings)


async def update_payment_settings(tenant_id: str, payload, user: dict) -> dict:
    db = get_database()
    tenant_oid, _ = await _ensure_payment_access(tenant_id, user)
    default_method = _normalize_method(payload.defaultMethod)
    update = {
        "codEnabled": bool(payload.codEnabled),
        "manualEnabled": bool(payload.manualEnabled),
        "jazzCashEnabled": bool(payload.jazzCashEnabled),
        "easyPaisaEnabled": bool(payload.easyPaisaEnabled),
        "jazzCashNumber": payload.jazzCashNumber.strip(),
        "easyPaisaNumber": payload.easyPaisaNumber.strip(),
        "bankAccountTitle": payload.bankAccountTitle.strip(),
        "bankAccountNumber": payload.bankAccountNumber.strip(),
        "defaultMethod": default_method,
        "customerInstructions": payload.customerInstructions.strip(),
        "updatedAt": datetime.now(timezone.utc),
        "updatedBy": user.get("_id"),
    }
    if default_method == "jazzcash" and not update["jazzCashEnabled"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enable JazzCash before setting it as default.")
    if default_method == "easypaisa" and not update["easyPaisaEnabled"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enable EasyPaisa before setting it as default.")
    if default_method == "cod" and not update["codEnabled"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enable COD before setting it as default.")
    if default_method in {"manual", "bank_transfer"} and not update["manualEnabled"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enable manual payment before setting it as default.")

    await db.payment_settings.update_one(
        {"tenantId": tenant_oid},
        {"$set": update, "$setOnInsert": {"tenantId": tenant_oid, "createdAt": datetime.now(timezone.utc), "createdBy": user.get("_id")}},
        upsert=True,
    )
    settings = await db.payment_settings.find_one({"tenantId": tenant_oid})
    return serialize_document(settings)


async def _get_transaction_or_404(tenant_oid: ObjectId, transaction_id: str) -> dict:
    db = get_database()
    transaction_oid = parse_object_id(transaction_id, "transactionId")
    transaction = await db.transactions.find_one({"_id": transaction_oid, "tenantId": tenant_oid})
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    if transaction.get("transactionType") not in PAYABLE_TRANSACTION_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This transaction type cannot accept payments.")
    if "not_applicable" in get_allowed_payment_statuses(transaction.get("transactionType", "order")) and transaction.get("paymentStatus") == "not_applicable":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payment is not applicable for this transaction.")
    return transaction


async def _calculate_payment_summary(tenant_oid: ObjectId, transaction: dict) -> dict[str, float]:
    db = get_database()
    transaction_id = transaction["_id"]
    records = await db.payment_records.find({"tenantId": tenant_oid, "transactionId": transaction_id}).to_list(length=None)
    paid = sum(float(row.get("amount", 0) or 0) for row in records if row.get("recordType") == "payment" and row.get("status") == "completed")
    pending = sum(float(row.get("amount", 0) or 0) for row in records if row.get("recordType") == "payment" and row.get("status") == "pending")
    refunded = sum(float(row.get("amount", 0) or 0) for row in records if row.get("recordType") == "refund" or row.get("status") == "refunded")
    total = float(((transaction.get("pricing") or {}).get("total")) or 0)
    net_paid = max(0.0, paid - refunded)
    balance = max(0.0, total - net_paid)
    return {"total": total, "paid": net_paid, "pending": pending, "refunded": refunded, "balance": balance}


def _payment_status_from_summary(transaction: dict, summary: dict[str, float]) -> str:
    if transaction.get("transactionType") == "quote_request" and transaction.get("status") != "approved":
        return transaction.get("paymentStatus", "awaiting_quote")
    if summary["refunded"] > 0 and summary["paid"] <= 0:
        return "refunded"
    if summary["paid"] >= summary["total"] and summary["total"] > 0:
        return "paid"
    if summary["paid"] > 0:
        return "partially_paid"
    return "unpaid"


async def _sync_transaction_payment_status(tenant_oid: ObjectId, transaction: dict, actor_user_id: ObjectId | None, note: str) -> dict:
    db = get_database()
    summary = await _calculate_payment_summary(tenant_oid, transaction)
    payment_status = _payment_status_from_summary(transaction, summary)
    now = datetime.now(timezone.utc)
    history = {
        "field": "paymentStatus",
        "from": transaction.get("paymentStatus"),
        "to": payment_status,
        "note": note,
        "changedAt": now,
        "changedByUserId": actor_user_id,
    }
    update = {"paymentSummary": summary, "paymentStatus": payment_status, "updatedAt": now}
    update_doc = {"$set": update}
    if payment_status != transaction.get("paymentStatus"):
        update_doc["$push"] = {"statusHistory": history}
    await db.transactions.update_one({"_id": transaction["_id"]}, update_doc)
    return await db.transactions.find_one({"_id": transaction["_id"]})


async def list_payment_overview(tenant_id: str, user: dict, page: int = 1, limit: int = 20) -> dict:
    db = get_database()
    tenant_oid, _ = await _ensure_payment_access(tenant_id, user)
    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    settings = await get_payment_settings(tenant_id, user)

    payment_query = {"tenantId": tenant_oid}
    total_records = await db.payment_records.count_documents(payment_query)
    records_cursor = db.payment_records.find(payment_query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    records = [serialize_document(row) async for row in records_cursor]

    outstanding_cursor = db.transactions.find(
        {
            "tenantId": tenant_oid,
            "transactionType": {"$in": ["order", "booking_request"]},
            "status": {"$ne": "cancelled"},
            "paymentStatus": {"$in": ["unpaid", "partially_paid"]},
        }
    ).sort("createdAt", -1).limit(25)
    outstanding = [serialize_document(row) async for row in outstanding_cursor]

    completed_records = await db.payment_records.find({"tenantId": tenant_oid, "recordType": "payment", "status": "completed"}).to_list(length=None)
    refunded_records = await db.payment_records.find({"tenantId": tenant_oid, "$or": [{"recordType": "refund"}, {"status": "refunded"}]}).to_list(length=None)
    summary = {
        "received": sum(float(row.get("amount", 0) or 0) for row in completed_records),
        "refunded": sum(float(row.get("amount", 0) or 0) for row in refunded_records),
        "outstandingTransactions": len(outstanding),
        "totalRecords": total_records,
    }
    summary["netReceived"] = max(0.0, summary["received"] - summary["refunded"])

    return {
        "settings": settings,
        "records": records,
        "outstandingTransactions": outstanding,
        "summary": summary,
        "pagination": {"page": page, "limit": limit, "total": total_records, "totalPages": (total_records + limit - 1) // limit},
    }


async def record_transaction_payment(tenant_id: str, transaction_id: str, payload, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _ensure_payment_access(tenant_id, user)
    transaction = await _get_transaction_or_404(tenant_oid, transaction_id)
    method = _normalize_method(payload.method)
    record_status = _normalize_record_status(payload.status)
    settings = await get_payment_settings(tenant_id, user)
    if method == "cod" and not settings.get("codEnabled"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="COD is disabled for this business.")
    if method in {"manual", "bank_transfer"} and not settings.get("manualEnabled"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Manual payments are disabled for this business.")
    if method == "jazzcash" and not settings.get("jazzCashEnabled"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="JazzCash is disabled for this business.")
    if method == "easypaisa" and not settings.get("easyPaisaEnabled"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="EasyPaisa is disabled for this business.")

    current_summary = await _calculate_payment_summary(tenant_oid, transaction)
    if record_status == "completed" and payload.amount > current_summary["balance"] + 0.01:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payment amount cannot exceed the remaining balance.")

    now = datetime.now(timezone.utc)
    record = {
        "tenantId": tenant_oid,
        "transactionId": transaction["_id"],
        "transactionNumber": transaction.get("transactionNumber", ""),
        "customerSnapshot": transaction.get("customerSnapshot", {}),
        "recordType": "payment",
        "amount": float(payload.amount),
        "currency": ((transaction.get("items") or [{}])[0].get("currency")) or "PKR",
        "method": method,
        "status": record_status,
        "referenceNumber": payload.referenceNumber.strip(),
        "notes": payload.notes.strip(),
        "createdBy": user.get("_id"),
        "createdAt": now,
        "updatedAt": now,
    }
    record["_id"] = (await db.payment_records.insert_one(record)).inserted_id
    updated_transaction = await _sync_transaction_payment_status(tenant_oid, transaction, user.get("_id"), f"Payment recorded through {method}.")

    await create_business_notification(
        tenant_oid,
        "payment_recorded",
        f"Payment recorded for {transaction.get('transactionNumber', 'transaction')}",
        f"{float(payload.amount):g} recorded through {method} for {transaction.get('transactionNumber', 'transaction')}.",
        priority="medium",
        metadata={"transactionId": str(transaction["_id"]), "paymentRecordId": str(record["_id"]), "tenantSlug": tenant.get("slug", "")},
    )
    if updated_transaction.get("customerUserId") and record_status == "completed":
        await create_customer_notification(
            updated_transaction["customerUserId"],
            tenant_oid,
            "payment_updated",
            f"Payment recorded for {updated_transaction.get('transactionNumber', 'order')}",
            f"Your payment of {float(payload.amount):g} was recorded by {tenant.get('name', 'the business')}.",
            {"transactionId": str(updated_transaction["_id"]), "tenantSlug": tenant.get("slug", "")},
        )

    return {"payment": serialize_document(record), "transaction": serialize_document(updated_transaction)}


async def refund_transaction_payment(tenant_id: str, transaction_id: str, payload, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant = await _ensure_payment_access(tenant_id, user)
    transaction = await _get_transaction_or_404(tenant_oid, transaction_id)
    method = _normalize_method(payload.method)
    current_summary = await _calculate_payment_summary(tenant_oid, transaction)
    if payload.amount > current_summary["paid"] + 0.01:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Refund amount cannot exceed paid amount.")

    now = datetime.now(timezone.utc)
    record = {
        "tenantId": tenant_oid,
        "transactionId": transaction["_id"],
        "transactionNumber": transaction.get("transactionNumber", ""),
        "customerSnapshot": transaction.get("customerSnapshot", {}),
        "recordType": "refund",
        "amount": float(payload.amount),
        "currency": ((transaction.get("items") or [{}])[0].get("currency")) or "PKR",
        "method": method,
        "status": "refunded",
        "referenceNumber": payload.referenceNumber.strip(),
        "notes": payload.notes.strip(),
        "createdBy": user.get("_id"),
        "createdAt": now,
        "updatedAt": now,
    }
    record["_id"] = (await db.payment_records.insert_one(record)).inserted_id
    updated_transaction = await _sync_transaction_payment_status(tenant_oid, transaction, user.get("_id"), f"Refund recorded through {method}.")
    await create_business_notification(
        tenant_oid,
        "payment_refunded",
        f"Refund recorded for {transaction.get('transactionNumber', 'transaction')}",
        f"{float(payload.amount):g} refunded through {method} for {transaction.get('transactionNumber', 'transaction')}.",
        priority="medium",
        metadata={"transactionId": str(transaction["_id"]), "paymentRecordId": str(record["_id"]), "tenantSlug": tenant.get("slug", "")},
    )
    return {"payment": serialize_document(record), "transaction": serialize_document(updated_transaction)}
