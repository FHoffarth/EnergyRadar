"""R1 — authoritative period service: stored-sample-counter fallback.

Proves the fix for "Memory/Reports say no data while rows exist": when no
synchronized anchor pair covers a period, `calculate_period` derives a truthful,
lower-confidence summary from the *real cumulative counters* stored in
energy_samples_v1 — never from integrated power, never inventing a curve, and
never overriding a valid anchor.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import sqlite3

import pytest

from energyradar import config
from energyradar.services import migration, storage
from energyradar.services.periods import calculate_period
from energyradar.services.recorder import AnchorCapture, CounterRecorder, SourceCapture
from energyradar.ui import viewmodels


@pytest.fixture
def sample_db(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(config, "MT175_TIMEZONE", "Europe/Berlin")
    monkeypatch.setattr(config, "SITE_TOPOLOGY", "battery_free_single_pv")
    monkeypatch.setattr(storage, "_MIGRATED", False)
    migration.run_migrations()
    return path


def _insert(path, measured_at, *, pv_today=None, imp=None, exp=None, pv_power=None):
    con = sqlite3.connect(path)
    try:
        con.execute(
            """INSERT INTO energy_samples_v1
               (measured_at, received_at, pv_power_w, pv_energy_today_wh,
                grid_import_total_wh, grid_export_total_wh,
                pv_quality_status, grid_quality_status, sample_quality_status)
               VALUES (?, ?, ?, ?, ?, ?, 'valid', 'valid', 'valid')""",
            (measured_at, measured_at, pv_power, pv_today, imp, exp),
        )
        con.commit()
    finally:
        con.close()


def _utc(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


def test_grid_lifetime_counter_delta_is_exact(sample_db):
    _insert(sample_db, "2026-07-20 08:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-22 08:00:00", imp=1_050_000.0, exp=2_030_000.0)

    report = calculate_period(_utc(2026, 7, 20, 0), _utc(2026, 7, 23, 0))
    m = report["metrics"]

    assert m["grid_import"]["value_kwh"] == "50"
    assert m["grid_export"]["value_kwh"] == "30"
    assert m["grid_import"]["source"] == "stored_sample_counter_delta"
    assert m["grid_import"]["provenance"] == "stored_sample_counters"
    assert m["grid_import"]["coverage_state"] == "partial"
    assert report["source_precedence"] == "stored_sample_counters"
    assert report["start_anchor"] is None


def test_pv_daily_counter_summed_per_local_day(sample_db):
    # Single Europe/Berlin day (CEST = UTC+2): 09:00 → 17:00 local.
    _insert(sample_db, "2026-07-21 07:00:00", pv_today=1_000.0)
    _insert(sample_db, "2026-07-21 15:00:00", pv_today=6_000.0)

    report = calculate_period(_utc(2026, 7, 21, 0), _utc(2026, 7, 22, 0))
    pv = report["metrics"]["pv_generation"]

    assert pv["value_kwh"] == "5"
    assert pv["source"] == "stored_sample_counter_delta"


def test_house_balance_from_fallback_when_battery_free(sample_db):
    _insert(sample_db, "2026-07-21 07:00:00", pv_today=1_000.0)
    _insert(sample_db, "2026-07-21 15:00:00", pv_today=41_000.0, imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-21 16:00:00", imp=1_030_000.0, exp=2_010_000.0)

    report = calculate_period(_utc(2026, 7, 21, 0), _utc(2026, 7, 22, 0))
    m = report["metrics"]
    # pv 40, import 30, export 10 → house = 40 + 30 - 10 = 60; direct = 40 - 10 = 30
    assert m["pv_generation"]["value_kwh"] == "40"
    assert m["grid_import"]["value_kwh"] == "30"
    assert m["grid_export"]["value_kwh"] == "10"
    assert m["house_consumption"]["value_kwh"] == "60"
    assert m["direct_self_consumption"]["value_kwh"] == "30"


def test_negative_counter_delta_is_rejected_not_fabricated(sample_db):
    # A valid export pair keeps the period in the fallback branch so the precise
    # reset reason for the import register is surfaced rather than collapsed.
    _insert(sample_db, "2026-07-20 08:00:00", imp=1_050_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-22 08:00:00", imp=1_000_000.0, exp=2_010_000.0)  # import decreased → reset

    report = calculate_period(_utc(2026, 7, 20, 0), _utc(2026, 7, 23, 0))
    m = report["metrics"]["grid_import"]
    assert m["value_kwh"] is None
    assert "reset_or_negative_delta" in m["reason"]
    # The healthy export register still reports its exact delta alongside.
    assert report["metrics"]["grid_export"]["value_kwh"] == "10"


def test_power_only_rows_yield_no_factual_kwh(sample_db):
    # Curve exists (power), but no cumulative counters → periods must not invent kWh.
    _insert(sample_db, "2026-07-21 10:00:00", pv_power=1200.0)
    _insert(sample_db, "2026-07-21 11:00:00", pv_power=1500.0)

    report = calculate_period(_utc(2026, 7, 21, 0), _utc(2026, 7, 22, 0))
    assert all(report["metrics"][name]["value_kwh"] is None for name in report["metrics"])
    # And with no usable counters the honest verdict is still "no data yet".
    assert report["metrics"]["grid_import"]["reason"] == "two_compatible_anchors_required"


def test_no_false_no_data_when_stored_counters_exist(sample_db):
    _insert(sample_db, "2026-07-20 08:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-22 08:00:00", imp=1_050_000.0, exp=2_030_000.0)

    report = calculate_period(_utc(2026, 7, 20, 0), _utc(2026, 7, 23, 0))
    values = [report["metrics"][n]["value_kwh"] for n in report["metrics"]]
    assert any(v is not None for v in values)
    assert report["actual_period"] is not None


def test_yesterday_range_returns_stored_grid_data(sample_db):
    _insert(sample_db, "2026-07-21 06:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-21 20:00:00", imp=1_012_000.0, exp=2_004_000.0)

    report = calculate_period(_utc(2026, 7, 21, 0), _utc(2026, 7, 22, 0))
    assert report["metrics"]["grid_import"]["value_kwh"] == "12"
    assert report["metrics"]["grid_export"]["value_kwh"] == "4"


def test_anchors_are_preferred_over_stored_sample_counters(sample_db):
    # Both stored counters AND two anchors exist; anchor value must win.
    _insert(sample_db, "2026-07-21 07:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-21 15:00:00", imp=9_999_999.0, exp=9_999_999.0)

    at0 = _utc(2026, 7, 21, 8)
    at1 = _utc(2026, 7, 21, 14)
    rec = CounterRecorder(now=lambda: at0)
    rec.start_run()

    def sources(at, imp, exp):
        return (
            SourceCapture("pv-1", "fronius", "PV", at, at, "success", {"pv_total": "0"}, "E_Total"),
            SourceCapture(
                "grid-1", "tasmota", "Grid", at, at, "success",
                {"grid_import_total": imp, "grid_export_total": exp}, "meter-registers",
            ),
        )

    rec.record_anchor(AnchorCapture("test", at0, at0, sources(at0, "100", "200"), "k0"))
    rec.record_anchor(AnchorCapture("test", at1, at1, sources(at1, "101.5", "203.9"), "k1"))

    report = calculate_period(_utc(2026, 7, 21, 0), _utc(2026, 7, 22, 0))
    imp_metric = report["metrics"]["grid_import"]
    # Anchor delta 101.5 - 100 = 1.5, NOT the sample delta.
    assert imp_metric["value_kwh"] == "1.5"
    assert imp_metric["source"] == "counter_anchor_delta"
    assert report.get("source_precedence") is None


def test_build_period_report_surfaces_stored_summary(sample_db):
    _insert(sample_db, "2026-07-20 08:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-22 08:00:00", imp=1_050_000.0, exp=2_030_000.0)

    vm = viewmodels.build_period_report("2026-07-20T00:00:00Z", "2026-07-23T00:00:00Z")

    assert vm["has_records"] is True
    assert vm["has_summary"] is True
    assert vm["provenance"] == "stored_sample_counters"
    assert vm["metrics"]["grid_import"]["value_kwh"] == 50.0
    assert vm["metrics"]["grid_import"]["source"] == "stored_sample_counter_delta"
    assert vm["resolved_period"] is not None


def test_build_period_report_reports_true_emptiness_distinctly(sample_db):
    vm = viewmodels.build_period_report("2026-07-20T00:00:00Z", "2026-07-23T00:00:00Z")

    assert vm["has_records"] is False
    assert vm["has_summary"] is False
    assert vm["provenance"] is None
    assert all(vm["metrics"][name]["value_kwh"] is None for name in vm["metrics"])


def test_memory_and_report_agree_for_identical_period(sample_db):
    from energyradar.services import reporting_data

    _insert(sample_db, "2026-07-20 08:00:00", imp=1_000_000.0, exp=2_000_000.0)
    _insert(sample_db, "2026-07-22 08:00:00", imp=1_050_000.0, exp=2_030_000.0)

    frm = _utc(2026, 7, 20, 0)
    to = _utc(2026, 7, 23, 0)

    memory = viewmodels.build_period_report(frm.isoformat(), to.isoformat())
    report = reporting_data.get_report_data(frm, to, "Testzeitraum")

    # Same authoritative period contract → the same factual totals (report rounds
    # to 2 decimals). Memory and the export cannot disagree for identical bounds.
    assert report.summary.grid_import_kwh == round(memory["metrics"]["grid_import"]["value_kwh"], 2)
    assert report.summary.grid_export_kwh == round(memory["metrics"]["grid_export"]["value_kwh"], 2)
