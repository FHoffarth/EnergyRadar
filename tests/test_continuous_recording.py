from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import sqlite3
import threading
import inspect
from zoneinfo import ZoneInfo

import pytest

from energyradar import config
from energyradar.models.energy import EnergyReading
from energyradar.models.mt175 import MT175Reading
from energyradar.services import migration, storage
from energyradar.services.periods import calculate_period
from energyradar.services.periods import economy_basis
from energyradar.services.economy import calculate_period as calculate_economy
from energyradar.services.projection import CurrentStateProjection
from energyradar.services.recorder import AnchorCapture, CounterRecorder, SourceCapture
from energyradar.services.runtime import EnergyRuntime
from energyradar.services.scheduler import BackendScheduler


@pytest.fixture
def anchor_db(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DEMO", False)
    monkeypatch.setattr(storage, "_MIGRATED", False)
    migration.run_migrations()
    return path


def source_captures(at, *, pv="100", imported="200", exported="300", pv_id="pv-1", grid_id="grid-1"):
    return (
        SourceCapture(pv_id, "fronius", "PV", at, at, "success", {"pv_total": pv}, "E_Total"),
        SourceCapture(grid_id, "tasmota", "Grid", at, at, "success", {"grid_import_total": imported, "grid_export_total": exported}, "meter-registers"),
    )


def record(recorder, at, key, **values):
    return recorder.record_anchor(AnchorCapture("test", at, at, source_captures(at, **values), key))


def test_exact_anchor_delta_survives_six_hour_sample_gap(anchor_db):
    start = datetime(2026, 3, 1, 8, tzinfo=timezone.utc)
    end = start + timedelta(hours=6)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "start")
    record(recorder, end, "end", pv="106.12", imported="201.41", exported="303.93")

    report = calculate_period(start, end)

    assert report["metrics"]["pv_generation"]["value_kwh"] == "6.12"
    assert report["metrics"]["grid_import"]["value_kwh"] == "1.41"
    assert report["metrics"]["grid_export"]["value_kwh"] == "3.93"
    assert report["metrics"]["direct_self_consumption"]["value_kwh"] == "2.19"
    assert report["metrics"]["house_consumption"]["value_kwh"] == "3.60"
    assert report["gaps"] == []

    economy = calculate_economy(economy_basis(report, timezone_name="Europe/Berlin"), [
        {"id": 1, "tariff_type": "grid_work_price", "value_ct_per_kwh": "34", "valid_from": "2026-01-01", "valid_until": None, "source_type": "contract", "provisional": False},
        {"id": 2, "tariff_type": "feed_in_tariff", "value_ct_per_kwh": "12", "valid_from": "2014-01-01", "valid_until": None, "source_type": "contract", "provisional": False},
    ])
    assert economy["energy_basis"]["direct_self_consumption"]["value_kwh"] == "2.19"
    assert economy["results"]["avoided_grid_cost"]["value_eur"] == "0.7446"
    assert economy["results"]["feed_in_remuneration"]["value_eur"] == "0.4716"
    assert economy["results"]["solar_economic_value"]["value_eur"] == "1.2162"


def test_first_anchor_is_no_data_yet_and_zero_delta_remains_zero(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "first")
    assert calculate_period(start, start + timedelta(hours=1))["metrics"]["pv_generation"]["state"] == "no_data_yet"
    end = start + timedelta(hours=1)
    record(recorder, end, "second")
    metric = calculate_period(start, end)["metrics"]["pv_generation"]
    assert metric["value_kwh"] == "0"
    assert metric["state"] == "zero"
    assert metric["coverage_state"] == "complete"


def test_partial_anchor_preserves_independent_pv_metric(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "start")
    partial = (SourceCapture("pv-1", "fronius", "PV", end, end, "success", {"pv_total": "101.5"}, "E_Total"),)
    recorder.record_anchor(AnchorCapture("test", end, end, partial, "partial"))
    report = calculate_period(start, end)
    assert report["metrics"]["pv_generation"]["value_kwh"] == "1.5"
    assert report["metrics"]["grid_import"]["value_kwh"] is None
    assert report["metrics"]["house_consumption"]["value_kwh"] is None


def test_missing_import_does_not_block_compatible_pv_minus_export(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "direct-start")
    end_sources = (
        SourceCapture("pv-1", "fronius", "PV", end, end, "success", {"pv_total": "106.12"}, "E_Total"),
        SourceCapture("grid-1", "tasmota", "Grid", end, end, "partial", {"grid_export_total": "303.93"}, "meter-registers"),
    )
    recorder.record_anchor(AnchorCapture("test", end, end, end_sources, "direct-end"))
    report = calculate_period(start, end)
    assert report["metrics"]["grid_import"]["value_kwh"] is None
    assert report["metrics"]["house_consumption"]["value_kwh"] is None
    assert report["metrics"]["direct_self_consumption"]["value_kwh"] == "2.19"


