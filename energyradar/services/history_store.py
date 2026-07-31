"""Trusted Phase 1 persistence and bounded reads for local energy history."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import sqlite3
from typing import Any

from energyradar.models.energy import QualityStatus


DERIVED_PROVIDER = "energyradar"
DERIVED_SOURCE_UUID = "energyradar-derived-live-v1"
LEGACY_DERIVED_SOURCE_UUID = "legacy-energyradar-v2"
ADAPTER_VERSION = "phase1-v1"
_CATCHUP_KEY = "phase1_v2_catchup_high_water"


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00", "Z"
    )


def _finite(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number or None")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite")
    return result


def _legacy_finite(value: Any) -> float | None:
    try:
        return _finite(value, "legacy value")
    except ValueError:
        return None


def _quality_state(quality: QualityStatus, *, has_reading: bool) -> str:
    if quality == QualityStatus.VALID:
        return "measured"
    if has_reading or quality in {QualityStatus.PARTIAL, QualityStatus.LOCKED}:
        return "partial"
    return "missing"


def _source_id(
    con: sqlite3.Connection,
    *,
    source_uuid: str,
    provider: str,
    display_name: str,
    adapter_version: str,
    sign_convention: str | None,
    seen_at_utc: str,
    mark_seen: bool = True,
) -> int:
    con.execute(
        """
        INSERT OR IGNORE INTO device_sources (
            source_uuid, provider, display_name, adapter_version,
            sign_convention, capabilities_json, first_seen_utc, last_seen_utc
        ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)
        """,
        (
            source_uuid,
            provider,
            display_name,
            adapter_version,
            sign_convention,
            seen_at_utc,
            seen_at_utc if mark_seen else None,
        ),
    )
    con.execute(
        """
        UPDATE device_sources
        SET last_seen_utc = CASE WHEN ? THEN ? ELSE last_seen_utc END,
            adapter_version = ?
        WHERE source_uuid = ?
        """,
        (int(mark_seen), seen_at_utc, adapter_version, source_uuid),
    )
    return int(
        con.execute(
            "SELECT source_id FROM device_sources WHERE source_uuid = ?",
            (source_uuid,),
        ).fetchone()[0]
    )


def _fingerprint(values: dict[str, Any]) -> str:
    payload = json.dumps(
        values, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _insert_raw(
    con: sqlite3.Connection,
    *,
    source_id: int,
    observed_at_utc: str | None,
    received_at_utc: str,
    source_time_text: str | None,
    source_timezone: str | None,
    dedupe_key: str,
    pv_power_w: float | None = None,
    house_power_w: float | None = None,
    grid_power_w: float | None = None,
    grid_import_total_kwh: float | None = None,
    grid_export_total_kwh: float | None = None,
    pv_energy_today_kwh: float | None = None,
    pv_energy_year_kwh: float | None = None,
    pv_energy_lifetime_kwh: float | None = None,
    source_available: bool,
    quality_state: str,
    quality_flags: list[str],
    adapter_version: str = ADAPTER_VERSION,
) -> None:
    values = {
        "pv_power_w": pv_power_w,
        "house_power_w": house_power_w,
        "grid_power_w": grid_power_w,
        "grid_import_total_kwh": grid_import_total_kwh,
        "grid_export_total_kwh": grid_export_total_kwh,
        "pv_energy_today_kwh": pv_energy_today_kwh,
        "pv_energy_year_kwh": pv_energy_year_kwh,
        "pv_energy_lifetime_kwh": pv_energy_lifetime_kwh,
        "source_available": source_available,
        "quality_state": quality_state,
    }
    con.execute(
        """
        INSERT OR IGNORE INTO raw_samples (
            source_id, observed_at_utc, received_at_utc,
            source_time_text, source_timezone, dedupe_key,
            pv_power_w, house_power_w, grid_power_w,
            grid_import_total_kwh, grid_export_total_kwh,
            pv_energy_today_kwh, pv_energy_year_kwh,
            pv_energy_lifetime_kwh, source_available, provenance,
            quality_state, quality_flags, adapter_version, payload_fingerprint
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'measured',
            ?, ?, ?, ?
        )
        """,
        (
            source_id,
            observed_at_utc,
            received_at_utc,
            source_time_text,
            source_timezone,
            dedupe_key,
            pv_power_w,
            house_power_w,
            grid_power_w,
            grid_import_total_kwh,
            grid_export_total_kwh,
            pv_energy_today_kwh,
            pv_energy_year_kwh,
            pv_energy_lifetime_kwh,
            int(source_available),
            quality_state,
            json.dumps(quality_flags, separators=(",", ":")),
            adapter_version,
            _fingerprint(values),
        ),
    )


def persist_cycle(
    con: sqlite3.Connection,
    *,
    measured_at: datetime,
    received_at: datetime,
    pv: Any | None,
    meter: Any | None,
    house_power_w: float | None,
    trusted_pv_power_w: float | None,
    trusted_grid_power_w: float | None,
    pv_quality: QualityStatus,
    grid_quality: QualityStatus,
) -> None:
    """Persist measured source rows plus one query-oriented derived cycle."""
    cycle_utc = _utc_text(measured_at)
    receive_utc = _utc_text(received_at)

    pv_power = _finite(pv.power, "pv_power_w") if pv else None
    pv_today = _finite(pv.energy_today, "pv_energy_today_wh") if pv else None
    pv_year = _finite(pv.energy_year, "pv_energy_year_wh") if pv else None
    pv_lifetime = _finite(pv.energy_total, "pv_energy_lifetime_wh") if pv else None
    grid_power = _finite(meter.current_power_w, "grid_power_w") if meter else None
    grid_import = (
        _finite(meter.grid_import_total_kwh, "grid_import_total_kwh")
        if meter
        else None
    )
    grid_export = (
        _finite(meter.grid_export_total_kwh, "grid_export_total_kwh")
        if meter
        else None
    )
    house_power = _finite(house_power_w, "house_power_w")
    trusted_pv = _finite(trusted_pv_power_w, "trusted_pv_power_w")
    trusted_grid = _finite(trusted_grid_power_w, "trusted_grid_power_w")

    if pv is not None or pv_quality != QualityStatus.UNKNOWN:
        source_id = _source_id(
            con,
            source_uuid="fronius-primary-live",
            provider="fronius",
            display_name="Fronius Wechselrichter",
            adapter_version=ADAPTER_VERSION,
            sign_convention=None,
            seen_at_utc=receive_utc,
            mark_seen=pv is not None,
        )
        _insert_raw(
            con,
            source_id=source_id,
            # The Fronius live endpoint does not provide a device timestamp.
            # EnergyReading.timestamp is a naive host-local receipt time, so
            # keep its original text but use the aware cycle receipt as UTC.
            observed_at_utc=None,
            received_at_utc=receive_utc,
            source_time_text=pv.timestamp.isoformat() if pv else None,
            source_timezone=(
                str(pv.timestamp.tzinfo) if pv and pv.timestamp.tzinfo else None
            ),
            dedupe_key=f"live:{cycle_utc}",
            pv_power_w=pv_power,
            pv_energy_today_kwh=pv_today / 1000.0 if pv_today is not None else None,
            pv_energy_year_kwh=pv_year / 1000.0 if pv_year is not None else None,
            pv_energy_lifetime_kwh=(
                pv_lifetime / 1000.0 if pv_lifetime is not None else None
            ),
            source_available=pv is not None,
            quality_state=_quality_state(pv_quality, has_reading=pv is not None),
            quality_flags=[f"source:{pv_quality.value}"],
        )

    if meter is not None or grid_quality != QualityStatus.UNKNOWN:
        meter_type = str(getattr(meter, "meter_type", "MT175") or "MT175").lower()
        meter_received = _utc_text(meter.received_at) if meter else receive_utc
        source_id = _source_id(
            con,
            source_uuid=f"tasmota-primary-{meter_type}",
            provider=f"tasmota_{meter_type}",
            display_name="Tasmota SmartMeterReader",
            adapter_version=ADAPTER_VERSION,
            sign_convention="grid_positive_import_v1",
            seen_at_utc=meter_received,
            mark_seen=meter is not None,
        )
        observed = _utc_text(meter.timestamp) if meter and meter.timestamp else None
        _insert_raw(
            con,
            source_id=source_id,
            observed_at_utc=observed,
            received_at_utc=meter_received,
            source_time_text=(meter.timestamp.isoformat() if meter and meter.timestamp else None),
            source_timezone=(str(meter.timestamp.tzinfo) if meter and meter.timestamp else None),
            dedupe_key=f"live:{cycle_utc}",
            grid_power_w=grid_power,
            grid_import_total_kwh=grid_import,
            grid_export_total_kwh=grid_export,
            source_available=meter is not None,
            quality_state=_quality_state(grid_quality, has_reading=meter is not None),
            quality_flags=[f"source:{grid_quality.value}"],
        )

    derived_source = _source_id(
        con,
        source_uuid=DERIVED_SOURCE_UUID,
        provider=DERIVED_PROVIDER,
        display_name="EnergyRadar abgeleitete Werte",
        adapter_version=ADAPTER_VERSION,
        sign_convention="grid_positive_import_v1",
        seen_at_utc=receive_utc,
    )
    has_any = any(value is not None for value in (trusted_pv, trusted_grid, house_power))
    derived_quality = "derived" if house_power is not None else (
        "partial" if has_any else "missing"
    )
    _insert_raw(
        con,
        source_id=derived_source,
        observed_at_utc=cycle_utc,
        received_at_utc=receive_utc,
        source_time_text=None,
        source_timezone="UTC",
        dedupe_key=f"cycle:{cycle_utc}",
        pv_power_w=trusted_pv,
        house_power_w=house_power,
        grid_power_w=trusted_grid,
        grid_import_total_kwh=grid_import,
        grid_export_total_kwh=grid_export,
        pv_energy_today_kwh=pv_today / 1000.0 if pv_today is not None else None,
        pv_energy_year_kwh=pv_year / 1000.0 if pv_year is not None else None,
        pv_energy_lifetime_kwh=(
            pv_lifetime / 1000.0 if pv_lifetime is not None else None
        ),
        source_available=house_power is not None,
        quality_state=derived_quality,
        quality_flags=[
            f"pv:{pv_quality.value}",
            f"grid:{grid_quality.value}",
            "formula:house_power_v1" if house_power is not None else "house:missing",
        ],
    )


def catch_up_v2_cycles(con: sqlite3.Connection) -> None:
    """Idempotently expose pre-Phase-1 v2 rows through the derived history path."""
    if con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='energy_samples_v1'"
    ).fetchone() is None:
        return
    marker_row = con.execute(
        "SELECT value_json FROM application_metadata WHERE key = ?",
        (_CATCHUP_KEY,),
    ).fetchone()
    try:
        high_water = int(json.loads(marker_row[0])) if marker_row else 0
    except (TypeError, ValueError, json.JSONDecodeError):
        high_water = 0

    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT * FROM energy_samples_v1 WHERE id > ? ORDER BY id",
        (high_water,),
    ).fetchall()
    con.row_factory = None
    if not rows:
        return

    first_received = str(rows[0]["received_at"]).replace(" ", "T")
    if not first_received.endswith("Z"):
        first_received += "Z"
    source_id = _source_id(
        con,
        source_uuid=LEGACY_DERIVED_SOURCE_UUID,
        provider=DERIVED_PROVIDER,
        display_name="EnergyRadar Legacy-Verlauf",
        adapter_version="legacy-v2",
        sign_convention="grid_positive_import_v1",
        seen_at_utc=first_received,
    )
    for row in rows:
        received = str(row["received_at"]).replace(" ", "T")
        if not received.endswith("Z"):
            received += "Z"
        # Phase 1 dual-writes v2 and raw rows in one transaction. On restart,
        # catch-up must not create a legacy copy of a cycle that already has
        # its live derived row (v2 timestamps have second precision).
        live_cycle_exists = con.execute(
            """
            SELECT 1 FROM raw_samples
            JOIN device_sources USING(source_id)
            WHERE source_uuid = ?
              AND substr(received_at_utc, 1, 19) = substr(?, 1, 19)
            LIMIT 1
            """,
            (DERIVED_SOURCE_UUID, received),
        ).fetchone()
        if live_cycle_exists is not None:
            continue
        pv_power = _legacy_finite(row["pv_power_w"])
        grid_power = _legacy_finite(row["grid_power_w"])
        # v2 did not persist the alignment decision. Preserve its measured PV
        # and signed grid evidence, but do not reconstruct trusted house power.
        house_power = None
        has_any = any(value is not None for value in (pv_power, grid_power, house_power))
        _insert_raw(
            con,
            source_id=source_id,
            observed_at_utc=None,
            received_at_utc=received,
            source_time_text=None,
            source_timezone=None,
            dedupe_key=f"energy_samples_v1:cycle:{row['id']}",
            pv_power_w=pv_power,
            house_power_w=house_power,
            grid_power_w=grid_power,
            grid_import_total_kwh=(
                _legacy_finite(row["grid_import_total_wh"]) / 1000.0
                if _legacy_finite(row["grid_import_total_wh"]) is not None
                else None
            ),
            grid_export_total_kwh=(
                _legacy_finite(row["grid_export_total_wh"]) / 1000.0
                if _legacy_finite(row["grid_export_total_wh"]) is not None
                else None
            ),
            pv_energy_today_kwh=(
                _legacy_finite(row["pv_energy_today_wh"]) / 1000.0
                if _legacy_finite(row["pv_energy_today_wh"]) is not None
                else None
            ),
            source_available=has_any,
            quality_state="partial" if has_any else "missing",
            quality_flags=[
                "legacy:v2",
                f"pv:{row['pv_quality_status']}",
                f"grid:{row['grid_quality_status']}",
            ],
            adapter_version="legacy-v2",
        )
    _set_catchup_high_water(con, int(rows[-1]["id"]))


def _set_catchup_high_water(con: sqlite3.Connection, row_id: int) -> None:
    con.execute(
        """
        INSERT INTO application_metadata (key, value_json, updated_at_utc)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at_utc = excluded.updated_at_utc
        """,
        (
            _CATCHUP_KEY,
            json.dumps(row_id),
            _utc_text(datetime.now(timezone.utc)),
        ),
    )


def mark_current_v2_rows_represented(con: sqlite3.Connection) -> None:
    """Advance catch-up only inside the successful dual-write transaction."""
    row_id = int(con.execute("SELECT COALESCE(MAX(id), 0) FROM energy_samples_v1").fetchone()[0])
    _set_catchup_high_water(con, row_id)


def read_derived_rows(
    con: sqlite3.Connection,
    *,
    start_utc: str,
    end_utc: str,
    max_points: int | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Read ordered, bounded derived rows without loading the whole database."""
    count = int(
        con.execute(
            """
            SELECT COUNT(*) FROM raw_samples
            JOIN device_sources USING(source_id)
            WHERE provider = ? AND received_at_utc >= ? AND received_at_utc < ?
            """,
            (DERIVED_PROVIDER, start_utc, end_utc),
        ).fetchone()[0]
    )
    if count == 0:
        return [], 0
    stride = 1 if not max_points else max(1, math.ceil(count / max_points))
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        WITH ordered AS (
            SELECT raw_samples.*, device_sources.source_uuid,
                   device_sources.display_name AS source_name,
                   ROW_NUMBER() OVER (ORDER BY received_at_utc, sample_id) AS row_num,
                   LAG(received_at_utc) OVER (
                       ORDER BY received_at_utc, sample_id
                   ) AS previous_received_at,
                   LAG(quality_state) OVER (
                       ORDER BY received_at_utc, sample_id
                   ) AS previous_quality_state
            FROM raw_samples
            JOIN device_sources USING(source_id)
            WHERE provider = ? AND received_at_utc >= ? AND received_at_utc < ?
        )
        SELECT * FROM ordered
        WHERE ((row_num - 1) % ?) = 0
           OR row_num = ?
           OR previous_received_at IS NULL
           OR quality_state != previous_quality_state
           OR (julianday(received_at_utc) - julianday(previous_received_at)) * 86400.0 > 30.0
        ORDER BY received_at_utc, sample_id
        """,
        (DERIVED_PROVIDER, start_utc, end_utc, stride, count),
    ).fetchall()
    con.row_factory = None
    return [dict(row) for row in rows], count


def recording_bounds(con: sqlite3.Connection) -> tuple[str | None, str | None]:
    row = con.execute(
        """
        SELECT MIN(received_at_utc), MAX(received_at_utc)
        FROM raw_samples JOIN device_sources USING(source_id)
        WHERE provider = ?
        """,
        (DERIVED_PROVIDER,),
    ).fetchone()
    return (row[0], row[1]) if row else (None, None)
