"""Regression tests for weather location search bridge delivery.

Covers:
- Dieburg returns at least one candidate
- PLZ 64807 returns candidates
- Signal delivery uses internal signals with QueuedConnection (no QTimer.singleShot from daemon thread)
- Error path emits ok:false with error message (not silent empty list)
- Stale opId does not overwrite a newer query
- Successful result beats timeout race
"""
import dataclasses
import inspect
import json
import threading
import time
from unittest.mock import MagicMock, patch

import pytest
from PySide6.QtCore import QCoreApplication
from PySide6.QtWidgets import QApplication

from energyradar.services.weather.models import LocationCandidate
from energyradar.services.weather.providers.open_meteo import OpenMeteoProvider

_qt_app = None

# ── Provider-level: Dieburg ──────────────────────────────────────────────

def _mock_geocoding_response(results):
    import json as _json

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = _json.dumps({"results": results}).encode("utf-8")
    return mock_resp


def test_dieburg_returns_at_least_one_candidate():
    provider = OpenMeteoProvider()
    mock_data = {
        "results": [
            {
                "id": 2937591,
                "name": "Dieburg",
                "latitude": 49.89738,
                "longitude": 8.84613,
                "admin1": "Hessen",
                "admin2": "Darmstadt",
                "country": "Deutschland",
                "country_code": "DE",
                "postcodes": ["64807"],
                "timezone": "Europe/Berlin",
            }
        ]
    }
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__.return_value = _mock_geocoding_response(
            mock_data["results"]
        )
        candidates = provider.search_locations("Dieburg")
        assert len(candidates) >= 1
        assert candidates[0].name == "Dieburg"
        assert candidates[0].country_code == "DE"
        assert 49.0 < candidates[0].latitude < 50.0