def test_counter_reset_splits_epoch_and_period_is_rejected(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "start", pv="100")
    record(recorder, end, "reset", pv="2")
    metric = calculate_period(start, end)["metrics"]["pv_generation"]
    assert metric["state"] == "counter_reset"
    assert metric["reason"] == "pv_total_counter_epoch_changed"


def test_source_change_and_topology_are_not_silently_combined(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "start")
    record(recorder, end, "end", pv="101", pv_id="pv-2")
    report = calculate_period(start, end)
    assert report["metrics"]["pv_generation"]["state"] == "incompatible_period"
    unsupported = calculate_period(start, end, topology="battery_present")
    assert unsupported["metrics"]["house_consumption"]["state"] == "metric_unsupported"


def test_anchor_retry_is_idempotent_and_transaction_rolls_back(anchor_db):
    at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    recorder = CounterRecorder(now=lambda: at)
    recorder.start_run()
    capture = AnchorCapture("test", at, at, source_captures(at), "same")
    first = recorder.record_anchor(capture)
    assert recorder.record_anchor(capture) == first
    with pytest.raises(RuntimeError, match="injected"):
        recorder.record_anchor(AnchorCapture("test", at, at, source_captures(at), "rollback"), fail_after_anchor=True)
    with sqlite3.connect(anchor_db) as con:
        assert con.execute("SELECT COUNT(*) FROM counter_anchors").fetchone()[0] == 1
        assert con.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_wal_writer_allows_concurrent_readers(anchor_db):
    at = datetime(2026, 3, 1, tzinfo=timezone.utc)
    recorder = CounterRecorder(now=lambda: at)
    recorder.start_run()
    failures = []

    def reader():
        try:
            for _ in range(20):
                with sqlite3.connect(anchor_db, timeout=1) as con:
                    con.execute("SELECT COUNT(*) FROM counter_anchors").fetchone()
        except Exception as exc:  # pragma: no cover - diagnostic
            failures.append(exc)

    threads = [threading.Thread(target=reader) for _ in range(4)]
    for thread in threads:
        thread.start()
    for index in range(10):
        moment = at + timedelta(minutes=index)
        recorder.record_anchor(AnchorCapture("test", moment, moment, source_captures(moment, pv=str(100 + index)), f"a{index}"))
    for thread in threads:
        thread.join()
    assert failures == []


class _ManualScheduler:
    def __init__(self):
        self.tasks = {}
        self.started = False

    def add_task(self, name, cadence, callback, **_):
        self.tasks[name] = callback

    def start(self):
        if self.started:
            return False
        self.started = True
        return True

    def trigger(self, name):
        self.tasks[name]()

    def stop(self):
        self.started = False


def test_backend_runtime_records_without_ui_request_and_one_poll_fans_out(anchor_db, monkeypatch):
    at = datetime(2026, 3, 1, 10, tzinfo=timezone.utc)
    calls = {"pv": 0, "grid": 0}

    def pv_read():
        calls["pv"] += 1
        return EnergyReading(at, 1200, Decimal("1000"), None, Decimal("500000"))

    def grid_read(_address):
        calls["grid"] += 1
        return MT175Reading(at, at, Decimal("200"), Decimal("300"), -100, None, None, None, "meter-1", "MT631", False)

    monkeypatch.setattr("energyradar.services.runtime.data_source.effective", lambda: {"url": "http://pv.local", "source": "saved"})
    monkeypatch.setattr("energyradar.services.runtime.ui_settings.resolve_effective", lambda: {"refresh_seconds": 5, "mt175_address": "meter.local"})
    scheduler = _ManualScheduler()
    projection = CurrentStateProjection()
    runtime = EnergyRuntime(scheduler=scheduler, recorder=CounterRecorder(now=lambda: at), projection=projection, now=lambda: at, monotonic=lambda: 10.0, fronius_read=pv_read, meter_read=grid_read)

    assert runtime.start() is True
    assert runtime.start() is False
    scheduler.tasks["energy"]()

    assert calls == {"pv": 1, "grid": 1}
    assert projection.snapshot().fronius.reading.power == 1200
    with sqlite3.connect(anchor_db) as con:
        assert con.execute("SELECT COUNT(*) FROM counter_anchors").fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM counter_readings").fetchone()[0] == 3
    runtime.stop()


