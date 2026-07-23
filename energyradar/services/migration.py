"""Database migration and setup script."""
import logging
import sqlite3
import shutil
from datetime import datetime
from energyradar import config
from energyradar.models.energy import QualityStatus

log = logging.getLogger(__name__)

_SCHEMA_V2 = """
CREATE TABLE IF NOT EXISTS energy_samples_v1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    pv_measured_at TEXT,
    grid_measured_at TEXT,

    pv_power_w REAL,
    grid_power_w REAL,

    pv_energy_today_wh REAL,
    grid_import_total_wh REAL,
    grid_export_total_wh REAL,

    pv_quality_status TEXT NOT NULL,
    grid_quality_status TEXT NOT NULL,
    sample_quality_status TEXT NOT NULL,

    UNIQUE(measured_at)
);

CREATE INDEX IF NOT EXISTS idx_energy_samples_v1_measured_at
ON energy_samples_v1(measured_at);

CREATE TABLE IF NOT EXISTS schema_info (
    version INTEGER PRIMARY KEY
);
"""


def _get_current_version(con: sqlite3.Connection) -> int:
    try:
        row = con.execute("SELECT version FROM schema_info LIMIT 1").fetchone()
        return row[0] if row else 1
    except sqlite3.OperationalError:
        # Table does not exist -> V1 or fresh
        return 1


def _set_version(con: sqlite3.Connection, version: int):
    con.execute("DELETE FROM schema_info")
    con.execute("INSERT INTO schema_info (version) VALUES (?)", (version,))


def _backup_db():
    if not config.DB_PATH.exists():
        return
    backup_path = config.DB_PATH.with_suffix(".db.bak")
    shutil.copy2(config.DB_PATH, backup_path)
    log.info(f"Database backed up to {backup_path}")


def _integrity_check(con: sqlite3.Connection):
    row = con.execute("PRAGMA integrity_check").fetchone()
    if row and row[0] != "ok":
        raise RuntimeError(f"Database integrity check failed: {row[0]}")


def run_migrations():
    """Führt Schema-Updates sicher durch (idempotent, Transaktion, Backup)."""
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    _backup_db()

    with sqlite3.connect(config.DB_PATH) as con:
        # Guarantee core V2 tables exist (idempotent)
        con.executescript(_SCHEMA_V2)

        current_v = _get_current_version(con)
        if current_v >= config.SCHEMA_VERSION:
            return  # Nichts zu tun

        log.info(f"Migrating database from v{current_v} to v{config.SCHEMA_VERSION}")

        # PRAGMA integrity_check vor Migration
        _integrity_check(con)

        try:
            # Migration V1 -> V2
            if current_v < 2:
                con.executescript(_SCHEMA_V2)

                # Check if production table exists
                has_legacy = False
                try:
                    res = con.execute("SELECT COUNT(*) FROM production").fetchone()
                    if res:
                        has_legacy = True
                        src_count = res[0]
                except sqlite3.OperationalError:
                    pass

                if has_legacy:
                    log.info(f"Migrating {src_count} legacy records from 'production'...")

                    # Kopieren (additiv). Da wir INSERT OR IGNORE verwenden, ist es idempotent
                    cursor = con.cursor()
                    cursor.execute(
                        """
                        INSERT OR IGNORE INTO energy_samples_v1 (
                            measured_at, received_at, pv_measured_at, grid_measured_at,
                            pv_power_w, grid_power_w,
                            pv_energy_today_wh, grid_import_total_wh, grid_export_total_wh,
                            pv_quality_status, grid_quality_status, sample_quality_status
                        )
                        SELECT
                            timestamp, timestamp, timestamp, NULL,
                            power, NULL,
                            energy_today, NULL, NULL,
                            ?, ?, ?
                        FROM production
                        """,
                        (QualityStatus.LEGACY.value, QualityStatus.UNKNOWN.value, QualityStatus.PARTIAL.value)
                    )
                    log.info(f"Migrated {cursor.rowcount} legacy records.")

            # Migration erfolgreich -> Version setzen
            _set_version(con, config.SCHEMA_VERSION)

            # Post-Migration Check
            _integrity_check(con)
            log.info("Migration completed successfully.")

        except Exception as e:
            con.rollback()
            log.error(f"Migration failed! Rolled back. Error: {e}")
            raise
