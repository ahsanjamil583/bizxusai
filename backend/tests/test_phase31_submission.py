import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.services.submission_service import build_public_submission_summary, build_submission_summary, normalize_submission_status


class Phase31SubmissionTests(unittest.TestCase):
    def test_normalize_submission_status_accepts_expected_values(self):
        self.assertEqual(normalize_submission_status("READY"), "ready")
        self.assertEqual(normalize_submission_status("ready_with_notes"), "ready_with_notes")
        with self.assertRaises(HTTPException):
            normalize_submission_status("maybe")

    def test_build_submission_summary_requires_signoff_for_final_ready(self):
        qa_summary = {"requiredPercent": 100, "percent": 95, "blockingGaps": [], "warnings": []}
        unsigned = build_submission_summary(qa_summary, None)
        self.assertEqual(unsigned["status"], "ready_needs_signoff")
        signed = build_submission_summary(qa_summary, {"status": "ready"})
        self.assertEqual(signed["status"], "submission_ready")
        blocked = build_submission_summary({**qa_summary, "blockingGaps": [{"code": "x"}]}, {"status": "ready"})
        self.assertEqual(blocked["status"], "not_ready")

    def test_public_submission_summary_reports_latest_phase(self):
        summary = build_public_submission_summary()
        self.assertGreaterEqual(summary["implementedThrough"], 31)
        self.assertTrue(summary["latestPhase"])
        self.assertTrue(summary["artifactChecklist"])
        self.assertIn(".env", summary["filesToExclude"])

    def test_public_submission_summary_route_is_available_for_smoke_check(self):
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
                response = client.get("/api/v1/health/submission-summary")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["success"])
        self.assertGreaterEqual(payload["data"]["implementedThrough"], 31)
