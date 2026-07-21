"""Unit tests for the BitShake MT175 collector.

All HTTP calls are mocked.  No live device is required.
Run with:
    python -m pytest tests/test_mt175_collector.py -v
or:
    python -m unittest tests.test_mt175_collector -v
"""

import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Path setup — mirrors all other test files in this project
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "energyradar"))

import config as cfg_module               # noqa: E402
from collectors import mt175 as collector  # noqa: E402
from models.mt175 import MT175Reading      # noqa: E402


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_BERLIN = ZoneInfo("Europe/Berlin")

# The exact JSON provided in the specification.
# All power channels are zero and server_id is empty → meter is PIN-locked.
_SPEC_EXAMPLE = {
    "StatusSNS": {
        "Time": "2026-07-21T18:59:19",
        "MT175": {
            "ImportActive": 9755.000,
            "ExportActive": 12399.000,
            "Power": 0,
            "power_L1": 0,
            "power_L2": 0,
            "power_L3": 0,
            "server_id": "",
        },
    }
}


def _make_payload(mt175_overrides: dict | None = None, time: str = "2026-07-21T12:00:00") -> dict:
    """Build a minimal valid Tasmota payload with optional MT175 field overrides."""
    mt175 = {
        "ImportActive": 100.0,
        "ExportActive": 50.0,
        "Power": 250,
        "power_L1": 100,
        "power_L2": 80,
        "power_L3": 70,
        "server_id": "AABBCCDD",
    }
    if mt175_overrides:
        mt175.update(mt175_overrides)
    return {"StatusSNS": {"Time": time, "MT175": mt175}}


# ---------------------------------------------------------------------------
# 1. Specification example — PIN-locked meter
# ---------------------------------------------------------------------------

class SpecExampleTest(unittest.TestCase):
    """The exact JSON from the spec: all zeros + empty server_id → PIN-locked."""

    def setUp(self):
        self.reading = collector.parse(_SPEC_EXAMPLE)

    def test_returns_mt175_reading_instance(self):
        self.assertIsInstance(self.reading, MT175Reading)

    def test_import_kwh(self):
        self.assertAlmostEqual(self.reading.grid_import_total_kwh, 9755.0)

    def test_export_kwh(self):
        self.assertAlmostEqual(self.reading.grid_export_total_kwh, 12399.0)

    def test_current_power_is_none_when_pin_locked(self):
        self.assertIsNone(self.reading.current_power_w)

    def test_all_phase_values_are_zero(self):
        self.assertEqual(self.reading.phase_l1_w, 0.0)
        self.assertEqual(self.reading.phase_l2_w, 0.0)
        self.assertEqual(self.reading.phase_l3_w, 0.0)

    def test_meter_id_is_empty_string(self):
        self.assertEqual(self.reading.meter_id, "")

    # --- timestamp ---

    def test_timestamp_is_not_none_for_valid_time_string(self):
        self.assertIsNotNone(self.reading.timestamp)

    def test_timestamp_is_timezone_aware(self):
        self.assertIsNotNone(self.reading.timestamp)
        self.assertIsNotNone(self.reading.timestamp.tzinfo)

    def test_timestamp_date_and_time_components(self):
        ts = self.reading.timestamp
        self.assertIsNotNone(ts)
        self.assertEqual((ts.year, ts.month, ts.day), (2026, 7, 21))
        self.assertEqual((ts.hour, ts.minute, ts.second), (18, 59, 19))

    def test_timestamp_zone_is_berlin(self):
        self.assertIsNotNone(self.reading.timestamp)
        self.assertEqual(self.reading.timestamp.tzinfo, _BERLIN)


# ---------------------------------------------------------------------------
# 2. Unlocked meter, genuinely measuring zero watts
# ---------------------------------------------------------------------------

class UnlockedZeroPowerTest(unittest.TestCase):
    """server_id is present → meter is unlocked; Power == 0 means real zero."""

    def setUp(self):
        payload = _make_payload({"Power": 0, "power_L1": 0, "power_L2": 0, "power_L3": 0,
                                 "server_id": "0123456789ABCDEF"})
        self.reading = collector.parse(payload)

    def test_current_power_is_zero_float_not_none(self):
        self.assertIsNotNone(self.reading.current_power_w)
        self.assertEqual(self.reading.current_power_w, 0.0)

    def test_meter_id_is_preserved(self):
        self.assertEqual(self.reading.meter_id, "0123456789ABCDEF")


# ---------------------------------------------------------------------------
# 3. Normal live reading with positive net import
# ---------------------------------------------------------------------------

