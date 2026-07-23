import pytest
from unittest.mock import MagicMock, patch
from energyradar.ui.viewmodels import build_today_vm_with_mt175, build_now_vm
from energyradar.services.forecast import SolarForecastReport, ForecastConfidence, SolarForecastInterval


def test_today_viewmodel_forecast_integration():
    mock_forecast = SolarForecastReport(
        status="available",
        headline="Die Erzeugung dürfte nachmittags hoch liegen.",
        confidence=ForecastConfidence(level="high", score=0.9, reasons=["Gute Datenbasis"]),
        peak_window_start="2026-07-22T13:00:00+02:00",
        peak_window_end="2026-07-22T16:00:00+02:00",
        installed_kwp=8.5,
        intervals=[
            SolarForecastInterval(
                start_time="2026-07-22T12:00:00+02:00",
                end_time="2026-07-22T12:59:59+02:00",
                expected_min_w=2000.0,
                expected_max_w=3500.0,
                trend="rising",
                cloud_cover_percent=20.0
            )
        ],
        generated_at="2026-07-22T10:00:00+02:00",
        valid_until="2026-07-22T21:00:00+02:00",
        data_basis=["Daylight profile"],
        warnings=[]
    )

    with patch("energyradar.services.forecast.SolarForecastEngine.generate_forecast", return_value=mock_forecast):
        today_vm = build_today_vm_with_mt175(fronius=None, mt175=None)
        assert today_vm.solar_forecast is not None
        assert today_vm.solar_forecast["status"] == "available"
        assert today_vm.solar_forecast["installed_kwp"] == 8.5
        assert len(today_vm.solar_forecast["intervals"]) == 1


def test_now_viewmodel_forecast_integration():
    mock_forecast = SolarForecastReport(
        status="disabled",
        headline="Solarprognose deaktiviert.",
        confidence=ForecastConfidence(level="uncertain", score=0.0, reasons=["Deaktiviert."]),
        peak_window_start=None,
        peak_window_end=None,
        installed_kwp=None,
        intervals=[],
        generated_at="2026-07-22T10:00:00+02:00",
        valid_until=None,
        data_basis=[],
        warnings=["Deaktiviert"]
    )

    with patch("energyradar.services.forecast.SolarForecastEngine.generate_forecast", return_value=mock_forecast):
        now_vm = build_now_vm(
            fronius=None,
            mt175=None,
            fronius_configured=False,
            mt175_configured=False,
            fronius_error=None,
            mt175_error=None,
            stale_threshold_s=30.0,
        )
        assert now_vm.solar_forecast is not None
        assert now_vm.solar_forecast["status"] == "disabled"
        assert now_vm.solar_forecast["confidence"]["level"] == "uncertain"
