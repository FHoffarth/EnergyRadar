import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "energyradar"))

import config  # noqa: E402
from services import data_source  # noqa: E402


class DataSourceNormalizationTests(unittest.TestCase):
    def test_private_ipv4_is_normalized_to_fixed_api_path(self):
        # Synthetic RFC1918 fixture, assembled so no device address is stored.
        address = socket.inet_ntoa(bytes((192, 168, 1, 25)))
        self.assertEqual(
            data_source.normalize_address(address),
            f"http://{address}" + data_source.API_PATH,
        )

    def test_local_hostname_and_https_are_supported(self):
        self.assertEqual(
            data_source.normalize_address("https://FRONIUS.local/"),
            "https://fronius.local" + data_source.API_PATH,
        )
        self.assertEqual(
            data_source.normalize_address("inverter"),
            "http://inverter" + data_source.API_PATH,
        )

    def test_public_literal_and_unsafe_url_features_are_rejected(self):
        unsafe = [
            "https://8.8.8.8",
            "https://example.com",
            "file://localhost/config",
            "http://user:password@fronius.local",
            "http://fronius.local/admin",
            "http://fronius.local?next=example.com",
        ]
        for value in unsafe:
            with self.subTest(value=value), self.assertRaises(data_source.DataSourceError):
                data_source.normalize_address(value)

    def test_resolved_hostname_must_stay_on_private_network(self):
        with patch.object(
            data_source.socket,
            "getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.8", 80))],
        ):
            with self.assertRaises(data_source.UnsafeTargetError):
                data_source.validate_resolved_target(
                    "http://inverter" + data_source.API_PATH
                )


class DataSourcePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "data-source.json"
        self.path_patch = patch.object(data_source, "_config_path", return_value=self.path)
        self.path_patch.start()
        self.env_patch = patch.object(config, "FRONIUS_URL", None)
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.path_patch.stop()
        self.directory.cleanup()

    def test_save_reload_and_remove_round_trip(self):
        saved = data_source.save("fronius.local")
        self.assertEqual(saved["source"], "saved")
        self.assertEqual(data_source.load_saved(), saved)
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(payload["provider"], "fronius")
        self.assertNotIn("password", payload)
        self.assertTrue(data_source.remove_saved())
        self.assertIsNone(data_source.load_saved())

    def test_environment_override_has_precedence(self):
        data_source.save("fronius.local")
        with patch.object(config, "FRONIUS_URL", "https://operator.example/api"):
            selected = data_source.effective()
        self.assertEqual(selected["source"], "environment")
        self.assertEqual(selected["url"], "https://operator.example/api")

    def test_missing_or_corrupt_file_is_unconfigured(self):
        self.assertIsNone(data_source.effective())
        self.path.write_text("not-json", encoding="utf-8")
        self.assertIsNone(data_source.effective())


if __name__ == "__main__":
    unittest.main()
