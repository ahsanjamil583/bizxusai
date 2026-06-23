from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.object_ids import parse_object_id, serialize_document
from app.core.permissions import get_owned_tenant_or_403
from app.db.mongodb import get_database
from app.services.module_service import PLAN_ORDER, enable_tenant_module, list_tenant_modules
from app.services.tenant_service import publish_tenant

LAUNCH_PROFILES: dict[str, dict[str, Any]] = {
    "basic_website": {
        "name": "Basic Website Launch",
        "description": "Publish the public website with catalog/items, analytics, and notifications.",
        "targetPlan": "starter",
        "modules": ["items", "website_builder", "analytics", "notifications"],
    },
    "ai_ordering": {
        "name": "AI Ordering Launch",
        "description": "Recommended FYP flow: website, customer portal, AI chat, RAG, payments, reports, and notifications.",
        "targetPlan": "growth",
        "modules": ["items", "customers", "website_builder", "customer_portal", "ai_chat", "analytics", "payments", "notifications"],
    },
    "full_agent_demo": {
        "name": "Full Agent Demo Launch",
        "description": "Supervisor demo flow with WhatsApp agent, owner assistant, reports, payments, and all agent features.",
        "targetPlan": "scale",
        "modules": [
            "items",
            "customers",
            "website_builder",
            "customer_portal",
            "ai_chat",
            "whatsapp_agent",
            "owner_agent",
            "analytics",
            "payments",
            "reports",
            "notifications",
        ],
    },
}


def normalize_launch_profile(profile_code: str | None) -> str:
    code = str(profile_code or "ai_ordering").strip().lower()
    return code if code in LAUNCH_PROFILES else "ai_ordering"


def plan_rank(plan_code: str | None) -> int:
    normalized = str(plan_code or "starter").strip().lower()
    return PLAN_ORDER.index(normalized) if normalized in PLAN_ORDER else 0


def highest_required_plan(current_plan: str | None, target_plan: str | None) -> str:
    current = str(current_plan or "starter").strip().lower()
    target = str(target_plan or "starter").strip().lower()
    current = current if current in PLAN_ORDER else "starter"
    target = target if target in PLAN_ORDER else "starter"
    return current if plan_rank(current) >= plan_rank(target) else target


