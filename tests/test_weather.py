import json
import pytest
from unittest.mock import MagicMock, patch
from energyradar.services.weather.models import (
    CurrentWeather, LocationCandidate, ProviderWeatherPayload, ResolvedLocation, SunData, WeatherReport
)
from energyradar.services.weather.providers.open_meteo import OpenMeteoProvider, map_wmo_code
from energyradar.services.weather import cache
from energyradar.services.weather.service import WeatherService
from energyradar.ui import settings as ui_settings


def test_wmo_code_mapping():
    assert map_wmo_code(0) == "clear"
    assert map_wmo_code(1) == "partly_cloudy"
    assert map_wmo_code(3) == "cloudy"
    assert map_wmo_code(45) == "fog"
    assert map_wmo_code(61) == "rain"
    assert map_wmo_code(80) == "heavy_rain"
    assert map_wmo_code(71) == "snow"
    assert map_wmo_code(95) == "thunderstorm"
    assert map_wmo_code(999) == "unknown"
    assert map_wmo_code(None) == "unknown"


def test_open_meteo_geocoding_parsing():
    provider = OpenMeteoProvider()

    mock_response_data = {
        "results": [
            {
                "id": 2911298,
                "name": "Beispielstadt",
                "latitude": 49.86899,
                "longitude": 8.9321,
                "admin1": "Hessen",
                "country": "Deutschland",
                "country_code": "DE",
                "postcodes": ["12345"],
                "timezone": "Europe/Berlin"
            }
        ]
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(mock_response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        candidates = provider.search_locations("Beispielstadt")
        assert len(candidates) == 1
        cand = candidates[0]
        assert cand.name == "Beispielstadt"
        assert cand.latitude == 49.86899
        assert cand.longitude == 8.9321
        assert cand.postcodes == ["12345"]
        assert cand.provider_id == "2911298"


def test_cache_ttl_and_stale_fallback(tmp_path, monkeypatch):
    cache_file = tmp_path / "weather-cache.json"
    monkeypatch.setattr(cache, "_cache_path", lambda: cache_file)

    payload = ProviderWeatherPayload(
        provider="open_meteo",
        observed_at="2026-07-22T20:00:00+00:00",
        fetched_at="2026-07-22T20:00:00+00:00",
        timezone="Europe/Berlin",
        utc_offset_seconds=7200,
        sun=SunData(sunrise="2026-07-22T05:43:00+02:00", sunset="2026-07-22T21:17:00+02:00"),
        current=CurrentWeather(condition="partly_cloudy", temperature_c=24.1, cloud_cover_percent=38.0)
    )

    key = cache.get_location_key("open_meteo", 49.869, 8.932, "Europe/Berlin")
    cache.save_cached_payload(key, payload)

    assert cache_file.exists()

    # Read back cache
    cached, freshness, age = cache.load_cached_payload(key)
    assert cached is not None
    assert cached.current.temperature_c == 24.1
    assert cached.current.cloud_cover_percent == 38.0


def test_weather_service_status_when_disabled(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)
    ui_settings.save_patch({"weather_enabled": False})

    service = WeatherService()
    report = service.get_weather_report()
    assert report.status == "disabled"


def test_weather_service_missing_location(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)
    ui_settings.save_patch({"weather_enabled": True, "resolved_location": None, "latitude": None, "longitude": None})

    service = WeatherService()
    report = service.get_weather_report()
    assert report.status == "missing_location"
