"""Regression tests for recording/live freshness separation.

These force the two P0 timestamp contradictions the audit uncovered:

1. "Aufzeichnung seit" (recording_since) rendered *after* "Letzte gespeicherte
   Messung" (last_recorded_sample_at) because recording_since was taken from the
   newest live run start instead of the earliest persisted record.
2. The "Jetzt" heartbeat screaming "Letzte Messung vor 2 Stunden" right after
   startup, because the previous run's stale persisted sample was reused as the
   *current* session's heartbeat.

The fix separates persisted-history freshness (recording_since / first record)
from live-session freshness (current_session_since / active run start).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from energyradar import config
from energyradar.services import migration
from energyradar.ui import viewmodels


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _naive(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


@pytest.fixture()
def fresh_session_over_stale_history(tmp_path, monkeypatch):
    """A newly started recorder run whose newest persisted sample is 2h old."""
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    migration.run_migrations()

    now = datetime.now(timezone.utc)
    old_sample_at = now - timedelta(hours=2)
    session_started_at = now - timedelta(minutes=1)

    import sqlite3

    con = sqlite3.connect(path)
    try:
        con.execute(
            """INSERT INTO energy_samples_v1
               (measured_at, received_at, pv_power_w,
                pv_quality_status, grid_quality_status, sample_quality_status)
               VALUES (?, ?, ?, 'valid', 'valid', 'valid')""",
            (_naive(old_sample_at), _naive(old_sample_at), 1200.0),
        )
        con.execute(
            """INSERT INTO recording_runs
               (started_at_utc, app_version, mode, process_identity)
               VALUES (?, ?, 'live', 'test-proc')""",
            (_utc(session_started_at), config.APP_VERSION),
        )
        con.commit()
    finally:
        con.close()

    # The live projection is fresh (current values available), while the newest
    # persisted sample is old. _build_storage_status consults the runtime for the
    # live projection; stub it so the test does not depend on a running recorder.
    fake_projection = SimpleNamespace(
        snapshot=lambda: SimpleNamespace(
            recording_active=True,
            last_gap_ended_at=None,
            weather_report=None,
            fronius=SimpleNamespace(health="live"),
            smart_meter=SimpleNamespace(health="live"),
        )
    )
    monkeypatch.setattr(
        "energyradar.services.runtime.get_runtime",
        lambda: SimpleNamespace(projection=fake_projection),
    )
    return {
        "old_sample_at": old_sample_at,
        "session_started_at": session_started_at,
    }


def test_recording_since_is_earliest_history_not_live_run_start(fresh_session_over_stale_history):
    status = viewmodels._build_storage_status(config.DB_PATH, refresh_seconds=5)

    recording_since = status["recording_since"]
    last_sample = status["last_recorded_sample_at"]

    assert recording_since is not None
    assert last_sample is not None
    # The core contradiction: "recording since" must never be later than the
    # last stored measurement. Earliest history precedes the last write.
    assert recording_since <= last_sample


def test_current_session_start_is_exposed_separately(fresh_session_over_stale_history):
    status = viewmodels._build_storage_status(config.DB_PATH, refresh_seconds=5)

    # The live session start is a distinct clock and is newer than the earliest
    # persisted record — it must not overwrite recording_since.
    assert status["current_session_since"] is not None
    assert status["current_session_since"] > status["recording_since"]
    # And it is newer than the last persisted sample (session just started),
    # which is exactly the signal the heartbeat uses to avoid a false "stale".
    assert status["current_session_since"] > status["last_recorded_sample_at"]
