from datetime import date
import sqlite3

import pytest

from energyradar import config
from energyradar.services import tariffs


@pytest.fixture
def tariff_db(tmp_path, monkeypatch):
    path = tmp_path / "economy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    return path


def record(**overrides):
    value = {
        "tariff_type": "grid_work_price",
        "value_ct_per_kwh": "34.00",
        "annual_eur": None,
        "valid_from": "2026-01-01",
        "valid_until": "2026-06-30",
        "label": "ENTEGA Ökostrom fix 24",
        "source_type": "invoice",
        "provisional": False,
    }
    value.update(overrides)
    return value


def test_create_update_delete_and_decimal_text_storage(tariff_db):
    created = tariffs.create_record(record())
    assert created["value_ct_per_kwh"] == "34"
    assert created["provisional"] is False
    updated = tariffs.update_record(created["id"], record(value_ct_per_kwh="34.1250"))
    assert updated["value_ct_per_kwh"] == "34.125"
    with sqlite3.connect(tariff_db) as con:
        assert con.execute("SELECT typeof(value_ct_per_kwh) FROM tariff_periods").fetchone()[0] == "text"
    assert tariffs.delete_record(created["id"]) is True
    assert tariffs.list_records() == []


def test_overlap_is_rejected_but_adjacent_inclusive_dates_are_allowed(tariff_db):
    tariffs.create_record(record())
    with pytest.raises(tariffs.TariffOverlapError):
        tariffs.create_record(record(valid_from="2026-06-30", valid_until="2026-12-31"))
    adjacent = tariffs.create_record(record(valid_from="2026-07-01", valid_until=None, label=None))
    assert adjacent["valid_until"] is None


def test_exact_boundary_and_historical_selection(tariff_db):
    old = tariffs.create_record(record())
    new = tariffs.create_record(record(valid_from="2026-07-01", valid_until=None, value_ct_per_kwh="36"))
    assert tariffs.record_at("grid_work_price", date(2026, 6, 30))["id"] == old["id"]
    assert tariffs.record_at("grid_work_price", date(2026, 7, 1))["id"] == new["id"]
    assert tariffs.record_at("feed_in_tariff", date(2026, 7, 1)) is None


def test_provisional_open_ended_feed_in_tariff(tariff_db):
    created = tariffs.create_record(record(
        tariff_type="feed_in_tariff", value_ct_per_kwh="12.00",
        valid_until=None, source_type="provisional_user_assumption", provisional=True,
    ))
    assert created["provisional"] is True
    assert tariffs.record_at("feed_in_tariff", date(2030, 1, 1))["id"] == created["id"]


def test_provisional_source_cannot_be_presented_as_confirmed(tariff_db):
    created = tariffs.create_record(record(
        tariff_type="feed_in_tariff", value_ct_per_kwh="12",
        source_type="provisional_user_assumption", provisional=False,
    ))
    assert created["provisional"] is True


def test_base_price_requires_annual_value_and_keeps_rate_null(tariff_db):
    created = tariffs.create_record(record(
        tariff_type="base_price", value_ct_per_kwh=None, annual_eur="120.00",
    ))
    assert created["annual_eur"] == "120"
    assert created["value_ct_per_kwh"] is None


def test_base_price_history_update_overlap_boundaries_and_open_end(tariff_db):
    old = tariffs.create_record(record(
        tariff_type="base_price", value_ct_per_kwh=None, annual_eur="120.00",
        valid_until="2026-06-30",
    ))
    updated = tariffs.update_record(old["id"], record(
        tariff_type="base_price", value_ct_per_kwh=None, annual_eur="121.50",
        valid_until="2026-06-30",
    ))
    assert updated["annual_eur"] == "121.5"
    with pytest.raises(tariffs.TariffOverlapError):
        tariffs.create_record(record(
            tariff_type="base_price", value_ct_per_kwh=None, annual_eur="130",
            valid_from="2026-06-30", valid_until=None,
        ))
    current = tariffs.create_record(record(
        tariff_type="base_price", value_ct_per_kwh=None, annual_eur="130",
        valid_from="2026-07-01", valid_until=None,
    ))
    assert tariffs.record_at("base_price", date(2026, 6, 30))["id"] == old["id"]
    assert tariffs.record_at("base_price", date(2026, 7, 1))["id"] == current["id"]
    assert tariffs.record_at("base_price", date(2030, 1, 1))["id"] == current["id"]


def test_zero_and_provisional_base_price_are_preserved(tariff_db):
    created = tariffs.create_record(record(
        tariff_type="base_price", value_ct_per_kwh=None, annual_eur="0",
        valid_until=None, provisional=True,
    ))
    assert created["annual_eur"] == "0"
    assert created["provisional"] is True