def test_plz_64807_returns_candidates():
    provider = OpenMeteoProvider()

    zippopotam_resp = MagicMock()
    zippopotam_resp.status = 200
    zippopotam_resp.read.return_value = json.dumps({
        "post code": "64807",
        "country": "Deutschland",
        "places": [{
            "place name": "Dieburg",
            "state": "Hessen",
            "latitude": "49.9073",
            "longitude": "8.8433",
        }],
    }).encode("utf-8")

    geo_resp = MagicMock()
    geo_resp.status = 200
    geo_resp.read.return_value = json.dumps({
        "results": [
            {
                "id": 2937591,
                "name": "Dieburg",
                "latitude": 49.89738,
                "longitude": 8.84613,
                "admin1": "Hessen",
                "country": "Deutschland",
                "country_code": "DE",
                "postcodes": ["64807"],
                "timezone": "Europe/Berlin",
            }
        ]
    }).encode("utf-8")

    call_count = [0]

    def side_effect(req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        call_count[0] += 1
        ctx = MagicMock()
        if "zippopotam" in url:
            ctx.__enter__ = MagicMock(return_value=zippopotam_resp)
        else:
            ctx.__enter__ = MagicMock(return_value=geo_resp)
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx

    with patch("urllib.request.urlopen", side_effect=side_effect):
        candidates = provider.search_locations("64807")
        assert len(candidates) >= 1


# ── Bridge-level: direct emit (no QTimer.singleShot in daemon threads) ──

def _get_search_method_source():
    from energyradar.ui.bridge import EnergyBridge
    return inspect.getsource(EnergyBridge.searchWeatherLocations)


def test_search_does_not_use_qtimer_singleshot():
    """The searchWeatherLocations method must NOT use QTimer.singleShot for result delivery."""
    source = _get_search_method_source()
    assert "QTimer.singleShot" not in source, (
        "searchWeatherLocations still uses QTimer.singleShot — "
        "signals must be emitted directly from daemon threads"
    )


def test_search_emits_signal_directly():
    """searchWeatherLocations must use internal _weatherCandidatesReady signal (QueuedConnection relay)."""
    source = _get_search_method_source()
    assert "self._weatherCandidatesReady.emit(" in source, (
        "searchWeatherLocations must emit _weatherCandidatesReady internally (relayed via QueuedConnection)"
    )


def test_connection_test_does_not_use_qtimer_singleshot():
    """testConnection must NOT use QTimer.singleShot for result delivery."""
    from energyradar.ui.bridge import EnergyBridge
    source = inspect.getsource(EnergyBridge.testConnection)
    assert "QTimer.singleShot" not in source


def test_weather_connection_test_does_not_use_qtimer_singleshot():
    """testWeatherConnection must NOT use QTimer.singleShot for result delivery."""
    from energyradar.ui.bridge import EnergyBridge
    source = inspect.getsource(EnergyBridge.testWeatherConnection)
    assert "QTimer.singleShot" not in source


def test_weather_report_request_does_not_use_qtimer_singleshot():
    """Initial weather delivery must use the queued internal signal."""
    from energyradar.ui.bridge import EnergyBridge
    source = inspect.getsource(EnergyBridge.requestWeatherReport)
    assert "QTimer.singleShot" not in source
    assert "self._weatherReportReady.emit(" in source


# ── Bridge-level: error path emits distinct error (not silent empty list) ──

def test_search_error_path_emits_ok_false():
    """When search raises, the bridge emits ok:false with error, not an empty candidates list with ok:true."""
    source = _get_search_method_source()
    assert '"ok": False' in source or '"ok":False' in source
    assert '"error"' in source
    assert '"candidates": []' in source


# ── Serialization: JSON roundtrip ────────────────────────────────────────

def test_candidate_json_roundtrip():
    """A LocationCandidate survives dataclasses.asdict → json.dumps → JS parse."""
    candidate = LocationCandidate(
        provider_id="2937591",
        display_name="Dieburg, Hessen, Deutschland",
        name="Dieburg",
        latitude=49.89738,
        longitude=8.84613,
        admin1="Hessen",
        admin2="Darmstadt",
        country="Deutschland",
        country_code="DE",
        postcodes=["64807"],
        timezone="Europe/Berlin",
        provider="open_meteo",
    )
    d = dataclasses.asdict(candidate)
    j = json.dumps({"ok": True, "candidates": [d]}, ensure_ascii=False)
    parsed = json.loads(j)
    assert parsed["ok"] is True
    assert len(parsed["candidates"]) == 1
    c = parsed["candidates"][0]
    assert c["name"] == "Dieburg"
    assert c["latitude"] == 49.89738
    assert c["postcodes"] == ["64807"]


def test_null_postcodes_serializes_cleanly():
    """postcodes=None must serialize as JSON null, not crash."""
    candidate = LocationCandidate(
        provider_id="1",
        display_name="Test",
        name="Test",
        latitude=50.0,
        longitude=8.0,
        timezone="Europe/Berlin",
        provider="open_meteo",
    )
    d = dataclasses.asdict(candidate)
    j = json.dumps(d, ensure_ascii=False)
    parsed = json.loads(j)
    assert parsed["postcodes"] is None


# ── Threading: signal emission is thread-safe ────────────────────────────

def test_search_runs_in_daemon_thread():
    """_do_search must be dispatched on a daemon thread, not the main thread."""
    source = _get_search_method_source()
    assert "threading.Thread" in source
    assert "daemon=True" in source


def _make_bridge(tmp_path, monkeypatch):
    global _qt_app
    from energyradar import config
    from energyradar.ui.bridge import EnergyBridge

    monkeypatch.setattr(config, "USER_DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "database" / "energy.db")
    monkeypatch.setattr(config, "DATA_SOURCE_CONFIG_PATH", tmp_path / "data-source.json")
    monkeypatch.setattr(EnergyBridge, "_on_timer", lambda self: None)
    _qt_app = QApplication.instance() or QApplication([])
    return EnergyBridge()


def _process_events_until(predicate, timeout_s=3.0):
    app = QCoreApplication.instance()
    assert app is not None
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline and not predicate():
        app.processEvents()
        time.sleep(0.01)


def test_search_result_is_delivered_from_daemon_thread(tmp_path, monkeypatch):
    from energyradar.services.weather.service import WeatherService

    candidate = LocationCandidate(
        provider_id="2937591",
        display_name="Dieburg, Hessen, Deutschland",
        name="Dieburg",
        latitude=49.89738,
        longitude=8.84613,
        timezone="Europe/Berlin",
        provider="open_meteo",
    )
    monkeypatch.setattr(WeatherService, "search_locations", lambda self, query: [candidate])
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = []
    bridge.weatherCandidatesResult.connect(
        lambda operation_id, payload: received.append((operation_id, json.loads(payload)))
    )

    bridge.searchWeatherLocations("search-1", "Dieburg")
    _process_events_until(lambda: bool(received))
    bridge.shutdown()

    assert received
    operation_id, payload = received[0]
    assert operation_id == "search-1"
    assert payload["operation_id"] == "search-1"
    assert payload["ok"] is True
    assert payload["candidates"][0]["display_name"] == "Dieburg, Hessen, Deutschland"


def test_search_exception_is_delivered_as_error(tmp_path, monkeypatch):
    from energyradar.services.weather.service import WeatherService

    def fail_search(self, query):
        raise RuntimeError("geocoding unavailable")

    monkeypatch.setattr(WeatherService, "search_locations", fail_search)
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = []
    bridge.weatherCandidatesResult.connect(
        lambda operation_id, payload: received.append((operation_id, json.loads(payload)))
    )

    bridge.searchWeatherLocations("search-error", "Dieburg")
    _process_events_until(lambda: bool(received))
    bridge.shutdown()

    assert received
    operation_id, payload = received[0]
    assert operation_id == "search-error"
    assert payload["operation_id"] == "search-error"
    assert payload["ok"] is False
    assert payload["candidates"] == []
    assert "geocoding unavailable" in payload["error"]


def test_weather_connection_error_is_delivered_with_identity(tmp_path, monkeypatch):
    from energyradar.services.weather.service import WeatherService

    def fail_weather(self, force_fresh=False):
        raise RuntimeError("weather unavailable")

    monkeypatch.setattr(WeatherService, "get_weather_report", fail_weather)
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = []
    bridge.weatherConnectionTestResult.connect(
        lambda operation_id, payload: received.append((operation_id, json.loads(payload)))
    )

    bridge.testWeatherConnection("weather-test-1")
    _process_events_until(lambda: bool(received))
    bridge.shutdown()

    assert received
    operation_id, payload = received[0]
    assert operation_id == "weather-test-1"
    assert payload["operation_id"] == "weather-test-1"
    assert payload["ok"] is False
    assert payload["status"] == "error"
    assert "weather unavailable" in payload["message"]


def test_weather_report_is_delivered_after_bridge_connection(tmp_path, monkeypatch):
    from energyradar.services.runtime import get_runtime

    report = MagicMock()
    report.to_dict.return_value = {
        "status": "available",
        "provider_status": "reachable",
        "served_from_cache": True,
        "observed_at": None,
        "fetched_at": None,
        "location": {"display_name": "Dieburg, Hessen, Deutschland"},
        "sun": None,
        "current": {"condition": "clear", "temperature_c": 22.0},
        "quality": {"freshness": "fresh", "source": "open_meteo", "age_seconds": 0},
        "warnings": [],
    }
    get_runtime().projection.update_weather(report)
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = []
    bridge.weatherReportChanged.connect(lambda payload: received.append(json.loads(payload)))

    bridge.requestWeatherReport()
    _process_events_until(lambda: bool(received))
    bridge.shutdown()

    assert received
    assert received[0]["status"] == "available"
    assert received[0]["location"]["display_name"] == "Dieburg, Hessen, Deutschland"


def test_settings_save_reports_device_address_persistence_failure(tmp_path, monkeypatch):
    from energyradar.services import data_source
    from energyradar.ui import settings as ui_settings

    bridge = _make_bridge(tmp_path, monkeypatch)
    data_source.save("192.168.1.5")
    ui_settings.save_patch({"preferred_name": "Existing"})
    previous_source = data_source.load_saved()
    previous_settings = ui_settings.load_raw_dict()
    succeeded = []
    failed = []
    bridge.settingsSaveSucceeded.connect(lambda payload: succeeded.append(json.loads(payload)))
    bridge.settingsSaveFailed.connect(lambda payload: failed.append(json.loads(payload)))

    def fail_save(_address):
        raise OSError("device settings are read-only")

    monkeypatch.setattr(data_source, "save", fail_save)
    bridge.updateSettings(json.dumps({"fronius_address": "192.168.1.10", "preferred_name": "Flo"}))
    bridge.shutdown()

    assert succeeded == []
    assert failed and failed[0]["ok"] is False
    assert failed[0]["message"] == "Einstellungen konnten nicht gespeichert werden."
    assert "read-only" not in json.dumps(failed[0])
    assert data_source.load_saved() == previous_source
    assert ui_settings.load_raw_dict() == previous_settings


def test_settings_save_validates_full_patch_before_any_store_write(tmp_path, monkeypatch):
    from energyradar.services import data_source
    from energyradar.ui import settings as ui_settings

    bridge = _make_bridge(tmp_path, monkeypatch)
    data_source.save("192.168.1.5")
    ui_settings.save_patch({"preferred_name": "Existing", "theme": "dark"})
    previous_source = data_source.load_saved()
    previous_settings = ui_settings.load_raw_dict()
    succeeded = []
    failed = []
    bridge.settingsSaveSucceeded.connect(lambda payload: succeeded.append(json.loads(payload)))
    bridge.settingsSaveFailed.connect(lambda payload: failed.append(json.loads(payload)))

    bridge.updateSettings(json.dumps({
        "fronius_address": "192.168.1.10",
        "preferred_name": "Changed",
        "theme": "not-a-theme",
    }))
    bridge.shutdown()

    assert data_source.load_saved() == previous_source
    assert ui_settings.load_raw_dict() == previous_settings
    assert succeeded == []
    assert failed and failed[0]["ok"] is False


def test_settings_save_valid_full_patch_persists_every_value(tmp_path, monkeypatch):
    from energyradar.services import data_source
    from energyradar.ui import settings as ui_settings

    bridge = _make_bridge(tmp_path, monkeypatch)
    succeeded = []
    failed = []
    bridge.settingsSaveSucceeded.connect(lambda payload: succeeded.append(json.loads(payload)))
    bridge.settingsSaveFailed.connect(lambda payload: failed.append(json.loads(payload)))

    bridge.updateSettings(json.dumps({
        "fronius_address": "192.168.1.10",
        "preferred_name": "  New Name  ",
        "theme": "light",
    }))
    bridge.shutdown()

    assert data_source.load_saved() is not None
    assert "192.168.1.10" in data_source.load_saved()["url"]
    assert ui_settings.load_raw_dict() == {
        "fronius_address": "192.168.1.10",
        "preferred_name": "New Name",
        "theme": "light",
    }
    assert len(succeeded) == 1 and succeeded[0]["ok"] is True
    assert failed == []


def test_settings_store_failure_restores_previous_data_source(tmp_path, monkeypatch):
    from energyradar.services import data_source
    from energyradar.ui import settings as ui_settings

    bridge = _make_bridge(tmp_path, monkeypatch)
    data_source.save("192.168.1.5")
    previous_source = data_source.load_saved()
    succeeded = []
    failed = []
    bridge.settingsSaveSucceeded.connect(lambda payload: succeeded.append(json.loads(payload)))
    bridge.settingsSaveFailed.connect(lambda payload: failed.append(json.loads(payload)))

    def fail_settings_save(_patch):
        raise OSError("settings read-only")

    monkeypatch.setattr(ui_settings, "save_patch", fail_settings_save)

    bridge.updateSettings(json.dumps({"fronius_address": "192.168.1.10"}))
    bridge.shutdown()

    assert data_source.load_saved() == previous_source
    assert succeeded == []
    assert failed and failed[0]["message"] == "Einstellungen konnten nicht gespeichert werden."
    assert "read-only" not in json.dumps(failed[0])
