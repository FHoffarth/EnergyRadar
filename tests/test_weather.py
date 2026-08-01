import json
import pytest
from unittest.mock import MagicMock, patch
from energyradar.services.weather.models import (
    CurrentWeather, DailyWeatherPoint, HourlyWeatherPoint, LocationCandidate, ProviderWeatherPayload, ResolvedLocation, SunData, WeatherReport
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


def test_open_meteo_weather_intelligence_fields_are_parsed():
    provider = OpenMeteoProvider()
    location = ResolvedLocation(
        provider_id="test",
        display_name="Teststadt",
        latitude=49.0,
        longitude=8.0,
        timezone="Europe/Berlin",
    )
    response_data = {
        "timezone": "Europe/Berlin",
        "utc_offset_seconds": 7200,
        "current": {
            "time": "2026-07-29T12:00",
            "temperature_2m": 21.5,
            "apparent_temperature": 20.8,
            "precipitation": 0,
            "weather_code": 2,
            "cloud_cover": 35,
            "is_day": 1,
            "wind_speed_10m": 13.2,
        },
        "hourly": {
            "time": ["2026-07-29T11:00", "2026-07-29T12:00", "2026-07-29T13:00"],
            "temperature_2m": [20, 21.5, 22],
            "precipitation_probability": [5, 15, 25],
            "precipitation": [0, 0, 0],
            "weather_code": [1, 2, 2],
            "cloud_cover": [20, 35, 40],
        },
        "daily": {
            "time": ["2026-07-29", "2026-07-30"],
            "weather_code": [2, 61],
            "temperature_2m_min": [13.5, 14.0],
            "temperature_2m_max": [24.0, 20.5],
            "precipitation_probability_max": [15, 70],
            "sunrise": ["2026-07-29T05:50", "2026-07-30T05:51"],
            "sunset": ["2026-07-29T21:10", "2026-07-30T21:09"],
        },
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        payload = provider.fetch_weather(location)

    assert payload.current.feels_like_c == 20.8
    assert payload.current.wind_speed_kmh == 13.2
    assert payload.current.precipitation_probability_percent == 15
    assert payload.sun.sunrise == "2026-07-30T05:51"
    assert payload.sun.sunset == "2026-07-29T21:10"
    assert [point.time for point in payload.hourly] == [
        "2026-07-29T12:00",
        "2026-07-29T13:00",
    ]
    assert payload.hourly[1].precipitation_probability_percent == 25
    assert len(payload.daily) == 2
    assert payload.daily[1].condition == "rain"
    assert payload.daily[1].temperature_max_c == 20.5
    assert payload.daily[1].precipitation_probability_percent == 70
    assert payload.daily[0].sunrise == "2026-07-29T05:50"
    requested_url = mock_urlopen.call_args.args[0].full_url
    assert "forecast_days=7" in requested_url
    assert "wind_speed_unit=kmh" in requested_url


def test_open_meteo_partial_hourly_arrays_remain_aligned():
    provider = OpenMeteoProvider()
    location = ResolvedLocation(
        provider_id="test",
        display_name="Teststadt",
        latitude=49.0,
        longitude=8.0,
        timezone="Europe/Berlin",
    )
    response_data = {
        "timezone": "Europe/Berlin",
        "current": {"time": "2026-07-29T12:00", "weather_code": 0, "is_day": 1},
        "hourly": {
            "time": ["2026-07-29T12:00", "2026-07-29T13:00"],
            "temperature_2m": [21.0],
            "precipitation_probability": [10, 80],
            "precipitation": [],
            "weather_code": [0],
            "cloud_cover": None,
        },
        "daily": {"sunrise": None, "sunset": []},
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        payload = provider.fetch_weather(location)

    assert len(payload.hourly) == 2
    assert payload.hourly[0].temperature_c == 21.0
    assert payload.hourly[0].precipitation_probability_percent == 10
    assert payload.hourly[1].temperature_c is None
    assert payload.hourly[1].precipitation_probability_percent == 80
    assert payload.sun.sunrise is None


def test_open_meteo_missing_sections_degrade_to_empty_weather():
    provider = OpenMeteoProvider()
    location = ResolvedLocation(
        provider_id="test",
        display_name="Teststadt",
        latitude=49.0,
        longitude=8.0,
        timezone="Europe/Berlin",
    )
    response_data = {
        "timezone": None,
        "utc_offset_seconds": None,
        "current": None,
        "hourly": None,
        "daily": None,
    }

    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = json.dumps(response_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        payload = provider.fetch_weather(location)

    assert payload.current.condition == "unknown"
    assert payload.current.temperature_c is None
    assert payload.current.is_day is None
    assert payload.hourly == []
    assert payload.daily == []
    assert payload.sun.sunrise is None
    assert payload.sun.sunset is None
    assert payload.timezone == "Europe/Berlin"
    assert payload.utc_offset_seconds == 0


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
        current=CurrentWeather(
            condition="partly_cloudy",
            temperature_c=24.1,
            feels_like_c=23.4,
            wind_speed_kmh=11.0,
            cloud_cover_percent=38.0,
            precipitation_probability_percent=20.0,
        ),
        hourly=[
            HourlyWeatherPoint(
                time="2026-07-22T20:00",
                condition="partly_cloudy",
                temperature_c=24.1,
                precipitation_probability_percent=20.0,
            )
        ],
        daily=[
            DailyWeatherPoint(
                date="2026-07-22",
                condition="partly_cloudy",
                temperature_min_c=15.0,
                temperature_max_c=25.0,
                precipitation_probability_percent=20.0,
            )
        ],
    )

    key = cache.get_location_key("open_meteo", 49.869, 8.932, "Europe/Berlin")
    cache.save_cached_payload(key, payload)

    assert cache_file.exists()
    cached, _, _ = cache.load_cached_payload(key)
    assert cached is not None
    assert cached.current.feels_like_c == 23.4
    assert cached.current.wind_speed_kmh == 11.0
    assert cached.hourly[0].precipitation_probability_percent == 20.0
    assert cached.daily[0].temperature_max_c == 25.0

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
