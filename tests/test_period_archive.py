"""Archive-backed period curve + PV total, and their integration into the
authoritative period report."""
from __future__ import annotations

from datetime import datetime, timezone
import sqlite3

import pytest

from energyradar import config
from energyradar.services import migration, storage, period_archive
from energyradar.ui import viewmodels


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "MT175_TIMEZONE", "Europe/Berlin")
    monkeypatch.setattr(storage, "_MIGRATED", False)
    migration.run_migrations()
    return path


def _src(con):
    con.execute("""INSERT INTO provider_archive_sources (provider, device_key, first_seen_utc)
                   VALUES ('fronius_local_archive','inverter/1','2026-08-03T00:00:00Z')""")
    con.execute("""INSERT INTO provider_archive_imports
                   (source_id, requested_from_utc, requested_to_utc, started_at_utc, status, idempotency_key)
                   VALUES (1,'2026-08-03T00:00:00Z','2026-08-03T23:59:59Z','2026-08-03T00:00:00Z','complete','k1')""")
    return 1, 1


def _apoint(con, sid, iid, channel, observed, value, kind, unit):
    con.execute("""INSERT INTO provider_archive_points
        (source_id, import_id, channel, observed_at_utc, interval_seconds, value_decimal, unit, measurement_kind, dedupe_key)
        VALUES (?,?,?,?,300,?,?,?,?)""",
        (sid, iid, channel, observed, str(value), unit, kind, f"{sid}|{channel}|{observed}"))


def _sample(con, measured_at, pv_w):
    con.execute("""INSERT INTO energy_samples_v1
        (measured_at, received_at, pv_power_w, pv_quality_status, grid_quality_status, sample_quality_status)
        VALUES (?,?,?,'valid','valid','valid')""", (measured_at, measured_at, pv_w))


def _dt(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def test_archive_pv_energy_sums_interval_totals(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced", "2026-08-03T09:00:00Z", 500.0, "interval_total", "Wh")
    _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced", "2026-08-03T09:05:00Z", 700.0, "interval_total", "Wh")
    # A power point that must NOT be summed into energy.
    _apoint(con, sid, iid, "PowerReal_PAC_Sum", "2026-08-03T09:00:00Z", 6000.0, "interval_average", "W")
    con.commit()
    out = period_archive.archive_pv_energy(con, _dt("2026-08-03T00:00:00+00:00"), _dt("2026-08-03T23:59:59+00:00"))
    con.close()
    assert out["value_kwh"] == 1.2  # (500+700)/1000, power ignored
    assert out["provenance"] == "fronius_local_archive"
    assert out["n_points"] == 2


def test_curve_archive_only(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    for t, w in [("2026-08-03T09:00:00Z", 6000.0), ("2026-08-03T09:05:00Z", 6500.0)]:
        _apoint(con, sid, iid, "PowerReal_PAC_Sum", t, w, "interval_average", "W")
    con.commit()
    curve = period_archive.build_period_curve(con, _dt("2026-08-03T00:00:00+00:00"), _dt("2026-08-03T23:59:59+00:00"))
    con.close()
    assert curve["source"] == "fronius_archive"
    assert curve["n_points"] == 2 and curve["n_archive"] == 2 and curve["n_local"] == 0
    assert curve["mixed_source"] is False


def test_curve_mixed_dedupes_overlap_local_wins(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    # Local sample at 09:00; archive at 09:00 (overlap → dropped) and 12:00 (kept).
    _sample(con, "2026-08-03 09:00:00", 5900.0)
    _apoint(con, sid, iid, "PowerReal_PAC_Sum", "2026-08-03T09:00:30Z", 6000.0, "interval_average", "W")
    _apoint(con, sid, iid, "PowerReal_PAC_Sum", "2026-08-03T12:00:00Z", 8000.0, "interval_average", "W")
    con.commit()
    curve = period_archive.build_period_curve(con, _dt("2026-08-03T00:00:00+00:00"), _dt("2026-08-03T23:59:59+00:00"))
    con.close()
    assert curve["source"] == "mixed" and curve["mixed_source"] is True
    assert curve["n_points"] == 2  # overlapping archive point dropped
    assert curve["n_local"] == 1 and curve["n_archive"] == 1
    # source boundary retained
    assert [s["source"] for s in curve["segments"]] == ["local", "fronius_archive"]


def test_build_period_report_archive_only_is_visible(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced", "2026-08-03T09:00:00Z", 500.0, "interval_total", "Wh")
    _apoint(con, sid, iid, "PowerReal_PAC_Sum", "2026-08-03T09:00:00Z", 6000.0, "interval_average", "W")
    con.commit()
    con.close()
    vm = viewmodels.build_period_report("2026-08-03T00:00:00Z", "2026-08-03T23:59:59Z")
    assert vm["has_curve"] is True
    assert vm["has_records"] is True
    assert vm["provenance"] == "fronius_local_archive"
    assert vm["metrics"]["pv_generation"]["value_kwh"] == 0.5
    assert vm["metrics"]["pv_generation"]["provenance"] == "fronius_local_archive"
    assert vm["curve"]["source"] == "fronius_archive"


def test_build_period_report_grid_is_never_archive_filled(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced", "2026-08-03T09:00:00Z", 500.0, "interval_total", "Wh")
    con.commit()
    con.close()
    vm = viewmodels.build_period_report("2026-08-03T00:00:00Z", "2026-08-03T23:59:59Z")
    # PV filled from archive; grid stays unavailable (meter/counter truth only).
    assert vm["metrics"]["pv_generation"]["value_kwh"] == 0.5
    assert vm["metrics"]["grid_import"]["value_kwh"] is None
    assert vm["metrics"]["grid_export"]["value_kwh"] is None