class PositivePowerTest(unittest.TestCase):
    """Household is drawing from the grid."""

    def setUp(self):
        self.reading = collector.parse(_make_payload())

    def test_current_power_is_float(self):
        self.assertIsInstance(self.reading.current_power_w, float)
        self.assertAlmostEqual(self.reading.current_power_w, 250.0)

    def test_phase_values(self):
        self.assertAlmostEqual(self.reading.phase_l1_w, 100.0)
        self.assertAlmostEqual(self.reading.phase_l2_w, 80.0)
        self.assertAlmostEqual(self.reading.phase_l3_w, 70.0)


# ---------------------------------------------------------------------------
# 4. Negative power — household is exporting to the grid
# ---------------------------------------------------------------------------

class NegativePowerTest(unittest.TestCase):
    """Negative Power values must be preserved (solar export scenario)."""

    def setUp(self):
        payload = _make_payload(
            {"Power": -850, "power_L1": -300, "power_L2": -280, "power_L3": -270}
        )
        self.reading = collector.parse(payload)

    def test_negative_net_power_preserved(self):
        self.assertAlmostEqual(self.reading.current_power_w, -850.0)

    def test_negative_phase_values_preserved(self):
        self.assertAlmostEqual(self.reading.phase_l1_w, -300.0)
        self.assertAlmostEqual(self.reading.phase_l2_w, -280.0)
        self.assertAlmostEqual(self.reading.phase_l3_w, -270.0)


# ---------------------------------------------------------------------------
# 5. Numeric string values (some Tasmota firmware variants)
# ---------------------------------------------------------------------------

class NumericStringValuesTest(unittest.TestCase):
    """All meter fields arrive as strings — must coerce without raising."""

    def setUp(self):
        payload = _make_payload({
            "ImportActive": "9755.000",
            "ExportActive": "12399.000",
            "Power": "150",
            "power_L1": "50",
            "power_L2": "50",
            "power_L3": "50",
            "server_id": "DEADBEEF",
        })
        self.reading = collector.parse(payload)

    def test_import_parsed_from_string(self):
        self.assertAlmostEqual(self.reading.grid_import_total_kwh, 9755.0)

    def test_export_parsed_from_string(self):
        self.assertAlmostEqual(self.reading.grid_export_total_kwh, 12399.0)

    def test_power_parsed_from_string(self):
        self.assertAlmostEqual(self.reading.current_power_w, 150.0)

    def test_phase_l1_parsed_from_string(self):
        self.assertAlmostEqual(self.reading.phase_l1_w, 50.0)

    def test_string_zero_triggers_pin_lock_check_correctly(self):
        # "0" strings with empty server_id → still PIN-locked
        payload = _make_payload({
            "Power": "0", "power_L1": "0", "power_L2": "0", "power_L3": "0",
            "server_id": "",
        })
        reading = collector.parse(payload)
        self.assertIsNone(reading.current_power_w)


# ---------------------------------------------------------------------------
# 6. Missing optional fields — safe defaults
# ---------------------------------------------------------------------------

class MissingFieldsTest(unittest.TestCase):
    """Optional MT175 fields are absent — must degrade to safe defaults."""

    def setUp(self):
        payload = {
            "StatusSNS": {
                "Time": "2026-07-21T08:00:00",
                "MT175": {
                    "ImportActive": 100.0,
                    # ExportActive, Power, power_L1/L2/L3, server_id all absent
                },
            }
        }
        self.reading = collector.parse(payload)

    def test_export_defaults_to_zero(self):
        self.assertEqual(self.reading.grid_export_total_kwh, 0.0)

    def test_current_power_is_none_missing_power_fields(self):
        # Missing power fields default to 0, missing server_id defaults to ""
        # → all PIN-lock conditions satisfied → None
        self.assertIsNone(self.reading.current_power_w)

    def test_phases_default_to_zero(self):
        self.assertEqual(self.reading.phase_l1_w, 0.0)
        self.assertEqual(self.reading.phase_l2_w, 0.0)
        self.assertEqual(self.reading.phase_l3_w, 0.0)

    def test_meter_id_defaults_to_empty_string(self):
        self.assertEqual(self.reading.meter_id, "")


# ---------------------------------------------------------------------------
# 7. Explicit None field values
# ---------------------------------------------------------------------------

class NoneFieldValuesTest(unittest.TestCase):
    """Fields present in JSON but explicitly null/None degrade gracefully."""

    def setUp(self):
        payload = {
            "StatusSNS": {
                "Time": "2026-07-21T10:00:00",
                "MT175": {
                    "ImportActive": None,
                    "ExportActive": None,
                    "Power": None,
                    "power_L1": None,
                    "power_L2": None,
                    "power_L3": None,
                    "server_id": None,
                },
            }
        }
        self.reading = collector.parse(payload)

    def test_import_defaults_to_zero(self):
        self.assertEqual(self.reading.grid_import_total_kwh, 0.0)

    def test_export_defaults_to_zero(self):
        self.assertEqual(self.reading.grid_export_total_kwh, 0.0)

    def test_current_power_is_none_all_null_fields(self):
        # None → 0.0 for each power field, None server_id → "" → PIN-locked
        self.assertIsNone(self.reading.current_power_w)

    def test_meter_id_is_empty_string_for_null_server_id(self):
        self.assertEqual(self.reading.meter_id, "")


