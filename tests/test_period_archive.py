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


def test_today_vm_uses_archive_pv_so_it_agrees_with_memory(db):
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(config.MT175_TIMEZONE)
    now = datetime.now(tz)
    # An archive energy point earlier today (local), before "now".
    point = (now.astimezone(timezone.utc) - __import__("datetime").timedelta(minutes=30))
    if point.astimezone(tz).date() != now.date():
        pytest.skip("run crosses local midnight")
    observed = point.strftime("%Y-%m-%dT%H:%M:%SZ")
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced", observed, 800.0, "interval_total", "Wh")
    con.commit()
    con.close()
    vm = viewmodels.build_today_vm_from_anchors(fronius=None, mt175=None)
    assert vm.generated_kwh == 0.8  # archive interval energy, same as Memory would show


def _pts(n, source="local", base_ts=0.0, step=60.0):
    return [{"t": f"p{i}", "ts": base_ts + i * step, "solar_w": float(i % 7), "grid_w": None, "source": source}
            for i in range(n)]


def test_downsample_bounds_points_and_keeps_endpoints():
    pts = _pts(5000)
    out = period_archive.downsample_curve(pts, 600)
    assert len(out) <= 600
    assert out[0] is pts[0] and out[-1] is pts[-1]           # first/last kept
    assert all(p in pts for p in out)                         # no invented points


def test_downsample_preserves_extrema():
    pts = _pts(2000)
    pts[1234]["solar_w"] = 99999.0   # a spike
    pts[1235]["solar_w"] = -50.0     # a trough
    out = period_archive.downsample_curve(pts, 400)
    vals = [p["solar_w"] for p in out]
    assert 99999.0 in vals and -50.0 in vals


def test_downsample_preserves_source_and_gap_boundaries():
    a = _pts(500, source="local", base_ts=0.0, step=60.0)
    b = _pts(500, source="fronius_archive", base_ts=500 * 60.0 + 3600, step=300.0)  # 1h gap + source change
    pts = a + b
    out = period_archive.downsample_curve(pts, 200)
    # both sides of the source-change / gap survive
    assert any(p["source"] == "local" for p in out) and any(p["source"] == "fronius_archive" for p in out)
    assert a[-1] in out and b[0] in out


def test_downsample_noop_when_under_budget():
    pts = _pts(300)
    assert period_archive.downsample_curve(pts, 600) is pts


def test_build_period_curve_totals_unaffected_by_downsampling(db):
    con = sqlite3.connect(db)
    sid, iid = _src(con)
    for i in range(400):
        _apoint(con, sid, iid, "EnergyReal_WAC_Sum_Produced",
                f"2026-08-03T{(3 + i // 60):02d}:{i % 60:02d}:00Z", 10.0, "interval_total", "Wh")
    con.commit()
    pv = period_archive.archive_pv_energy(con, _dt("2026-08-03T00:00:00+00:00"), _dt("2026-08-03T23:59:59+00:00"))
    con.close()
    assert pv["value_kwh"] == 4.0  # 400 * 10 Wh, independent of any curve downsampling


def test_house_derived_over_compatible_period():
    d = period_archive.derive_house_consumption(
        12.81, 2.29, 9.21,
        archive_pv={"first": "2026-08-03T03:30:00Z", "last": "2026-08-03T19:15:00Z"},
        resolved_period={"from": "2026-08-02T23:36:00Z", "to": "2026-08-03T19:27:00Z"})
    assert round(d["value_kwh"], 2) == 5.89
    assert d["source"] == "derived_compatible_energy" and d["reason"] is None


def test_house_incompatible_pv_before_grid_gives_precise_reason():
    d = period_archive.derive_house_consumption(
        12.81, 2.29, 9.21,
        archive_pv={"first": "2026-08-03T00:00:00Z", "last": "2026-08-03T19:15:00Z"},
        resolved_period={"from": "2026-08-03T10:00:00Z", "to": "2026-08-03T19:27:00Z"})
    assert d["value_kwh"] is None
    assert d["reason"] == "pv_window_starts_before_grid_period"
    assert "vor dem ausgewerteten Netzzeitraum" in d["detail"]


def test_house_missing_dependency_names_it():
    d = period_archive.derive_house_consumption(12.81, None, 9.21, archive_pv=None, resolved_period=None)
    assert d["value_kwh"] is None
    assert "Netzbezug" in d["detail"]


def test_house_negative_balance_rejected():
    d = period_archive.derive_house_consumption(
        1.0, 0.0, 9.21,
        archive_pv={"first": "2026-08-03T03:30:00Z", "last": "2026-08-03T19:15:00Z"},
        resolved_period={"from": "2026-08-03T03:00:00Z", "to": "2026-08-03T19:27:00Z"})
    assert d["value_kwh"] is None and d["reason"] == "house_balance_negative"


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
