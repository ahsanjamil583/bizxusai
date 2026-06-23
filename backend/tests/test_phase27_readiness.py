import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


class Phase27ReadinessTests(unittest.TestCase):
    def test_readiness_route_returns_phase27_report(self):
        fake_report = {
            "overallStatus": "ready_with_warnings",
            "totals": {"pass": 7, "warn": 2, "fail": 0},
            "checks": [{"code": "mongodb", "label": "MongoDB connection", "status": "pass", "message": "ok"}],
            "runtime": {"appVersion": "0.27.0", "buildLabel": "phase-27-final-hardening"},
            "services": {},
            "integrations": {},
        }
        with (
            patch("app.main.connect_to_mongo", new=AsyncMock()),
            patch("app.main.close_mongo_connection", new=AsyncMock()),
            patch("app.main.create_indexes", new=AsyncMock()),
            patch("app.main.seed_default_admin", new=AsyncMock()),
            patch("app.main.seed_modules", new=AsyncMock()),
            patch("app.main.seed_business_categories", new=AsyncMock()),
            patch("app.api.v1.health_routes.build_readiness_report", new=AsyncMock(return_value=fake_report)),
        ):
            from app.main import create_app

            app = create_app()
            with TestClient(app) as client:
                response = client.get("/api/v1/health/readiness")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["runtime"]["appVersion"], "0.27.0")
        self.assertIn("X-Request-ID", response.headers)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_demo_accounts_route_is_available_for_demo_setup(self):
        with (
            patch("app.main.connect_to_mongo", new=AsyncMock()),
            patch("app.main.close_mongo_connection", new=AsyncMock()),
            patch("app.main.create_indexes", new=AsyncMock()),
            patch("app.main.seed_default_admin", new=AsyncMock()),
            patch("app.main.seed_modules", new=AsyncMock()),
            patch("app.main.seed_business_categories", new=AsyncMock()),
        ):
            from app.main import create_app

            app = create_app()
            with TestClient(app) as client:
                response = client.get("/api/v1/health/demo-accounts")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data"]["businessSlug"], "demo-bazaar")