# ---------------------------------------------------------------------------
# 8. Malformed / missing timestamp
# ---------------------------------------------------------------------------

class MalformedTimestampTest(unittest.TestCase):
    """Absent or malformed Time values must yield None for timestamp.

    The collector must never silently substitute the current time for a
    missing device timestamp — that would misrepresent when the reading
    was taken.  Callers that need a reliable wall-clock anchor should
    use received_at instead.
    """

    def _parse_with_time(self, time_value) -> MT175Reading:
        payload: dict = {
            "StatusSNS": {
                "MT175": {"ImportActive": 0, "ExportActive": 0, "server_id": "X"},
            }
        }
        if time_value is not None:
            payload["StatusSNS"]["Time"] = time_value
        return collector.parse(payload)

    def test_garbage_string_yields_none_timestamp(self):
        reading = self._parse_with_time("not-a-date")
        self.assertIsNone(reading.timestamp)

    def test_empty_string_yields_none_timestamp(self):
        reading = self._parse_with_time("")
        self.assertIsNone(reading.timestamp)

    def test_missing_time_key_yields_none_timestamp(self):
        reading = self._parse_with_time(None)
        self.assertIsNone(reading.timestamp)

    def test_numeric_time_yields_none_timestamp(self):
        # An integer coerced via str() is not a valid ISO string.
        reading = self._parse_with_time(12345)
        self.assertIsNone(reading.timestamp)

    def test_received_at_is_set_even_when_timestamp_is_none(self):
        reading = self._parse_with_time("bad")
        self.assertIsNotNone(reading.received_at)
        self.assertIsNotNone(reading.received_at.tzinfo)


# ---------------------------------------------------------------------------
# 9. Missing structural keys → KeyError (not silent corruption)
# ---------------------------------------------------------------------------

class MissingStructureTest(unittest.TestCase):
    """Top-level or nested structural keys must raise KeyError when absent."""

    def test_empty_dict_raises_key_error(self):
        with self.assertRaises(KeyError):
            collector.parse({})

    def test_missing_mt175_block_raises_key_error(self):
        with self.assertRaises(KeyError):
            collector.parse({"StatusSNS": {"Time": "2026-07-21T12:00:00"}})

    def test_status_sns_is_not_a_dict_raises(self):
        with self.assertRaises((KeyError, TypeError, AttributeError)):
            collector.parse({"StatusSNS": "unexpected-string"})


# ---------------------------------------------------------------------------
# 10. HTTP layer — read_url
# ---------------------------------------------------------------------------

def _mock_response(json_data: dict | None = None, http_error=None) -> MagicMock:
    """Build a minimal mock of a requests.Response."""
    mock_resp = MagicMock()
    if http_error is not None:
        mock_resp.raise_for_status.side_effect = http_error
    else:
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = json_data if json_data is not None else _SPEC_EXAMPLE
    return mock_resp


class ReadUrlTest(unittest.TestCase):
    """read_url must call the correct endpoint and propagate all HTTP errors."""

    def test_appends_tasmota_path_to_base_url(self):
        with patch("collectors.mt175.requests.get", return_value=_mock_response()) as mock_get:
            collector.read_url("http://tasmota.local")
        mock_get.assert_called_once_with(
            "http://tasmota.local/cm?cmnd=Status%2010",
            timeout=(1.5, 3.0),
            allow_redirects=False,
        )

    def test_trailing_slash_on_base_url_is_stripped(self):
        with patch("collectors.mt175.requests.get", return_value=_mock_response()) as mock_get:
            collector.read_url("http://192.168.1.25/")
        called_url = mock_get.call_args[0][0]
        # Must not produce a double-slash before /cm
        self.assertFalse(called_url.startswith("http://192.168.1.25//"))
        self.assertIn("/cm?cmnd=Status%2010", called_url)

    def test_returns_mt175_reading(self):
        with patch("collectors.mt175.requests.get", return_value=_mock_response()):
            reading = collector.read_url("http://tasmota.local")
        self.assertIsInstance(reading, MT175Reading)

    def test_redirects_are_not_followed(self):
        """allow_redirects=False must be forwarded to requests.get."""
        with patch("collectors.mt175.requests.get", return_value=_mock_response()) as mock_get:
            collector.read_url("http://tasmota.local")
        _, kwargs = mock_get.call_args
        self.assertFalse(kwargs.get("allow_redirects", True))

    def test_http_404_propagates(self):
        import requests as req_lib
        with patch(
            "collectors.mt175.requests.get",
            return_value=_mock_response(http_error=req_lib.exceptions.HTTPError("404")),
        ):
            with self.assertRaises(req_lib.exceptions.HTTPError):
                collector.read_url("http://tasmota.local")

    def test_connection_error_propagates(self):
        import requests as req_lib
        with patch(
            "collectors.mt175.requests.get",
            side_effect=req_lib.exceptions.ConnectionError("unreachable"),
        ):
            with self.assertRaises(req_lib.exceptions.ConnectionError):
                collector.read_url("http://tasmota.local")

    def test_timeout_propagates(self):
        import requests as req_lib
        with patch(
            "collectors.mt175.requests.get",
            side_effect=req_lib.exceptions.Timeout("timed out"),
        ):
            with self.assertRaises(req_lib.exceptions.Timeout):
                collector.read_url("http://tasmota.local")

    def test_unexpected_json_structure_raises_key_error(self):
        with patch(
            "collectors.mt175.requests.get",
            return_value=_mock_response(json_data={"unexpected": "payload"}),
        ):
            with self.assertRaises(KeyError):
                collector.read_url("http://tasmota.local")