def _safe_number(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _check(code: str, title: str, completed: bool, description: str, actionLabel: str = "", route: str = "", required: bool = True, meta: dict | None = None) -> dict:
    return {
        "code": code,
        "title": title,
        "description": description,
        "completed": bool(completed),
        "required": bool(required),
        "status": "complete" if completed else ("missing" if required else "optional"),
        "actionLabel": actionLabel,
        "route": route,
        "meta": meta or {},
    }


async def _load_launch_context(tenant_id: str, user: dict) -> tuple[ObjectId, dict, dict, dict]:
    db = get_database()
    tenant_oid = parse_object_id(tenant_id, "tenantId")
    tenant = await get_owned_tenant_or_403(tenant_oid, user)
    category = None
    if tenant.get("businessCategoryId"):
        category = await db.business_categories.find_one({"_id": tenant.get("businessCategoryId")})
    module_state = await list_tenant_modules(tenant_id, user)
    enabled = set((module_state.get("tenant") or {}).get("enabledModuleCodes") or tenant.get("enabledModuleCodes") or [])
    counts = {
        "activeItems": await db.items.count_documents({"tenantId": tenant_oid, "status": "active"}),
        "sellableItems": await db.items.count_documents({"tenantId": tenant_oid, "status": "active", "$or": [{"isSellable": True}, {"isBookable": True}]}),
        "knowledgeDocuments": await db.knowledge_documents.count_documents({"tenantId": tenant_oid, "isActive": True}),
        "customers": await db.customers.count_documents({"tenantId": tenant_oid}),
        "transactions": await db.transactions.count_documents({"tenantId": tenant_oid}),
        "whatsappConnected": await db.whatsapp_integrations.count_documents({"tenantId": tenant_oid, "isConnected": True}),
        "paymentSettings": await db.payment_settings.count_documents({"tenantId": tenant_oid}),
        "reportSettings": await db.report_delivery_settings.count_documents({"tenantId": tenant_oid, "enabled": True}),
    }
    payment_settings = await db.payment_settings.find_one({"tenantId": tenant_oid}) or {}
    counts["localPaymentsEnabled"] = any(
        bool(payment_settings.get(key)) for key in ["codEnabled", "manualEnabled", "jazzCashEnabled", "easyPaisaEnabled"]
    )
    return tenant_oid, tenant, category or {}, {"modules": module_state, "enabled": enabled, "counts": counts}


def _profile_complete(tenant: dict) -> bool:
    contact = tenant.get("contact") or {}
    address = tenant.get("address") or {}
    return all(
        [
            str(tenant.get("name") or "").strip(),
            tenant.get("businessCategoryId"),
            str(tenant.get("description") or "").strip(),
            str(contact.get("phone") or contact.get("email") or "").strip(),
            str(address.get("city") or "").strip(),
            str(address.get("province") or "").strip(),
        ]
    )


def build_launch_checks(tenant: dict, category: dict, enabled_modules: set[str], counts: dict) -> list[dict]:
    contact = tenant.get("contact") or {}
    profile_meta = {
        "hasName": bool(str(tenant.get("name") or "").strip()),
        "hasCategory": bool(tenant.get("businessCategoryId")),
        "hasDescription": bool(str(tenant.get("description") or "").strip()),
        "hasContact": bool(str(contact.get("phone") or contact.get("email") or "").strip()),
    }
    suggested_modules = category.get("suggestedModules") or ["items", "website_builder", "ai_chat", "analytics", "notifications"]
    missing_suggested = [code for code in suggested_modules if code not in enabled_modules]
    website_ready = "website_builder" in enabled_modules and bool((tenant.get("websiteSettings") or {}).get("templateCode"))
    ai_ready = "ai_chat" in enabled_modules and counts.get("knowledgeDocuments", 0) > 0
    ordering_ready = "customer_portal" in enabled_modules and "payments" in enabled_modules and counts.get("sellableItems", 0) > 0

    return [
        _check(
            "business_profile",
            "Business profile is complete",
            _profile_complete(tenant),
            "Add business name, category, phone/email, location, and description so customers and AI understand this business.",
            "Complete profile",
            "/dashboard/business",
            True,
            profile_meta,
        ),
        _check(
            "launch_modules",
            "Recommended launch modules are enabled",
            len(missing_suggested) == 0,
            "Enable the modules suggested for this business category, or use one-click launch profiles.",
            "Enable modules",
            "/dashboard/modules",
            True,
            {"suggestedModules": suggested_modules, "missingModules": missing_suggested},
        ),
        _check(
            "catalog_ready",
            "Catalog or service list is ready",
            counts.get("sellableItems", 0) > 0,
            "Add at least one active sellable/bookable item so customers and the AI can answer product or service requests.",
            "Add/import items",
            "/dashboard/items/import",
            True,
            {"activeItems": counts.get("activeItems", 0), "sellableItems": counts.get("sellableItems", 0)},
        ),
        _check(
            "website_ready",
            "Website builder is ready",
            website_ready,
            "Website settings and template are generated. This must be ready before publishing the public business site.",
            "Open website builder",
            "/dashboard/public-website",
            True,
            {"websiteStatus": tenant.get("websiteStatus", "not_generated"), "templateCode": (tenant.get("websiteSettings") or {}).get("templateCode", "")},
        ),
        _check(
            "ai_rag_ready",
            "AI + RAG has business knowledge",
            ai_ready,
            "Enable AI Chat and add at least one knowledge document so customer, public, and WhatsApp agents reply with grounded business information.",
            "Add knowledge",
            "/dashboard/knowledge-base",
            True,
            {"knowledgeDocuments": counts.get("knowledgeDocuments", 0), "aiEnabled": "ai_chat" in enabled_modules},
        ),
        _check(
            "ordering_ready",
            "Customer ordering flow is ready",
            ordering_ready,
            "Customer portal, sellable items, and payments should be ready before customers place orders through chat or checkout.",
            "Review payments",
            "/dashboard/payments",
            True,
            {"customerPortalEnabled": "customer_portal" in enabled_modules, "paymentsEnabled": "payments" in enabled_modules},
        ),
        _check(
            "whatsapp_ready",
            "WhatsApp agent is connected",
            "whatsapp_agent" in enabled_modules and counts.get("whatsappConnected", 0) > 0,
            "Connect the owner's WhatsApp number so BizXus AI can handle the customer queries that were previously handled manually.",
            "Connect WhatsApp",
            "/dashboard/whatsapp-agent",
            False,
            {"whatsappEnabled": "whatsapp_agent" in enabled_modules, "connectedIntegrations": counts.get("whatsappConnected", 0)},
        ),
        _check(
            "daily_reports_ready",
            "Daily owner reports are scheduled",
            "reports" in enabled_modules and counts.get("reportSettings", 0) > 0,
            "Configure daily WhatsApp/SMS report delivery for owner summaries, low stock, top items, and order updates.",
            "Configure reports",
            "/dashboard/reports",
            False,
            {"reportsEnabled": "reports" in enabled_modules, "reportSettings": counts.get("reportSettings", 0)},
        ),
    ]


def summarize_launch_status(checks: list[dict], tenant: dict, profile_code: str = "ai_ordering") -> dict:
    required = [check for check in checks if check.get("required")]
    completed_required = [check for check in required if check.get("completed")]
    optional = [check for check in checks if not check.get("required")]
    completed_optional = [check for check in optional if check.get("completed")]
    required_percent = round((len(completed_required) / max(len(required), 1)) * 100)
    overall_percent = round(((len(completed_required) + len(completed_optional)) / max(len(checks), 1)) * 100)
    can_publish = len(completed_required) == len(required)
    return {
        "profileCode": profile_code,
        "requiredPercent": required_percent,
        "overallPercent": overall_percent,
        "requiredComplete": len(completed_required),
        "requiredTotal": len(required),
        "optionalComplete": len(completed_optional),
        "optionalTotal": len(optional),
        "canPublish": can_publish,
        "websiteStatus": tenant.get("websiteStatus", "not_generated"),
        "tenantStatus": tenant.get("status", "draft"),
        "status": "published" if tenant.get("websiteStatus") == "published" else ("ready_to_publish" if can_publish else "needs_setup"),
    }


async def get_launch_status(tenant_id: str, user: dict) -> dict:
    _, tenant, category, context = await _load_launch_context(tenant_id, user)
    checks = build_launch_checks(tenant, category, context["enabled"], context["counts"])
    return {
        "tenant": serialize_document(tenant),
        "category": serialize_document(category) if category else {},
        "profiles": LAUNCH_PROFILES,
        "checks": checks,
        "summary": summarize_launch_status(checks, tenant),
        "counts": context["counts"],
        "modules": context["modules"],
    }


async def _set_tenant_plan(tenant_oid: ObjectId, plan_code: str, user: dict) -> None:
    db = get_database()
    tenant = await db.tenants.find_one({"_id": tenant_oid})
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    settings = dict(tenant.get("settings") or {})
    settings["planCode"] = plan_code
    await db.tenants.update_one(
        {"_id": tenant_oid},
        {"$set": {"settings": settings, "updatedAt": datetime.now(timezone.utc)}},
    )
    await db.audit_logs.insert_one(
        {
            "action": "tenant_launch_plan_updated",
            "actorUserId": user.get("_id"),
            "tenantId": tenant_oid,
            "metadata": {"planCode": plan_code},
            "createdAt": datetime.now(timezone.utc),
        }
    )


async def apply_launch_profile(tenant_id: str, payload, user: dict) -> dict:
    db = get_database()
    tenant_oid, tenant, category, context = await _load_launch_context(tenant_id, user)
    profile_code = normalize_launch_profile(payload.profileCode)
    profile = LAUNCH_PROFILES[profile_code]
    current_plan = ((tenant.get("settings") or {}).get("planCode") or "starter")
    target_plan = highest_required_plan(current_plan, profile.get("targetPlan"))

    if target_plan != current_plan:
        if not payload.autoUpgradePlan:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"This launch profile needs the {target_plan} plan. Enable autoUpgradePlan or choose a smaller profile.",
            )
        await _set_tenant_plan(tenant_oid, target_plan, user)

    enabled_before = set(context["enabled"])
    enabled_now = []
    skipped = []
    errors = []
    for module_code in profile["modules"]:
        if module_code in enabled_before:
            continue
        try:
            await enable_tenant_module(tenant_id, module_code, user)
            enabled_now.append(module_code)
            enabled_before.add(module_code)
        except HTTPException as exc:
            skipped.append(module_code)
            errors.append({"moduleCode": module_code, "detail": exc.detail, "statusCode": exc.status_code})

    await db.tenants.update_one(
        {"_id": tenant_oid},
        {
            "$set": {
                "settings.onboarding.phase28": {
                    "profileCode": profile_code,
                    "profileName": profile["name"],
                    "targetPlan": target_plan,
                    "lastAppliedAt": datetime.now(timezone.utc).isoformat(),
                    "enabledModules": enabled_now,
                    "skippedModules": skipped,
                },
                "updatedAt": datetime.now(timezone.utc),
            }
        },
    )
    await db.audit_logs.insert_one(
        {
            "action": "tenant_launch_profile_applied",
            "actorUserId": user.get("_id"),
            "tenantId": tenant_oid,
            "metadata": {"profileCode": profile_code, "targetPlan": target_plan, "enabledModules": enabled_now, "skippedModules": skipped},
            "createdAt": datetime.now(timezone.utc),
        }
    )
    status_report = await get_launch_status(tenant_id, user)
    status_report["appliedProfile"] = {
        "code": profile_code,
        "name": profile["name"],
        "targetPlan": target_plan,
        "enabledModules": enabled_now,
        "skippedModules": skipped,
        "errors": errors,
    }
    return status_report


