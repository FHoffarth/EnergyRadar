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
    assert res["summary"]["consumption_kwh"] == 0.03
    assert res["summary"]["consumption_reason"] is None

    # Cov
    assert res["coverage"]["pv"] == round(60 / (12*3600), 3)
    assert res["summary"]["autarky_pct"] is None # Cov too low
    assert res["economy_basis"]["solar_generation"]["source"] == "counter_delta"
    assert res["economy_basis"]["solar_generation"]["coverage_state"] == "partial"
    assert res["economy_basis"]["grid_export"]["coverage_state"] == "partial"
    assert (
        res["economy_basis"]["solar_generation"]["period_key"]
        == res["economy_basis"]["grid_export"]["period_key"]
        == "2026-07-22T10:00:00+00:00|2026-07-22T10:01:00+00:00"
    )
    assert res["economy_basis"]["solar_generation"]["provenance"] == "trusted_counter_observations"
    assert res["economy_basis"]["house_consumption"]["coverage_state"] == "partial"
    assert res["economy_basis"]["house_consumption"]["value_kwh"] == "0.025"


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
    assert result["house_consumption"]["value_kwh"] is None
    assert result["house_consumption"]["reason"] == "house_solar_generation_counter_reset_or_negative_delta"


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


def captured_energy(value, *, period="start|end", source="counter_delta", provenance="trusted_counter_observations", coverage="partial", reason=None):
    return {
        "value_kwh": value,
        "period_key": period,
        "source": source,
        "provenance": provenance,
        "coverage_state": coverage,
        "reason": reason,
    }


def test_house_energy_uses_decimal_compatible_period_totals_without_direct_counter():
    result = history.derive_house_energy(
        captured_energy("6.17"), captured_energy("1.57"), captured_energy("3.93")
    )
    assert result == {
        "value_kwh": "3.81",
        "source": "calculated_compatible_energy",
        "provenance": "trusted_counter_observations",
        "coverage_state": "partial",
        "period_key": "start|end",
        "reason": None,
        "formula": "pv_generation_kwh + grid_import_kwh - grid_export_kwh",
    }


@pytest.mark.parametrize(
    ("changed_entry", "field", "value", "expected_reason"),
    [
        ("imported", "period_key", "later|end", "house_energy_period_mismatch"),
        ("exported", "source", "integrated_power_history", "house_energy_source_mismatch"),
        ("solar", "provenance", "untrusted", "house_energy_provenance_mismatch"),
    ],
)
def test_house_energy_rejects_incompatible_period_source_and_provenance(changed_entry, field, value, expected_reason):
    entries = {name: captured_energy("1") for name in ("solar", "imported", "exported")}
    entries[changed_entry][field] = value
    result = history.derive_house_energy(entries["solar"], entries["imported"], entries["exported"])
    assert result["value_kwh"] is None
    assert result["reason"] == expected_reason


def test_house_energy_preserves_zero_and_rejects_negative_balance():
    zero = history.derive_house_energy(
        captured_energy("0"), captured_energy("0"), captured_energy("0")
    )
    assert zero["value_kwh"] == "0"
    assert zero["coverage_state"] == "partial"
    negative = history.derive_house_energy(
        captured_energy("0"), captured_energy("0"), captured_energy("0.01")
    )
    assert negative["value_kwh"] is None
    assert negative["reason"] == "house_energy_balance_negative"
