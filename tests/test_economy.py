from datetime import datetime, timezone
from decimal import Decimal

from energyradar.services import economy


def energy(value, source="counter_delta", coverage="complete", key="period"):
    return {"value_kwh": value, "source": source, "coverage_state": coverage, "period_key": key}


def basis(solar="3.2", imported="2", exported="1.4", coverage="complete"):
    return {
        "period": {
            "from": "2026-03-04T00:00:00+01:00", "to": "2026-03-04T23:00:00+01:00",
            "timezone": "Europe/Berlin", "local_date_from": "2026-03-04", "local_date_to": "2026-03-04",
        },
        "solar_generation": energy(solar, coverage=coverage),
        "grid_import": energy(imported, coverage=coverage),
        "grid_export": energy(exported, coverage=coverage),
    }


def tariffs(provisional=False):
    return [
        {"id": 1, "tariff_type": "grid_work_price", "value_ct_per_kwh": "34.00", "annual_eur": None, "valid_from": "2026-01-01", "valid_until": "2026-12-31", "label": "ENTEGA Ökostrom fix 24", "source_type": "invoice", "provisional": False},
        {"id": 2, "tariff_type": "feed_in_tariff", "value_ct_per_kwh": "12.00", "annual_eur": None, "valid_from": "2026-01-01", "valid_until": None, "label": None, "source_type": "provisional_user_assumption" if provisional else "contract", "provisional": provisional},
        {"id": 3, "tariff_type": "base_price", "value_ct_per_kwh": None, "annual_eur": "120.00", "valid_from": "2026-01-01", "valid_until": None, "label": None, "source_type": "invoice", "provisional": False},
    ]


def test_complete_decimal_calculation_and_base_price_exclusion():
    result = economy.calculate_period(basis(), tariffs(), calculated_at=datetime(2026, 3, 5, tzinfo=timezone.utc))
    assert Decimal(result["results"]["grid_import_cost"]["value_eur"]) == Decimal("0.68")
    assert Decimal(result["results"]["feed_in_remuneration"]["value_eur"]) == Decimal("0.168")
    assert result["energy_basis"]["direct_self_consumption"]["value_kwh"] == "1.8"
    assert Decimal(result["results"]["avoided_grid_cost"]["value_eur"]) == Decimal("0.612")
    assert Decimal(result["results"]["solar_economic_value"]["value_eur"]) == Decimal("0.780")
    assert Decimal(result["results"]["net_variable_energy_position"]["value_eur"]) == Decimal("0.100")
    assert result["exclusions"] == ["base_price_not_avoidable"]


def test_zero_is_available_and_missing_tariff_is_not_zero():
    zero = economy.calculate_period(basis(solar="0", imported="0", exported="0"), tariffs())
    assert zero["results"]["solar_economic_value"]["value_eur"] == "0.00"
    missing = economy.calculate_period(basis(), tariffs()[:1])
    assert missing["results"]["feed_in_remuneration"]["value_eur"] is None
    assert missing["results"]["solar_economic_value"]["value_eur"] is None


def test_provisional_tariff_lowers_confidence_without_changing_arithmetic():
    result = economy.calculate_period(basis(), tariffs(provisional=True))
    assert result["provisional"] is True
    assert result["results"]["feed_in_remuneration"]["value_eur"] == "0.168"


def test_incompatible_energy_bases_and_real_negative_self_consumption_are_withheld():
    mixed = basis()
    mixed["grid_export"]["source"] = "integrated_power_history"
    result = economy.calculate_period(mixed, tariffs())
    assert result["results"]["avoided_grid_cost"]["value_eur"] is None
    assert result["energy_basis"]["direct_self_consumption"]["reason"] == "incompatible_or_unavailable_energy_basis"
    inconsistent = economy.calculate_period(basis(solar="1", exported="1.1"), tariffs())
    assert inconsistent["energy_basis"]["direct_self_consumption"]["value_kwh"] is None
    assert inconsistent["energy_basis"]["direct_self_consumption"]["reason"] == "pv_lower_than_export"


def test_tiny_decimal_noise_is_clamped_only_at_defined_epsilon():
    result = economy.calculate_period(basis(solar="1.0000000", exported="1.0000001"), tariffs())
    assert result["energy_basis"]["direct_self_consumption"]["value_kwh"] == "0"


def test_partial_is_calculated_but_sparse_and_unavailable_are_withheld():
    partial = economy.calculate_period(basis(coverage="partial"), tariffs())
    assert partial["coverage_state"] == "partial"
    assert partial["results"]["solar_economic_value"]["value_eur"] is not None
    sparse = economy.calculate_period(basis(coverage="sparse"), tariffs())
    assert sparse["coverage_state"] == "unavailable"
    assert sparse["results"]["solar_economic_value"]["value_eur"] is None
    unavailable = economy.calculate_period(basis(solar=None, imported=None, exported=None, coverage="unavailable"), tariffs())
    assert unavailable["results"]["grid_import_cost"]["value_eur"] is None


def test_tariff_boundary_inside_period_is_not_silently_blended():
    spanning = basis()
    spanning["period"]["local_date_from"] = "2026-06-30"
    spanning["period"]["local_date_to"] = "2026-07-01"
    records = tariffs()
    records[0]["valid_until"] = "2026-06-30"
    records.append({**records[0], "id": 4, "valid_from": "2026-07-01", "valid_until": None, "value_ct_per_kwh": "36"})
    result = economy.calculate_period(spanning, records)
    assert result["results"]["grid_import_cost"]["value_eur"] is None
    assert result["results"]["avoided_grid_cost"]["reason"] == "grid_tariff_missing_or_boundary"


def test_decimal_precision_and_dst_local_day_metadata_are_preserved():
    precise = basis(solar="1.0003", imported="0.1001", exported="0.0002")
    precise["period"].update({"from": "2026-03-29T00:00:00+01:00", "to": "2026-03-29T23:59:59+02:00", "local_date_from": "2026-03-29", "local_date_to": "2026-03-29"})
    result = economy.calculate_period(precise, tariffs())
    assert result["results"]["grid_import_cost"]["value_eur"] == "0.034034"
    assert result["period"]["from"].endswith("+01:00") and result["period"]["to"].endswith("+02:00")


def test_coverage_thresholds_are_deterministic():
    assert economy.coverage_state("0") == "unavailable"
    assert economy.coverage_state("0.49") == "sparse"
    assert economy.coverage_state("0.50") == "partial"
    assert economy.coverage_state("0.90") == "complete"