async def finalize_launch(tenant_id: str, payload, user: dict) -> dict:
    status_report = await get_launch_status(tenant_id, user)
    blocking_checks = [check for check in status_report["checks"] if check.get("required") and not check.get("completed")]
    if blocking_checks and not payload.allowWarnings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete the required launch checklist before finalizing.",
        )

    published_tenant = status_report["tenant"]
    publish_error = None
    if payload.publishWebsite:
        try:
            published_tenant = await publish_tenant(tenant_id, user)
        except HTTPException as exc:
            publish_error = {"statusCode": exc.status_code, "detail": exc.detail}
            if not payload.allowWarnings:
                raise

    db = get_database()
    tenant_oid = parse_object_id(tenant_id, "tenantId")
    await db.tenants.update_one(
        {"_id": tenant_oid},
        {
            "$set": {
                "settings.onboarding.phase28.finalizedAt": datetime.now(timezone.utc).isoformat(),
                "settings.onboarding.phase28.finalizeStatus": "published" if not publish_error and payload.publishWebsite else "saved_with_warnings",
                "updatedAt": datetime.now(timezone.utc),
            }
        },
    )
    next_report = await get_launch_status(tenant_id, user)
    next_report["finalized"] = {
        "publishRequested": payload.publishWebsite,
        "publishError": publish_error,
        "blockingChecks": blocking_checks,
        "tenant": published_tenant,
    }
    return next_report
