import math
import sqlite3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from energyradar import config
from energyradar.models.energy import EnergyReading, QualityStatus
from energyradar.models.mt175 import MT175Reading
from energyradar.services import history, history_store, migration, storage


@pytest.fixture
def database_path(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    storage._MIGRATED = False
    yield path
    storage._MIGRATED = False


def _pv(timestamp: datetime, power: float = 1000.0) -> EnergyReading:
    return EnergyReading(timestamp, power, 2500.0, 12000.0, 500000.0)


def _meter(
    timestamp: datetime,
    power: float | None,
    *,
    meter_type: str = "MT631",
) -> MT175Reading:
    return MT175Reading(
        timestamp=timestamp,
        received_at=timestamp,
        grid_import_total_kwh=9798.031,
        grid_export_total_kwh=12480.630,
        current_power_w=power,
        phase_l1_w=None,
        phase_l2_w=None,
        phase_l3_w=None,
        meter_id=None,
        meter_type=meter_type,
        pin_locked=False,
    )


def _save(
    timestamp: datetime,
    *,
    pv_power: float | None = 1000.0,
    grid_power: float | None = 0.0,
    house_power: float | None = 1000.0,
) -> None:
    pv = _pv(timestamp, pv_power) if pv_power is not None else None
    meter = _meter(timestamp, grid_power) if grid_power is not None else None
    storage.save_sample(
        measured_at=timestamp,
        received_at=timestamp,
        pv=pv,
        mt175=meter,
        house_power_w=house_power,
        trusted_pv_power_w=pv_power,
        trusted_grid_power_w=grid_power,
        pv_quality=QualityStatus.VALID if pv else QualityStatus.OFFLINE,
        grid_quality=QualityStatus.VALID if meter else QualityStatus.OFFLINE,
        sample_quality=(
            QualityStatus.VALID if house_power is not None else QualityStatus.PARTIAL
        ),
    )


@pytest.mark.parametrize(
    ("grid_power", "house_power"),
    [(3557.0, 4557.0), (-789.0, 211.0), (0.0, 1000.0)],
)
def test_signed_zero_and_derived_house_survive_restart(
    database_path, grid_power, house_power
):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    _save(timestamp, grid_power=grid_power, house_power=house_power)
    storage._MIGRATED = False

    rows, total = storage.get_persisted_history_rows(
        timestamp - timedelta(seconds=1), timestamp + timedelta(seconds=1)
    )

    assert total == 1
    assert rows[0]["grid_power_w"] == grid_power
    assert rows[0]["house_power_w"] == house_power
    assert rows[0]["quality_state"] == "derived"
    assert rows[0]["source_uuid"] == history_store.DERIVED_SOURCE_UUID


def test_partial_cycle_preserves_nulls_and_quality(database_path):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    _save(timestamp, grid_power=None, house_power=None)

    rows, _ = storage.get_persisted_history_rows(
        timestamp - timedelta(seconds=1), timestamp + timedelta(seconds=1)
    )

    assert rows[0]["pv_power_w"] == 1000.0
    assert rows[0]["grid_power_w"] is None
    assert rows[0]["house_power_w"] is None
    assert rows[0]["quality_state"] == "partial"
    assert rows[0]["source_available"] == 0


def test_stale_source_evidence_is_not_exposed_as_trusted_cycle(database_path):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    storage.save_sample(
        measured_at=timestamp,
        received_at=timestamp,
        pv=_pv(timestamp, 1000.0),
        mt175=_meter(timestamp, -789.0),
        house_power_w=None,
        trusted_pv_power_w=None,
        trusted_grid_power_w=None,
        pv_quality=QualityStatus.STALE,
        grid_quality=QualityStatus.STALE,
        sample_quality=QualityStatus.STALE,
    )

    rows, _ = storage.get_persisted_history_rows(
        timestamp - timedelta(seconds=1), timestamp + timedelta(seconds=1)
    )
    assert rows[0]["pv_power_w"] is None
    assert rows[0]["grid_power_w"] is None
    assert rows[0]["house_power_w"] is None
    assert rows[0]["quality_state"] == "missing"

    with sqlite3.connect(database_path) as con:
        measured = con.execute(
            """
            SELECT provider, pv_power_w, grid_power_w, observed_at_utc,
                   received_at_utc, source_time_text
            FROM raw_samples JOIN device_sources USING(source_id)
            WHERE provider != 'energyradar' ORDER BY provider
            """
        ).fetchall()
    assert measured[0][0:3] == ("fronius", 1000.0, None)
    assert measured[1][0:3] == ("tasmota_mt631", None, -789.0)
    assert measured[1][3] is not None
    assert measured[1][4] is not None
    assert measured[1][5] is not None


def test_fronius_naive_host_time_is_not_mislabeled_as_utc(database_path):
    cycle = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    pv = _pv(datetime(2026, 7, 31, 14, 0), 1000.0)
    storage.save_sample(
        measured_at=cycle,
        received_at=cycle,
        pv=pv,
        mt175=None,
        trusted_pv_power_w=1000.0,
        pv_quality=QualityStatus.VALID,
        grid_quality=QualityStatus.UNKNOWN,
        sample_quality=QualityStatus.PARTIAL,
    )

    with sqlite3.connect(database_path) as con:
        row = con.execute(
            """
            SELECT observed_at_utc, received_at_utc, source_time_text,
                   source_timezone
            FROM raw_samples JOIN device_sources USING(source_id)
            WHERE provider = 'fronius'
            """
        ).fetchone()
    assert row == (
        None,
        "2026-07-31T12:00:00.000000Z",
        "2026-07-31T14:00:00",
        None,
    )


def test_legacy_cycle_does_not_reconstruct_unproven_house_power(database_path):
    migration.run_migrations()
    with sqlite3.connect(database_path) as con:
        con.execute(
            """
            INSERT INTO energy_samples_v1 (
                measured_at, received_at, pv_power_w, grid_power_w,
                pv_quality_status, grid_quality_status, sample_quality_status
            ) VALUES (?, ?, ?, ?, 'valid', 'valid', 'valid')
            """,
            ("2026-07-31 12:00:00", "2026-07-31 12:00:00", 1000.0, -789.0),
        )
    storage._MIGRATED = False

    rows, total = storage.get_persisted_history_rows(
        datetime(2026, 7, 31, 11, 59, tzinfo=timezone.utc),
        datetime(2026, 7, 31, 12, 1, tzinfo=timezone.utc),
    )

    assert total == 1
    assert rows[0]["pv_power_w"] == 1000.0
    assert rows[0]["grid_power_w"] == -789.0
    assert rows[0]["house_power_w"] is None
    assert rows[0]["quality_state"] == "partial"


def test_duplicate_cycle_is_idempotent_and_sources_are_explicit(database_path):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    _save(timestamp, grid_power=-789.0, house_power=211.0)
    _save(timestamp, grid_power=-789.0, house_power=211.0)

    with sqlite3.connect(database_path) as con:
        sources = con.execute(
            "SELECT provider, source_uuid FROM device_sources ORDER BY provider"
        ).fetchall()
        assert sources == [
            ("energyradar", history_store.DERIVED_SOURCE_UUID),
            ("fronius", "fronius-primary-live"),
            ("tasmota_mt631", "tasmota-primary-mt631"),
        ]
        assert con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0] == 3


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_non_finite_cycle_rolls_back_legacy_and_raw_writes(database_path, bad):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="finite"):
        _save(timestamp, grid_power=bad, house_power=None)

    with sqlite3.connect(database_path) as con:
        assert con.execute("SELECT COUNT(*) FROM energy_samples_v1").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0] == 0


