import pytest
from datetime import datetime, timezone, timedelta
from energyradar.services import history
from energyradar.models.energy import QualityStatus

def test_derive_home_power():
    # Valid
    assert history.derive_home_power(3000, -800) == 2200
    assert history.derive_home_power(500, 900) == 1400

    # Missing
    assert history.derive_home_power(None, 900) is None
    assert history.derive_home_power(3000, None) is None

    # Negative logic protection
    assert history.derive_home_power(100, -500) is None

def test_coverage_and_integration(monkeypatch):
    tz = timezone.utc
    base_time = datetime(2026, 7, 22, 12, 0, 0, tzinfo=tz)

    class MockDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return base_time

    monkeypatch.setattr(history, "datetime", MockDatetime)

    # 1 hour gap between 10:00 and 11:00 => 3600 seconds.
    # Cov should be 1/12 = 8.3%
    # But let's construct some valid samples close to each other.

    samples = [
        {
            "measured_at": "2026-07-22 10:00:00",
            "pv_power_w": 1000,
            "grid_power_w": 500,
            "pv_energy_today_wh": 1000,
            "grid_import_total_wh": 500,
            "grid_export_total_wh": 0,
            "sample_quality_status": "valid"
        },
        {
            "measured_at": "2026-07-22 10:01:00",
            "pv_power_w": 2000,
            "grid_power_w": -500,
            "pv_energy_today_wh": 1025, # 25 wh in 1 min
            "grid_import_total_wh": 505,
            "grid_export_total_wh": 5,
            "sample_quality_status": "valid"
        }
    ]

    monkeypatch.setattr(history.storage, "get_samples_since", lambda start: samples)

    res = history.get_today_history(tz)

    assert res["summary"]["solar_kwh"] == 0.03
    assert res["summary"]["grid_import_kwh"] == 0.01 # 505-500 = 5. 5/1000 = 0.01

    # Cov
    assert res["coverage"]["pv"] == round(60 / (12*3600), 3)
    assert res["summary"]["autarky_pct"] is None # Cov too low
    assert res["economy_basis"]["solar_generation"]["source"] == "counter_delta"
    assert res["economy_basis"]["solar_generation"]["coverage_state"] == "sparse"


def test_economy_basis_rejects_counter_reset_and_negative_delta(monkeypatch):
    tz = timezone.utc
    base_time = datetime(2026, 7, 22, 1, 0, tzinfo=tz)

    class MockDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return base_time

    monkeypatch.setattr(history, "datetime", MockDatetime)
    samples = [
        {"measured_at": "2026-07-22 00:00:00", "pv_power_w": 1000, "grid_power_w": 100,
         "pv_energy_today_wh": 500, "grid_import_total_wh": 1000, "grid_export_total_wh": 1000, "sample_quality_status": "valid"},
        {"measured_at": "2026-07-22 00:10:00", "pv_power_w": 1000, "grid_power_w": 100,
         "pv_energy_today_wh": 10, "grid_import_total_wh": 900, "grid_export_total_wh": 900, "sample_quality_status": "valid"},
    ]
    monkeypatch.setattr(history.storage, "get_samples_since", lambda _start: samples)
    result = history.get_today_history(tz)["economy_basis"]
    assert result["solar_generation"]["value_kwh"] is None
    assert result["grid_import"]["value_kwh"] is None
    assert result["grid_export"]["value_kwh"] is None
    assert result["solar_generation"]["reason"] == "counter_reset_or_negative_delta"


def test_stale_rows_remain_visible_but_do_not_support_economy(monkeypatch):
    tz = timezone.utc
    base_time = datetime(2026, 7, 22, 0, 2, tzinfo=tz)
    class MockDatetime(datetime):
        @classmethod
        def now(cls, tz=None): return base_time
    monkeypatch.setattr(history, "datetime", MockDatetime)
    samples = [
        {"measured_at": "2026-07-22 00:00:00", "pv_power_w": 1000, "grid_power_w": -100,
         "pv_energy_today_wh": 0, "grid_import_total_wh": 0, "grid_export_total_wh": 0,
         "pv_quality_status": "stale", "grid_quality_status": "stale", "sample_quality_status": "stale"},
        {"measured_at": "2026-07-22 00:01:00", "pv_power_w": 1000, "grid_power_w": -100,
         "pv_energy_today_wh": 10, "grid_import_total_wh": 0, "grid_export_total_wh": 2,
         "pv_quality_status": "stale", "grid_quality_status": "stale", "sample_quality_status": "stale"},
    ]
    monkeypatch.setattr(history.storage, "get_samples_since", lambda _start: samples)
    result = history.get_today_history(tz)
    assert len(result["points"]) == 2
    assert result["economy_basis"]["solar_generation"]["value_kwh"] is None
    assert result["economy_basis"]["grid_export"]["coverage_state"] == "unavailable"