def test_demo_runtime_never_writes_counter_rows(anchor_db, monkeypatch):
    at = datetime(2026, 3, 1, 10, tzinfo=timezone.utc)
    monkeypatch.setattr(config, "DEMO", True)
    monkeypatch.setattr("energyradar.services.runtime.ui_settings.resolve_effective", lambda: {"refresh_seconds": 5, "mt175_address": ""})
    runtime = EnergyRuntime(scheduler=_ManualScheduler(), recorder=CounterRecorder(now=lambda: at), now=lambda: at, monotonic=lambda: 1.0)
    runtime.start()
    runtime.scheduler.tasks["energy"]()
    with sqlite3.connect(anchor_db) as con:
        assert con.execute("SELECT COUNT(*) FROM counter_anchors").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM counter_readings").fetchone()[0] == 0
    runtime.stop()


def test_restart_projection_is_stale_until_a_fresh_poll(anchor_db, monkeypatch):
    observed = datetime(2026, 3, 1, 9, tzinfo=timezone.utc)
    storage.save_sample(
        measured_at=observed,
        received_at=observed,
        pv=EnergyReading(observed, 900, Decimal("1000"), None, Decimal("500000")),
        mt175=None,
    )
    monkeypatch.setattr("energyradar.services.runtime.data_source.effective", lambda: None)
    monkeypatch.setattr("energyradar.services.runtime.ui_settings.resolve_effective", lambda: {"refresh_seconds": 5, "mt175_address": ""})
    projection = CurrentStateProjection()
    runtime = EnergyRuntime(
        scheduler=_ManualScheduler(),
        recorder=CounterRecorder(now=lambda: observed + timedelta(minutes=10)),
        projection=projection,
        now=lambda: observed + timedelta(minutes=10),
        monotonic=lambda: 1.0,
    )

    runtime.start()

    snapshot = projection.snapshot().fronius
    assert snapshot.reading.power == 900
    assert snapshot.health == "stale"
    runtime.stop()


def test_suspend_timing_evidence_records_host_gap(anchor_db, monkeypatch):
    wall = [datetime(2026, 3, 1, 10, tzinfo=timezone.utc)]
    mono = [10.0]
    monkeypatch.setattr("energyradar.services.runtime.data_source.effective", lambda: None)
    monkeypatch.setattr("energyradar.services.runtime.ui_settings.resolve_effective", lambda: {"refresh_seconds": 5, "mt175_address": ""})
    runtime = EnergyRuntime(
        scheduler=_ManualScheduler(), recorder=CounterRecorder(now=lambda: wall[0]),
        now=lambda: wall[0], monotonic=lambda: mono[0],
    )
    runtime.start()
    runtime.poll_once()
    wall[0] += timedelta(hours=1)
    mono[0] += 5
    runtime.poll_once()

    with sqlite3.connect(anchor_db) as con:
        gap = con.execute("SELECT scope, reason FROM recording_gaps").fetchone()
    assert gap == ("host", "host_suspended")
    runtime.stop()


def test_source_outage_recovery_records_gap_and_preserves_fresh_value(anchor_db, monkeypatch):
    wall = [datetime(2026, 3, 1, 10, tzinfo=timezone.utc)]
    mono = [10.0]
    calls = [0]

    def pv_read():
        calls[0] += 1
        if calls[0] == 1:
            raise TimeoutError("offline")
        return EnergyReading(wall[0], 700, Decimal("1000"), None, Decimal("500000"))

    monkeypatch.setattr("energyradar.services.runtime.data_source.effective", lambda: {"url": "http://pv.local", "source": "saved"})
    monkeypatch.setattr("energyradar.services.runtime.ui_settings.resolve_effective", lambda: {"refresh_seconds": 5, "mt175_address": ""})
    projection = CurrentStateProjection()
    runtime = EnergyRuntime(
        scheduler=_ManualScheduler(), recorder=CounterRecorder(now=lambda: wall[0]),
        projection=projection, now=lambda: wall[0], monotonic=lambda: mono[0],
        fronius_read=pv_read,
    )
    runtime.start()
    runtime.poll_once(force_anchor=True)
    assert projection.snapshot().fronius.health == "provider_unavailable"
    wall[0] += timedelta(minutes=1)
    mono[0] += 60
    runtime.poll_once(force_anchor=True)

    assert projection.snapshot().fronius.health == "fresh"
    with sqlite3.connect(anchor_db) as con:
        gap = con.execute("SELECT scope, reason FROM recording_gaps").fetchone()
    assert gap == ("source", "provider_unavailable")
    runtime.stop()