def test_mid_cycle_failure_rolls_back_all_source_and_legacy_rows(
    database_path, monkeypatch
):
    timestamp = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)
    original = history_store._insert_raw
    calls = 0

    def fail_second_insert(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise sqlite3.OperationalError("simulated disk write failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(history_store, "_insert_raw", fail_second_insert)
    with pytest.raises(sqlite3.OperationalError, match="simulated disk"):
        _save(timestamp, grid_power=3557.0, house_power=4557.0)

    with sqlite3.connect(database_path) as con:
        assert con.execute("SELECT COUNT(*) FROM energy_samples_v1").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM device_sources").fetchone()[0] == 0


def test_history_ranges_are_ordered_bounded_and_gap_aware(database_path):
    berlin = ZoneInfo("Europe/Berlin")
    now = datetime(2026, 7, 31, 12, 5, tzinfo=timezone.utc)
    _save(now - timedelta(minutes=2), grid_power=3557.0, house_power=4557.0)
    _save(now - timedelta(seconds=5), grid_power=-789.0, house_power=211.0)

    for range_key in ("today", "7days", "30days"):
        result = history.get_history(range_key, berlin, now=now, max_points=100)
        timestamps = [point["timestamp_utc"] for point in result["points"]]
        assert timestamps == sorted(timestamps)
        assert result["range"] == range_key
        assert result["total_samples"] == 2
        assert result["status"] == "partial"
        assert any(point["gap"] for point in result["points"])


def test_today_range_uses_berlin_midnight_with_utc_storage(database_path):
    berlin = ZoneInfo("Europe/Berlin")
    now = datetime(2026, 7, 31, 22, 5, tzinfo=timezone.utc)  # 00:05 local
    _save(datetime(2026, 7, 31, 21, 59, tzinfo=timezone.utc))  # previous day
    _save(datetime(2026, 7, 31, 22, 1, tzinfo=timezone.utc))   # current day

    result = history.get_history("today", berlin, now=now)

    assert result["total_samples"] == 1
    assert result["points"][-1]["timestamp_utc"].startswith("2026-07-31T22:01")


def test_today_range_handles_berlin_fall_back_without_losing_an_hour(database_path):
    berlin = ZoneInfo("Europe/Berlin")
    now = datetime(2026, 10, 25, 2, 0, tzinfo=timezone.utc)  # 03:00 CET
    _save(datetime(2026, 10, 24, 21, 59, tzinfo=timezone.utc))  # previous day
    _save(datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc))   # 02:30 CEST
    _save(datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc))   # 02:30 CET

    result = history.get_history("today", berlin, now=now)

    assert result["total_samples"] == 2
    assert [point["timestamp_utc"] for point in result["points"] if not point["gap"]] == [
        "2026-10-25T00:30:00.000000Z",
        "2026-10-25T01:30:00.000000Z",
    ]


