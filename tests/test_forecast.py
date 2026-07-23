import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from energyradar.services.forecast import SolarForecastEngine, SolarForecastReport
from energyradar.services.weather.models import CurrentWeather, ProviderWeatherPayload, SunData, WeatherQuality, WeatherReport
from energyradar.ui import settings as ui_settings


def test_forecast_nighttime_zero():
    engine = SolarForecastEngine()

    # Mock weather report at midnight
    mock_report = WeatherReport(
        status="available",
        served_from_cache=False,
        sun=SunData(sunrise="2026-07-22T05:30:00+02:00", sunset="2026-07-22T21:15:00+02:00"),
        current=CurrentWeather(condition="clear", cloud_cover_percent=0.0),
        quality=WeatherQuality(freshness="fresh", source="open_meteo")
    )

    with patch.object(engine.weather_service, "get_weather_report", return_value=mock_report):
        now_midnight = datetime(2026, 7, 22, 1, 0, 0, tzinfo=timezone.utc)
        report = engine.generate_forecast(now_dt=now_midnight)

        assert report.status == "available"
        # Nighttime intervals must produce 0.0 W
        night_intervals = [i for i in report.intervals if "T02:" in i.start_time or "T03:" in i.start_time]
        for interval in night_intervals:
            assert interval.expected_min_w == 0.0
            assert interval.expected_max_w == 0.0


def test_forecast_confidence_downgrade_on_stale():
    engine = SolarForecastEngine()

    mock_report = WeatherReport(
        status="available",
        served_from_cache=True,
        sun=SunData(sunrise="2026-07-22T05:30:00+02:00", sunset="2026-07-22T21:15:00+02:00"),
        current=CurrentWeather(condition="cloudy", cloud_cover_percent=80.0),
        quality=WeatherQuality(freshness="stale", source="cache_fallback")
    )

    with patch.object(engine.weather_service, "get_weather_report", return_value=mock_report):
        report = engine.generate_forecast()
        assert report.confidence.level == "low"
        assert "stale" in report.confidence.reasons[0].lower()


def test_forecast_never_exceeds_installed_kwp(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)
    ui_settings.save_patch({"pv_installed_kwp": 5.0})  # 5 kWp = 5000 W

    engine = SolarForecastEngine()
    mock_report = WeatherReport(
        status="available",
        served_from_cache=False,
        sun=SunData(sunrise="2026-07-22T05:30:00+02:00", sunset="2026-07-22T21:15:00+02:00"),
        current=CurrentWeather(condition="clear", cloud_cover_percent=0.0),
        quality=WeatherQuality(freshness="fresh", source="open_meteo")
    )

    with patch.object(engine.weather_service, "get_weather_report", return_value=mock_report):
        now_noon = datetime(2026, 7, 22, 13, 0, 0, tzinfo=timezone.utc)
        report = engine.generate_forecast(now_dt=now_noon)

        assert report.installed_kwp == 5.0
        for interval in report.intervals:
            if interval.expected_max_w is not None:
                assert interval.expected_max_w <= 5000.0
                if interval.expected_min_w is not None:
                    assert interval.expected_min_w <= interval.expected_max_w


def test_invalid_installed_kwp_handled_safely(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    with pytest.raises(ValueError):
        ui_settings.save_patch({"pv_installed_kwp": -10.0})

    with pytest.raises(ValueError):
        ui_settings.save_patch({"pv_installed_kwp": True})
