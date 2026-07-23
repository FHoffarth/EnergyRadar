"""Storage.

Einzige Verantwortung: SQLite. Anlegen, Schreiben (gedrosselt), Lesen.
"""

import sqlite3
from datetime import datetime, timezone
import logging

from energyradar import config
from energyradar.models.energy import EnergyReading, QualityStatus
from energyradar.models.mt175 import MT175Reading
from energyradar.services import migration

log = logging.getLogger(__name__)

_TS_FORMAT = "%Y-%m-%d %H:%M:%S"

_MIGRATED = False

def _connect() -> sqlite3.Connection:
    global _MIGRATED
    if not _MIGRATED:
        migration.run_migrations()
        _MIGRATED = True

    con = sqlite3.connect(config.DB_PATH)
    return con

def save_sample(
    measured_at: datetime,
    received_at: datetime,
    pv: EnergyReading | None = None,
    mt175: MT175Reading | None = None,
    sample_quality: QualityStatus = QualityStatus.VALID,
    pv_quality: QualityStatus = QualityStatus.VALID,
    grid_quality: QualityStatus = QualityStatus.VALID
) -> None:
    """Speichert einen kombinierten Messwert in energy_samples_v1.
    Wenn ein Datensatz mit demselben 'measured_at' existiert, wird er
    sicher ergänzt (kein Überschreiben gültiger Werte durch NULL)."""

    # Runde timestamp auf nächste 10 Sekunden (Bucket)
    # measured_at ist die Zeit des Aggregator-Laufs
    sec = measured_at.second
    rounded_sec = (sec // 10) * 10
    bucket_time = measured_at.replace(second=rounded_sec, microsecond=0)

    ts_str = bucket_time.strftime(_TS_FORMAT)
    rx_str = received_at.strftime(_TS_FORMAT)
    pv_ts_str = pv.timestamp.strftime(_TS_FORMAT) if pv else None
    grid_ts_str = mt175.received_at.strftime(_TS_FORMAT) if mt175 else None

    pv_power = pv.power if pv else None
    pv_energy_today = pv.energy_today if pv else None
    grid_power = mt175.current_power_w if mt175 and mt175.current_power_w is not None else None
    grid_import = mt175.grid_import_total_kwh * 1000 if mt175 and mt175.grid_import_total_kwh is not None else None
    grid_export = mt175.grid_export_total_kwh * 1000 if mt175 and mt175.grid_export_total_kwh is not None else None

    with _connect() as con:
        # Konfliktfreies Update (INSERT OR IGNORE + UPDATE)
        con.execute(
            """
            INSERT OR IGNORE INTO energy_samples_v1 (
                measured_at, received_at, pv_measured_at, grid_measured_at,
                pv_power_w, grid_power_w, pv_energy_today_wh, grid_import_total_wh, grid_export_total_wh,
                pv_quality_status, grid_quality_status, sample_quality_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ts_str, rx_str, pv_ts_str, grid_ts_str,
                pv_power, grid_power, pv_energy_today, grid_import, grid_export,
                pv_quality.value, grid_quality.value, sample_quality.value
            )
        )

        # Sicheres Ergänzen (kein NULL darf echten Wert überschreiben)
        con.execute(
            """
            UPDATE energy_samples_v1
            SET
                pv_measured_at = COALESCE(?, pv_measured_at),
                grid_measured_at = COALESCE(?, grid_measured_at),
                pv_power_w = COALESCE(?, pv_power_w),
                grid_power_w = COALESCE(?, grid_power_w),
                pv_energy_today_wh = COALESCE(?, pv_energy_today_wh),
                grid_import_total_wh = COALESCE(?, grid_import_total_wh),
                grid_export_total_wh = COALESCE(?, grid_export_total_wh),
                pv_quality_status = CASE WHEN ? != 'unknown' THEN ? ELSE pv_quality_status END,
                grid_quality_status = CASE WHEN ? != 'unknown' THEN ? ELSE grid_quality_status END,
                sample_quality_status = CASE WHEN COALESCE(?, pv_power_w) IS NOT NULL AND COALESCE(?, grid_power_w) IS NOT NULL THEN 'valid' ELSE 'partial' END
            WHERE measured_at = ? AND (
                ? IS NOT NULL OR ? IS NOT NULL
            )
            """,
            (
                pv_ts_str, grid_ts_str,
                pv_power, grid_power, pv_energy_today, grid_import, grid_export,
                pv_quality.value, pv_quality.value,
                grid_quality.value, grid_quality.value,
                pv_power, grid_power,
                ts_str, pv_ts_str, grid_ts_str
            )
        )


def get_samples_since(start_dt: datetime) -> list[dict]:
    """Holt alle raw_samples ab einem Zeitpunkt für HistoryService."""
    with _connect() as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT * FROM energy_samples_v1
            WHERE measured_at >= ?
            ORDER BY measured_at ASC
            """,
            (start_dt.strftime(_TS_FORMAT),)
        ).fetchall()
    return [dict(r) for r in rows]

def get_samples_in_range(start_dt: datetime, end_dt: datetime) -> list[dict]:
    """Holt alle raw_samples in einem definierten Zeitfenster."""
    with _connect() as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT * FROM energy_samples_v1
            WHERE measured_at >= ? AND measured_at < ?
            ORDER BY measured_at ASC
            """,
            (start_dt.strftime(_TS_FORMAT), end_dt.strftime(_TS_FORMAT))
        ).fetchall()
    return [dict(r) for r in rows]
