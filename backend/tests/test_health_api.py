import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


class HealthApiTests(unittest.TestCase):
    def test_health_route_returns_service_status(self):
        with (
            patch("app.main.connect_to_mongo", new=AsyncMock()),
            patch("app.main.close_mongo_connection", new=AsyncMock()),
            patch("app.main.create_indexes", new=AsyncMock()),
            patch("app.main.seed_default_admin", new=AsyncMock()),
            patch("app.main.seed_modules", new=AsyncMock()),
            patch("app.main.seed_business_categories", new=AsyncMock()),
            patch("app.api.v1.health_routes.get_mongo_status", new=AsyncMock(return_value={"configured": True, "connected": True})),
            patch("app.api.v1.health_routes.chroma_client.status", return_value={"configured": True, "connected": True, "mode": "persistent"}),
        ):
            from app.main import create_app

            app = create_app()
            with TestClient(app) as client:
                response = client.get("/api/v1/health")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["mongodb"]["connected"], True)
        self.assertEqual(payload["data"]["chroma"]["mode"], "persistent")
