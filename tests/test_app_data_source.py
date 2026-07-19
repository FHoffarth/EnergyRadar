import sys
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "energyradar"))

import app as application  # noqa: E402
import config  # noqa: E402


class DataSourceApiTests(unittest.TestCase):
    def setUp(self):
        application.app.config.update(TESTING=True)
        self.client = application.app.test_client()

    def test_live_reports_unconfigured_without_attempting_device_access(self):
        with patch.object(config, "DEMO", False), patch.object(
            application.data_source, "effective", return_value=None
        ), patch.object(application.fronius, "read") as read:
            response = self.client.get("/api/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "no_data_source_configured")
        self.assertFalse(response.json["configured"])
        read.assert_not_called()

    def test_live_reports_configured_but_unreachable_device(self):
        selected = {"provider": "fronius", "url": "http://fronius.local", "source": "saved"}
        with patch.object(config, "DEMO", False), patch.object(
            application.data_source, "effective", return_value=selected
        ), patch.object(application.fronius, "read", side_effect=TimeoutError):
            response = self.client.get("/api/live")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["status"], "device_temporarily_unreachable")
        self.assertTrue(response.json["configured"])

    def test_connection_test_returns_safe_failure_without_exception_details(self):
        with patch.object(
            application.fronius, "read_url", side_effect=TimeoutError("private detail")
        ):
            response = self.client.post(
                "/api/data-source/test", json={"provider": "fronius", "address": "fronius.local"}
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["message"], "device_unreachable")
        self.assertNotIn("private detail", response.get_data(as_text=True))

    def test_public_target_is_rejected_before_collector(self):
        with patch.object(application.fronius, "read_url") as read:
            response = self.client.post(
                "/api/data-source/test", json={"provider": "fronius", "address": "8.8.8.8"}
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["message"], "unsafe_target")
        read.assert_not_called()

    def test_unknown_provider_is_rejected(self):
        with patch.object(application.fronius, "read_url") as read:
            response = self.client.post(
                "/api/data-source/test", json={"provider": "other", "address": "fronius.local"}
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json["message"], "invalid_address")
        read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