@pytest.mark.parametrize(
    ("local_start", "local_end", "hours"),
    [
        (datetime(2026, 3, 29, tzinfo=ZoneInfo("Europe/Berlin")), datetime(2026, 3, 30, tzinfo=ZoneInfo("Europe/Berlin")), 23),
        (datetime(2026, 10, 25, tzinfo=ZoneInfo("Europe/Berlin")), datetime(2026, 10, 26, tzinfo=ZoneInfo("Europe/Berlin")), 25),
    ],
)
def test_dst_days_use_utc_anchors_without_assuming_24_hours(anchor_db, local_start, local_end, hours):
    start, end = local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)
    assert (end - start).total_seconds() == hours * 3600
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "dst-start")
    record(recorder, end, "dst-end", pv="101")
    assert calculate_period(start, end)["metrics"]["pv_generation"]["value_kwh"] == "1"


def test_crash_gap_is_created_but_clean_shutdown_is_not(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    crashed = CounterRecorder(now=lambda: start, process_identity="crashed")
    crashed.start_run()
    record(crashed, start, "before-crash")
    restarted_at = start + timedelta(minutes=10)
    restarted = CounterRecorder(now=lambda: restarted_at, process_identity="restarted")
    restarted.start_run()
    restarted.finish_run()
    clean = CounterRecorder(now=lambda: restarted_at + timedelta(minutes=1), process_identity="clean-next")
    clean.start_run()
    with sqlite3.connect(anchor_db) as con:
        reasons = [row[0] for row in con.execute("SELECT reason FROM recording_gaps")]
    assert reasons == ["crash"]


def test_sequence_preserves_logical_order_after_wall_clock_reversal(anchor_db):
    first = datetime(2026, 3, 1, 10, tzinfo=timezone.utc)
    backwards = first - timedelta(minutes=5)
    recorder = CounterRecorder(now=lambda: first)
    recorder.start_run()
    record(recorder, first, "normal")
    recorder.record_anchor(AnchorCapture("test", backwards, backwards, source_captures(backwards, pv="101"), "backward", "wall_clock_reversed"))
    with sqlite3.connect(anchor_db) as con:
        rows = con.execute("SELECT sequence, timing_state FROM counter_anchors ORDER BY sequence").fetchall()
    assert rows == [(1, "normal"), (2, "wall_clock_reversed")]


def test_bounded_scheduler_prevents_duplicate_start():
    scheduler = BackendScheduler(workers=1)
    assert scheduler.start() is True
    assert scheduler.start() is False
    scheduler.stop()


def test_provider_outage_affects_only_dependent_metrics(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "outage-start")
    end_sources = (
        SourceCapture("pv-1", "fronius", "PV", end, end, "success", {"pv_total": "101"}, "E_Total"),
        SourceCapture("grid-1", "tasmota", "Grid", None, end, "failed", {}, "meter-registers", error_code="timeout"),
    )
    recorder.record_anchor(AnchorCapture("test", end, end, end_sources, "outage-end"))
    report = calculate_period(start, end)
    assert report["metrics"]["pv_generation"]["value_kwh"] == "1"
    assert report["metrics"]["grid_import"]["state"] == "provider_unavailable"
    assert report["metrics"]["house_consumption"]["value_kwh"] is None


def test_negative_balance_is_precisely_rejected(anchor_db):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "negative-start")
    record(recorder, end, "negative-end", pv="101", imported="200", exported="302")
    report = calculate_period(start, end)
    assert report["metrics"]["house_consumption"]["state"] == "invalid_balance"
    assert report["metrics"]["house_consumption"]["reason"] == "house_consumption_negative"
    assert report["metrics"]["direct_self_consumption"]["state"] == "invalid_balance"


def test_period_http_contract_is_read_only_and_authoritative(anchor_db):
    from energyradar.app import app

    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)
    recorder = CounterRecorder(now=lambda: start)
    recorder.start_run()
    record(recorder, start, "http-start")
    record(recorder, end, "http-end", pv="101", imported="201", exported="300.5")
    app.config.update(TESTING=True)
    response = app.test_client().get("/api/period", query_string={"from": start.isoformat(), "to": end.isoformat()})
    assert response.status_code == 200
    assert response.json["ok"] is True
    assert response.json["metrics"]["house_consumption"]["value_kwh"] == "1.5"
    with sqlite3.connect(anchor_db) as con:
        assert con.execute("SELECT COUNT(*) FROM counter_anchors").fetchone()[0] == 2


def test_ui_refresh_and_navigation_have_no_physical_poll_or_weather_fetch():
    from energyradar.ui.bridge import EnergyBridge

    refresh_source = inspect.getsource(EnergyBridge._run_refresh)
    weather_source = inspect.getsource(EnergyBridge.requestWeatherReport)
    assert "read_url(" not in refresh_source
    assert ".read()" not in refresh_source
    assert "save_sample(" not in refresh_source
    assert "get_weather_report(" not in weather_source
