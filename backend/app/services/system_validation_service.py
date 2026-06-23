from __future__ import annotations

from pathlib import Path
from typing import Any

from app.ai.rag.chroma_client import chroma_client
from app.core.config import settings
from app.db.mongodb import get_mongo_status


SAFE_PROVIDER_VALUES = {"mock", "meta", "http", "local", "imagekit", "disabled", ""}


def _mask_secret(value: str) -> str:
    if not value:
        return "not_set"
    if len(value) <= 8:
        return "set"
    return f"set:{value[:3]}...{value[-3:]}"


def _directory_status(path_value: str) -> dict[str, Any]:
    path = Path(path_value)
    try:
        path.mkdir(parents=True, exist_ok=True)
        test_file = path / ".bizxus_write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink(missing_ok=True)
        writable = True
    except Exception as exc:
        writable = False
        return {"path": str(path), "exists": path.exists(), "writable": writable, "error": str(exc)}
    return {"path": str(path), "exists": path.exists(), "writable": writable}


async def build_readiness_report() -> dict[str, Any]:
    mongo = await get_mongo_status()
    chroma = chroma_client.status()
    upload_dir = _directory_status(settings.local_upload_dir)
    temp_dir = _directory_status(settings.temp_upload_dir)
    log_dir = _directory_status(settings.log_dir)

    checks = [
        {
            "code": "mongodb",
            "label": "MongoDB connection",
            "status": "pass" if mongo.get("connected") else "warn",
            "message": "MongoDB is reachable." if mongo.get("connected") else "MongoDB is not reachable. Start MongoDB before using database-backed features.",
        },
        {
            "code": "chroma",
            "label": "Chroma / RAG vector store",
            "status": "pass" if chroma.get("connected") or chroma.get("mode") == "persistent" else "warn",
            "message": f"Chroma status: {chroma.get('mode', 'unknown')}.",
        },
        {
            "code": "jwt_secret",
            "label": "JWT secret",
            "status": "fail" if settings.app_env == "production" and settings.jwt_secret_key in {"", "change-this-secret", "changeme", "secret"} else "pass",
            "message": "JWT secret is configured." if settings.jwt_secret_key not in {"", "change-this-secret", "changeme", "secret"} else "Use a strong JWT_SECRET_KEY before production.",
        },
        {
            "code": "debug_mode",
            "label": "Debug mode",
            "status": "fail" if settings.app_env == "production" and settings.debug else "pass",
            "message": "Debug mode is disabled for production." if not settings.debug else "DEBUG=true is acceptable for local development only.",
        },
        {
            "code": "uploads",
            "label": "Upload directories",
            "status": "pass" if upload_dir.get("writable") and temp_dir.get("writable") else "fail",
            "message": "Upload directories are writable." if upload_dir.get("writable") and temp_dir.get("writable") else "Upload directory is not writable.",
        },
        {
            "code": "logging",
            "label": "Log directory",
            "status": "pass" if log_dir.get("writable") else "warn",
            "message": "Log directory is writable." if log_dir.get("writable") else "Log directory could not be written.",
        },
        {
            "code": "whatsapp_provider",
            "label": "WhatsApp provider",
            "status": "pass" if settings.whatsapp_provider in SAFE_PROVIDER_VALUES else "warn",
            "message": f"WhatsApp provider: {settings.whatsapp_provider or 'not configured'}.",
        },
        {
            "code": "sms_provider",
            "label": "SMS provider",
            "status": "pass" if settings.sms_provider in SAFE_PROVIDER_VALUES else "warn",
            "message": f"SMS provider: {settings.sms_provider or 'not configured'}.",
        },

        {
            "code": "otp_settings",
            "label": "Phone OTP auth",
            "status": "pass" if settings.otp_code_length >= 4 and settings.otp_expire_minutes >= 1 else "fail",
            "message": f"OTP enabled with {settings.otp_code_length}-digit codes and {settings.otp_expire_minutes} minute expiry.",
        },
        {
            "code": "rate_limit",
            "label": "Rate limiting",
            "status": "pass" if settings.rate_limit_enabled else "warn",
            "message": "Basic API rate limiting is enabled." if settings.rate_limit_enabled else "Rate limiting is disabled. Enable it or use gateway rate limiting before public deployment.",
        },
    ]

    totals = {
        "pass": sum(1 for check in checks if check["status"] == "pass"),
        "warn": sum(1 for check in checks if check["status"] == "warn"),
        "fail": sum(1 for check in checks if check["status"] == "fail"),
    }
    if totals["fail"]:
        overall = "not_ready"
    elif totals["warn"]:
        overall = "ready_with_warnings"
    else:
        overall = "ready"

    return {
        "overallStatus": overall,
        "totals": totals,
        "checks": checks,
        "runtime": {
            "appName": settings.app_name,
            "appVersion": settings.app_version,
            "buildLabel": settings.build_label,
            "environment": settings.app_env,
            "debug": settings.debug,
            "apiPrefix": settings.api_v1_prefix,
        },
        "services": {
            "mongodb": mongo,
            "chroma": chroma,
            "uploads": upload_dir,
            "tempUploads": temp_dir,
            "logs": log_dir,
        },
        "integrations": {
            "whatsapp": {
                "provider": settings.whatsapp_provider,
                "phoneNumberId": _mask_secret(settings.whatsapp_phone_number_id),
                "accessToken": _mask_secret(settings.whatsapp_access_token),
            },
            "sms": {
                "provider": settings.sms_provider,
                "apiKey": _mask_secret(settings.sms_api_key),
                "httpUrl": "set" if settings.sms_http_url else "not_set",
                "senderId": settings.sms_sender_id,
            },
            "otp": {
                "codeLength": settings.otp_code_length,
                "expireMinutes": settings.otp_expire_minutes,
                "maxAttempts": settings.otp_max_attempts,
                "returnCodeInResponse": settings.otp_return_code_in_response and settings.app_env != "production",
            },
            "ai": {
                "openaiKey": _mask_secret(settings.openai_api_key),
                "groqKey": _mask_secret(settings.groq_api_key),
                "model": settings.groq_model or settings.openai_model,
                "embeddingModel": settings.openai_embedding_model,
            },
        },
    }


def build_demo_accounts() -> dict[str, Any]:
    return {
        "businessOwner": {
            "email": "owner@bizxus.demo",
            "phone": "03000000001",
            "password": "Demo@12345",
            "demoOtp": settings.otp_demo_code,
            "loginPath": "/login",
        },
        "customer": {
            "email": "customer@bizxus.demo",
            "phone": "03000000002",
            "password": "Demo@12345",
            "demoOtp": settings.otp_demo_code,
            "loginPath": "/customer/login",
        },
        "admin": {
            "email": "admin@bizxus.demo",
            "password": "Admin@12345",
            "loginPath": "/login",
            "note": "Created only when the demo seed script is run.",
        },
        "businessSlug": "demo-bazaar",
    }
