import unittest

from app.services.onboarding_service import highest_required_plan, normalize_launch_profile, summarize_launch_status


class Phase28OnboardingTests(unittest.TestCase):
    def test_normalize_launch_profile_uses_default_for_unknown_profile(self):
        self.assertEqual(normalize_launch_profile("full_agent_demo"), "full_agent_demo")
        self.assertEqual(normalize_launch_profile("unknown"), "ai_ordering")

    def test_highest_required_plan_does_not_downgrade_current_plan(self):
        self.assertEqual(highest_required_plan("scale", "growth"), "scale")
        self.assertEqual(highest_required_plan("starter", "growth"), "growth")
        self.assertEqual(highest_required_plan("bad", "scale"), "scale")

    def test_summarize_launch_status_requires_required_checks_only_for_publish(self):
        checks = [
            {"required": True, "completed": True},
            {"required": True, "completed": True},
            {"required": False, "completed": False},
        ]
        summary = summarize_launch_status(checks, {"websiteStatus": "draft", "status": "draft"})
        self.assertEqual(summary["requiredPercent"], 100)
        self.assertTrue(summary["canPublish"])
        self.assertEqual(summary["status"], "ready_to_publish")