# ---------------------------------------------------------------------------
# 11. Timezone configuration
# ---------------------------------------------------------------------------

class TimezoneConfigTest(unittest.TestCase):
    """The collector honours MT175_TIMEZONE and falls back safely."""

    _PAYLOAD = _make_payload(time="2026-07-21T12:00:00")

    def test_custom_timezone_is_used(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", "UTC"):
            reading = collector.parse(self._PAYLOAD)
        self.assertIsNotNone(reading.timestamp)
        self.assertEqual(reading.timestamp.tzinfo, ZoneInfo("UTC"))

    def test_default_timezone_is_berlin(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", "Europe/Berlin"):
            reading = collector.parse(self._PAYLOAD)
        self.assertIsNotNone(reading.timestamp)
        self.assertEqual(reading.timestamp.tzinfo, ZoneInfo("Europe/Berlin"))

    def test_invalid_timezone_name_falls_back_to_berlin(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", "Not/AReal/Zone"):
            reading = collector.parse(self._PAYLOAD)
        self.assertIsNotNone(reading.timestamp)
        self.assertEqual(reading.timestamp.tzinfo, ZoneInfo("Europe/Berlin"))

    def test_empty_string_timezone_falls_back_to_berlin(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", ""):
            reading = collector.parse(self._PAYLOAD)
        self.assertIsNotNone(reading.timestamp)
        self.assertEqual(reading.timestamp.tzinfo, ZoneInfo("Europe/Berlin"))

    def test_none_timezone_falls_back_to_berlin(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", None):
            reading = collector.parse(self._PAYLOAD)
        self.assertIsNotNone(reading.timestamp)
        self.assertEqual(reading.timestamp.tzinfo, ZoneInfo("Europe/Berlin"))


# ---------------------------------------------------------------------------
# 12. received_at — always-present parse-time anchor
# ---------------------------------------------------------------------------

class ReceivedAtTest(unittest.TestCase):
    """received_at is always a timezone-aware datetime set at parse time."""

    def test_received_at_is_always_present_for_valid_payload(self):
        reading = collector.parse(_SPEC_EXAMPLE)
        self.assertIsInstance(reading.received_at, datetime)

    def test_received_at_is_timezone_aware(self):
        reading = collector.parse(_SPEC_EXAMPLE)
        self.assertIsNotNone(reading.received_at.tzinfo)

    def test_received_at_is_close_to_wall_clock_now(self):
        before = datetime.now(_BERLIN)
        reading = collector.parse(_SPEC_EXAMPLE)
        after = datetime.now(_BERLIN)
        self.assertGreaterEqual(reading.received_at, before)
        self.assertLessEqual(reading.received_at, after)

    def test_received_at_is_present_when_timestamp_is_none(self):
        payload = {
            "StatusSNS": {
                "Time": "not-a-date",
                "MT175": {"ImportActive": 0, "ExportActive": 0, "server_id": "X"},
            }
        }
        reading = collector.parse(payload)
        self.assertIsNone(reading.timestamp)
        self.assertIsInstance(reading.received_at, datetime)
        self.assertIsNotNone(reading.received_at.tzinfo)

    def test_received_at_uses_configured_timezone(self):
        with patch.object(cfg_module, "MT175_TIMEZONE", "UTC"):
            reading = collector.parse(_make_payload())
        self.assertEqual(reading.received_at.tzinfo, ZoneInfo("UTC"))


if __name__ == "__main__":
    unittest.main()