def test_empty_range_is_honest(database_path):
    migration.run_migrations()
    now = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)

    result = history.get_history("30days", ZoneInfo("Europe/Berlin"), now=now)

    assert result["status"] == "no_history"
    assert result["points"] == []
    assert result["recording_since_utc"] is None


def test_large_range_is_downsampled_in_sql_without_smoothing(database_path):
    migration.run_migrations()
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    with sqlite3.connect(database_path) as con:
        source_id = history_store._source_id(
            con,
            source_uuid=history_store.DERIVED_SOURCE_UUID,
            provider=history_store.DERIVED_PROVIDER,
            display_name="EnergyRadar abgeleitete Werte",
            adapter_version=history_store.ADAPTER_VERSION,
            sign_convention="grid_positive_import_v1",
            seen_at_utc=history_store._utc_text(start),
        )
        con.executemany(
            """
            INSERT INTO raw_samples (
                source_id, observed_at_utc, received_at_utc, dedupe_key,
                pv_power_w, house_power_w, grid_power_w, source_available,
                provenance, quality_state, adapter_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'measured', 'derived', 'phase1-v1')
            """,
            (
                (
                    source_id,
                    history_store._utc_text(start + timedelta(seconds=index * 10)),
                    history_store._utc_text(start + timedelta(seconds=index * 10)),
                    f"large:{index}",
                    float(index),
                    float(index + 10),
                    10.0,
                )
                for index in range(10_000)
            ),
        )

    rows, total = storage.get_persisted_history_rows(
        start, start + timedelta(days=2), max_points=500
    )

    assert total == 10_000
    assert len(rows) <= 501
    assert all(row["pv_power_w"].is_integer() for row in rows)


def test_downsampling_preserves_a_regular_cadence_quality_outage(database_path):
    migration.run_migrations()
    start = datetime(2026, 7, 31, 10, 0, tzinfo=timezone.utc)
    with sqlite3.connect(database_path) as con:
        source_id = history_store._source_id(
            con,
            source_uuid=history_store.DERIVED_SOURCE_UUID,
            provider=history_store.DERIVED_PROVIDER,
            display_name="EnergyRadar abgeleitete Werte",
            adapter_version=history_store.ADAPTER_VERSION,
            sign_convention="grid_positive_import_v1",
            seen_at_utc=history_store._utc_text(start),
        )
        for index in range(100):
            missing = index == 55
            history_store._insert_raw(
                con,
                source_id=source_id,
                observed_at_utc=history_store._utc_text(
                    start + timedelta(seconds=index * 5)
                ),
                received_at_utc=history_store._utc_text(
                    start + timedelta(seconds=index * 5)
                ),
                source_time_text=None,
                source_timezone="UTC",
                dedupe_key=f"quality:{index}",
                pv_power_w=None if missing else 1000.0,
                house_power_w=None if missing else 1000.0,
                grid_power_w=None if missing else 0.0,
                source_available=not missing,
                quality_state="missing" if missing else "derived",
                quality_flags=[],
            )

    rows, total = storage.get_persisted_history_rows(
        start, start + timedelta(minutes=10), max_points=10
    )

    assert total == 100
    assert any(row["quality_state"] == "missing" for row in rows)
