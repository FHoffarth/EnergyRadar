"""Versioned, additive SQLite migrations for EnergyRadar.

``PRAGMA user_version`` is authoritative from schema version 3 onward.
``schema_info`` remains updated for compatibility with existing databases and
older application builds, but new migrations are recorded in
``schema_migrations`` with deterministic checksums.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import sqlite3
import threading
from typing import Callable
from uuid import uuid4

from energyradar import config
from energyradar.models.energy import QualityStatus

log = logging.getLogger(__name__)

BUSY_TIMEOUT_MS = 5_000
_MIGRATION_LOCK = threading.RLock()


class MigrationError(RuntimeError):
    """Base class for migration failures safe to surface to startup code."""


class UnsupportedSchemaVersion(MigrationError):
    """The database was written by a newer EnergyRadar version."""


class MigrationMetadataError(MigrationError):
    """The migration ledger or legacy version metadata is inconsistent."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    checksum_basis: str
    apply: Callable[[sqlite3.Connection], None]

    @property
    def checksum(self) -> str:
        payload = f"{self.version}:{self.name}:{self.checksum_basis}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _backup_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _open_connection(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = FULL")
    return con


def _table_exists(con: sqlite3.Connection, table: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _table_columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in con.execute(f'PRAGMA table_info("{table}")')}


def _integrity_check(con: sqlite3.Connection) -> None:
    row = con.execute("PRAGMA integrity_check").fetchone()
    if not row or row[0] != "ok":
        detail = row[0] if row else "no result"
        raise MigrationError(f"Database integrity check failed: {detail}")


def _foreign_key_check(con: sqlite3.Connection) -> None:
    row = con.execute("PRAGMA foreign_key_check").fetchone()
    if row is not None:
        raise MigrationError(f"Database foreign-key check failed: {row}")


def _next_backup_path(database_path: Path, from_version: int, to_version: int) -> Path:
    """Reserve a collision-safe backup path beside the live database."""
    stamp = _backup_stamp()
    base_name = (
        f"{database_path.stem}.pre-v{from_version}-to-v{to_version}-{stamp}"
    )
    suffix = 0
    while True:
        discriminator = f"-{suffix}" if suffix else ""
        candidate = database_path.with_name(
            f"{base_name}{discriminator}.db.bak"
        )
        try:
            candidate.touch(exist_ok=False)
        except FileExistsError:
            suffix += 1
            continue
        return candidate


def _create_consistent_backup(
    database_path: Path, from_version: int, to_version: int
) -> Path:
    """Create and integrity-check an atomic pre-migration backup."""
    backup_path = _next_backup_path(database_path, from_version, to_version)
    temporary = database_path.with_name(
        f".{backup_path.name}.{uuid4().hex}.tmp"
    )
    try:
        source = _open_connection(database_path)
        destination = _open_connection(temporary)
        try:
            source.backup(destination)
            _integrity_check(destination)
        finally:
            destination.close()
            source.close()
        os.replace(temporary, backup_path)
    except Exception:
        temporary.unlink(missing_ok=True)
        backup_path.unlink(missing_ok=True)
        raise
    log.info("Database backed up to %s", backup_path)
    return backup_path


def _create_schema_info(con: sqlite3.Connection) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_info (
            version INTEGER PRIMARY KEY
        )
        """
    )


def _set_legacy_schema_version(con: sqlite3.Connection, version: int) -> None:
    """Keep known ``schema_info`` variants coherent without replacing them."""
    _create_schema_info(con)
    columns = _table_columns(con, "schema_info")
    if "version" not in columns:
        raise MigrationMetadataError("schema_info has no version column")

    count = int(con.execute("SELECT COUNT(*) FROM schema_info").fetchone()[0])
    if count > 1:
        raise MigrationMetadataError("schema_info contains multiple version rows")

    now = _utc_now_text()
    if count == 1:
        if "applied_at" in columns:
            con.execute(
                "UPDATE schema_info SET version = ?, applied_at = ?", (version, now)
            )
        else:
            con.execute("UPDATE schema_info SET version = ?", (version,))
        return

    if {"id", "applied_at"}.issubset(columns):
        con.execute(
            "INSERT INTO schema_info (id, version, applied_at) VALUES (1, ?, ?)",
            (version, now),
        )
    else:
        con.execute("INSERT INTO schema_info (version) VALUES (?)", (version,))


def _migration_1(con: sqlite3.Connection) -> None:
    """Create the original production table for a fresh install."""
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS production (
            timestamp TEXT PRIMARY KEY,
            power REAL NOT NULL,
            energy_today REAL NOT NULL,
            energy_year REAL NOT NULL,
            energy_total REAL NOT NULL
        )
        """
    )


def _migration_2(con: sqlite3.Connection) -> None:
    """Create the current live/history table and preserve legacy production rows."""
    con.execute(
        """
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
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_energy_samples_v1_measured_at
        ON energy_samples_v1(measured_at)
        """
    )
    _create_schema_info(con)

    if _table_exists(con, "production"):
        con.execute(
            """
            INSERT OR IGNORE INTO energy_samples_v1 (
                measured_at, received_at, pv_measured_at, grid_measured_at,
                pv_power_w, grid_power_w,
                pv_energy_today_wh, grid_import_total_wh, grid_export_total_wh,
                pv_quality_status, grid_quality_status, sample_quality_status
            )
            SELECT
                timestamp, timestamp, timestamp, NULL,
                power, NULL, energy_today, NULL, NULL,
                ?, ?, ?
            FROM production
            """,
            (
                QualityStatus.LEGACY.value,
                QualityStatus.UNKNOWN.value,
                QualityStatus.PARTIAL.value,
            ),
        )


def _create_migration_ledger(con: sqlite3.Connection) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at_utc TEXT NOT NULL CHECK(substr(applied_at_utc, -1) = 'Z'),
            app_version TEXT NOT NULL
        )
        """
    )


def _require_columns(
    con: sqlite3.Connection, table: str, required: set[str]
) -> None:
    columns = _table_columns(con, table)
    if not required.issubset(columns):
        missing = ", ".join(sorted(required - columns))
        raise MigrationMetadataError(
            f"{table} has an unsupported shape; missing columns: {missing}"
        )


def _validate_phase0_table_shapes(con: sqlite3.Connection) -> None:
    required_by_table = {
        "application_metadata": {"key", "value_json", "updated_at_utc"},
        "device_sources": {
            "source_id",
            "source_uuid",
            "provider",
            "adapter_version",
            "sign_convention",
            "capabilities_json",
            "first_seen_utc",
        },
        "source_state": {
            "state_id",
            "source_id",
            "state_kind",
            "state_value",
            "effective_at_utc",
            "received_at_utc",
        },
        "backfill_runs": {
            "run_id",
            "idempotency_key",
            "source_id",
            "requested_start_utc",
            "requested_end_utc",
            "status",
        },
        "raw_samples": {
            "sample_id",
            "source_id",
            "received_at_utc",
            "dedupe_key",
            "pv_power_w",
            "house_power_w",
            "grid_power_w",
            "grid_import_total_kwh",
            "grid_export_total_kwh",
            "source_available",
            "provenance",
            "quality_state",
        },
    }
    for table, required in required_by_table.items():
        _require_columns(con, table, required)


def _migration_3(con: sqlite3.Connection) -> None:
    """Add the Phase 0 history foundation without changing current reads/writes."""
    _create_migration_ledger(con)
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS application_metadata (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at_utc TEXT NOT NULL CHECK(substr(updated_at_utc, -1) = 'Z')
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS device_sources (
            source_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_uuid TEXT NOT NULL UNIQUE,
            provider TEXT NOT NULL,
            display_name TEXT,
            device_fingerprint_hash TEXT,
            model TEXT,
            firmware TEXT,
            adapter_version TEXT NOT NULL,
            sign_convention TEXT,
            capabilities_json TEXT NOT NULL DEFAULT '{}',
            first_seen_utc TEXT NOT NULL CHECK(substr(first_seen_utc, -1) = 'Z'),
            last_seen_utc TEXT CHECK(last_seen_utc IS NULL OR substr(last_seen_utc, -1) = 'Z'),
            retired_utc TEXT CHECK(retired_utc IS NULL OR substr(retired_utc, -1) = 'Z')
        )
        """
    )
    _require_columns(
        con,
        "device_sources",
        {
            "source_id",
            "source_uuid",
            "provider",
            "adapter_version",
            "sign_convention",
            "capabilities_json",
            "first_seen_utc",
            "retired_utc",
        },
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_device_sources_provider_active
        ON device_sources(provider, retired_utc)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS source_state (
            state_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            state_kind TEXT NOT NULL,
            state_value TEXT NOT NULL,
            effective_at_utc TEXT NOT NULL CHECK(substr(effective_at_utc, -1) = 'Z'),
            received_at_utc TEXT NOT NULL CHECK(substr(received_at_utc, -1) = 'Z'),
            quality_flags TEXT NOT NULL DEFAULT '[]',
            details_json TEXT NOT NULL DEFAULT '{}',
            cleared_at_utc TEXT CHECK(cleared_at_utc IS NULL OR substr(cleared_at_utc, -1) = 'Z')
        )
        """
    )
    _require_columns(
        con,
        "source_state",
        {
            "state_id",
            "source_id",
            "state_kind",
            "state_value",
            "effective_at_utc",
            "received_at_utc",
        },
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_source_state_source_time
        ON source_state(source_id, effective_at_utc)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS backfill_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            idempotency_key TEXT NOT NULL UNIQUE,
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            provider TEXT NOT NULL,
            requested_start_utc TEXT NOT NULL CHECK(substr(requested_start_utc, -1) = 'Z'),
            requested_end_utc TEXT NOT NULL CHECK(substr(requested_end_utc, -1) = 'Z'),
            capability_version TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
            cursor TEXT,
            started_at_utc TEXT CHECK(started_at_utc IS NULL OR substr(started_at_utc, -1) = 'Z'),
            completed_at_utc TEXT CHECK(completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
            rows_seen INTEGER NOT NULL DEFAULT 0 CHECK(rows_seen >= 0),
            rows_inserted INTEGER NOT NULL DEFAULT 0 CHECK(rows_inserted >= 0),
            rows_deduplicated INTEGER NOT NULL DEFAULT 0 CHECK(rows_deduplicated >= 0),
            error_code TEXT,
            error_message_redacted TEXT,
            CHECK(requested_end_utc > requested_start_utc)
        )
        """
    )
    _require_columns(
        con,
        "backfill_runs",
        {
            "run_id",
            "idempotency_key",
            "source_id",
            "requested_start_utc",
            "requested_end_utc",
            "status",
        },
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_backfill_runs_source_status
        ON backfill_runs(source_id, status)
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_samples (
            sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            observed_at_utc TEXT CHECK(observed_at_utc IS NULL OR substr(observed_at_utc, -1) = 'Z'),
            received_at_utc TEXT NOT NULL CHECK(substr(received_at_utc, -1) = 'Z'),
            source_time_text TEXT,
            source_timezone TEXT,
            dedupe_key TEXT NOT NULL,
            pv_power_w REAL,
            house_power_w REAL,
            grid_power_w REAL,
            grid_import_total_kwh REAL,
            grid_export_total_kwh REAL,
            pv_energy_today_kwh REAL,
            pv_energy_year_kwh REAL,
            pv_energy_lifetime_kwh REAL,
            source_available INTEGER NOT NULL CHECK(source_available IN (0, 1)),
            provenance TEXT NOT NULL CHECK(provenance IN ('measured', 'backfilled')),
            quality_state TEXT NOT NULL,
            quality_flags TEXT NOT NULL DEFAULT '[]',
            adapter_version TEXT NOT NULL,
            payload_fingerprint TEXT,
            UNIQUE(source_id, dedupe_key)
        )
        """
    )
    _require_columns(
        con,
        "raw_samples",
        {
            "sample_id",
            "source_id",
            "received_at_utc",
            "dedupe_key",
            "pv_power_w",
            "house_power_w",
            "grid_power_w",
            "grid_import_total_kwh",
            "grid_export_total_kwh",
            "source_available",
            "provenance",
            "quality_state",
        },
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_raw_samples_source_received
        ON raw_samples(source_id, received_at_utc)
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_raw_samples_source_observed
        ON raw_samples(source_id, observed_at_utc)
        """
    )

    _validate_phase0_table_shapes(con)

    now = _utc_now_text()
    con.execute(
        """
        INSERT OR IGNORE INTO application_metadata (key, value_json, updated_at_utc)
        VALUES ('database_uuid', ?, ?)
        """,
        (json.dumps(str(uuid4())), now),
    )
    con.execute(
        """
        INSERT OR REPLACE INTO application_metadata (key, value_json, updated_at_utc)
        VALUES ('schema_owner', ?, ?)
        """,
        (json.dumps("PRAGMA user_version + schema_migrations"), now),
    )

    _seed_ledger_for_completed_versions(con, through_version=2)
    _migrate_v2_samples_additively(con, now)


def _migration_4(con: sqlite3.Connection) -> None:
    """Add non-overwriting tariff periods for auditable economy estimates."""
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS tariff_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tariff_type TEXT NOT NULL CHECK(
                tariff_type IN ('grid_work_price', 'feed_in_tariff', 'base_price')
            ),
            value_ct_per_kwh TEXT,
            annual_eur TEXT,
            valid_from TEXT NOT NULL CHECK(length(valid_from) = 10),
            valid_until TEXT CHECK(valid_until IS NULL OR length(valid_until) = 10),
            label TEXT,
            source_type TEXT NOT NULL,
            provisional INTEGER NOT NULL DEFAULT 0 CHECK(provisional IN (0, 1)),
            created_at TEXT NOT NULL CHECK(substr(created_at, -1) = 'Z'),
            updated_at TEXT NOT NULL CHECK(substr(updated_at, -1) = 'Z'),
            CHECK(valid_until IS NULL OR valid_until >= valid_from),
            CHECK(
                (tariff_type = 'base_price' AND annual_eur IS NOT NULL AND value_ct_per_kwh IS NULL)
                OR
                (tariff_type != 'base_price' AND value_ct_per_kwh IS NOT NULL AND annual_eur IS NULL)
            )
        )
        """
    )
    con.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tariff_periods_type_validity
        ON tariff_periods(tariff_type, valid_from, valid_until)
        """
    )
    _require_columns(
        con,
        "tariff_periods",
        {
            "id", "tariff_type", "value_ct_per_kwh", "annual_eur",
            "valid_from", "valid_until", "label", "source_type",
            "provisional", "created_at", "updated_at",
        },
    )


def _migration_5(con: sqlite3.Connection) -> None:
    """Add recording runs, synchronized anchors, counter epochs and gaps."""
    script = """
        CREATE TABLE IF NOT EXISTS recording_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at_utc TEXT NOT NULL CHECK(substr(started_at_utc, -1) = 'Z'),
            clean_shutdown_at_utc TEXT CHECK(clean_shutdown_at_utc IS NULL OR substr(clean_shutdown_at_utc, -1) = 'Z'),
            app_version TEXT NOT NULL,
            mode TEXT NOT NULL,
            process_identity TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS counter_epochs (
            epoch_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            register_name TEXT NOT NULL,
            unit TEXT NOT NULL,
            scale TEXT NOT NULL,
            started_at_utc TEXT NOT NULL CHECK(substr(started_at_utc, -1) = 'Z'),
            ended_at_utc TEXT CHECK(ended_at_utc IS NULL OR substr(ended_at_utc, -1) = 'Z'),
            end_reason TEXT,
            source_firmware TEXT,
            source_counter_identity TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_counter_epoch_active
            ON counter_epochs(source_id, register_name, source_counter_identity)
            WHERE ended_at_utc IS NULL;

        CREATE TABLE IF NOT EXISTS counter_anchors (
            anchor_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL REFERENCES recording_runs(run_id),
            trigger TEXT NOT NULL,
            requested_at_utc TEXT NOT NULL CHECK(substr(requested_at_utc, -1) = 'Z'),
            completed_at_utc TEXT NOT NULL CHECK(substr(completed_at_utc, -1) = 'Z'),
            status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'failed')),
            skew_ms INTEGER CHECK(skew_ms IS NULL OR skew_ms >= 0),
            sequence INTEGER NOT NULL UNIQUE,
            idempotency_key TEXT NOT NULL UNIQUE,
            timing_state TEXT NOT NULL DEFAULT 'normal'
        );

        CREATE TABLE IF NOT EXISTS anchor_source_results (
            anchor_id INTEGER NOT NULL REFERENCES counter_anchors(anchor_id) ON DELETE CASCADE,
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            observed_at_utc TEXT CHECK(observed_at_utc IS NULL OR substr(observed_at_utc, -1) = 'Z'),
            received_at_utc TEXT NOT NULL CHECK(substr(received_at_utc, -1) = 'Z'),
            status TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failed', 'not_configured')),
            error_code TEXT,
            PRIMARY KEY(anchor_id, source_id)
        );

        CREATE TABLE IF NOT EXISTS counter_readings (
            reading_id INTEGER PRIMARY KEY AUTOINCREMENT,
            anchor_id INTEGER NOT NULL REFERENCES counter_anchors(anchor_id) ON DELETE CASCADE,
            epoch_id INTEGER NOT NULL REFERENCES counter_epochs(epoch_id),
            source_id INTEGER NOT NULL REFERENCES device_sources(source_id),
            register_name TEXT NOT NULL,
            observed_at_utc TEXT NOT NULL CHECK(substr(observed_at_utc, -1) = 'Z'),
            received_at_utc TEXT NOT NULL CHECK(substr(received_at_utc, -1) = 'Z'),
            value_decimal TEXT NOT NULL,
            source_sequence TEXT,
            UNIQUE(anchor_id, source_id, register_name),
            UNIQUE(epoch_id, observed_at_utc, value_decimal)
        );
        CREATE INDEX IF NOT EXISTS idx_counter_readings_register_anchor
            ON counter_readings(source_id, register_name, anchor_id);

        CREATE TABLE IF NOT EXISTS recording_gaps (
            gap_id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL,
            source_id INTEGER REFERENCES device_sources(source_id),
            from_utc TEXT NOT NULL CHECK(substr(from_utc, -1) = 'Z'),
            to_utc TEXT NOT NULL CHECK(substr(to_utc, -1) = 'Z'),
            reason TEXT NOT NULL,
            detected_at_utc TEXT NOT NULL CHECK(substr(detected_at_utc, -1) = 'Z'),
            details_json TEXT NOT NULL DEFAULT '{}',
            UNIQUE(scope, source_id, from_utc, to_utc, reason),
            CHECK(to_utc >= from_utc)
        );
        CREATE INDEX IF NOT EXISTS idx_recording_gaps_time
            ON recording_gaps(from_utc, to_utc);
        """
    for statement in script.split(";"):
        if statement.strip():
            con.execute(statement)
    required = {
        "recording_runs": {"run_id", "started_at_utc", "clean_shutdown_at_utc", "process_identity"},
        "counter_epochs": {"epoch_id", "source_id", "register_name", "started_at_utc", "ended_at_utc"},
        "counter_anchors": {"anchor_id", "run_id", "status", "skew_ms", "sequence", "idempotency_key"},
        "anchor_source_results": {"anchor_id", "source_id", "observed_at_utc", "status"},
        "counter_readings": {"reading_id", "anchor_id", "epoch_id", "register_name", "value_decimal"},
        "recording_gaps": {"gap_id", "scope", "from_utc", "to_utc", "reason"},
    }
    for table, columns in required.items():
        _require_columns(con, table, columns)


def _migration_6(con: sqlite3.Connection) -> None:
    """Provenance-separated persistence for Fronius local-archive history.

    Historical Provider Truth is kept strictly apart from recorder samples and
    counter anchors: it never enters energy_samples_v1 or the counter tables.
    """
    script = """
        CREATE TABLE IF NOT EXISTS provider_archive_sources (
            source_id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            device_key TEXT NOT NULL,
            device_identity TEXT,
            base_fingerprint TEXT,
            timezone_name TEXT,
            first_seen_utc TEXT NOT NULL CHECK(substr(first_seen_utc, -1) = 'Z'),
            last_seen_utc TEXT CHECK(last_seen_utc IS NULL OR substr(last_seen_utc, -1) = 'Z'),
            UNIQUE(provider, device_key)
        );

        CREATE TABLE IF NOT EXISTS provider_archive_imports (
            import_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES provider_archive_sources(source_id),
            requested_from_utc TEXT NOT NULL CHECK(substr(requested_from_utc, -1) = 'Z'),
            requested_to_utc TEXT NOT NULL CHECK(substr(requested_to_utc, -1) = 'Z'),
            started_at_utc TEXT NOT NULL CHECK(substr(started_at_utc, -1) = 'Z'),
            completed_at_utc TEXT CHECK(completed_at_utc IS NULL OR substr(completed_at_utc, -1) = 'Z'),
            status TEXT NOT NULL CHECK(status IN (
                'complete','partial','source_unavailable','source_unsupported',
                'outside_retention','import_failed','conflict','no_archive_data'
            )),
            points_ingested INTEGER NOT NULL DEFAULT 0,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            reason TEXT,
            idempotency_key TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS provider_archive_points (
            point_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL REFERENCES provider_archive_sources(source_id),
            import_id INTEGER NOT NULL REFERENCES provider_archive_imports(import_id),
            channel TEXT NOT NULL,
            observed_at_utc TEXT NOT NULL CHECK(substr(observed_at_utc, -1) = 'Z'),
            interval_seconds INTEGER CHECK(interval_seconds IS NULL OR interval_seconds >= 0),
            value_decimal TEXT NOT NULL,
            unit TEXT,
            measurement_kind TEXT NOT NULL CHECK(measurement_kind IN (
                'interval_total','interval_average','instantaneous','status','unsupported'
            )),
            quality_state TEXT NOT NULL DEFAULT 'measured',
            provenance TEXT NOT NULL DEFAULT 'fronius_local_archive',
            dedupe_key TEXT NOT NULL UNIQUE,
            UNIQUE(source_id, channel, observed_at_utc)
        );
        CREATE INDEX IF NOT EXISTS idx_archive_points_channel_time
            ON provider_archive_points(source_id, channel, observed_at_utc);
        """
    for statement in script.split(";"):
        if statement.strip():
            con.execute(statement)
    required = {
        "provider_archive_sources": {"source_id", "provider", "device_key", "timezone_name"},
        "provider_archive_imports": {"import_id", "source_id", "status", "idempotency_key"},
        "provider_archive_points": {"point_id", "source_id", "channel", "observed_at_utc",
                                     "value_decimal", "measurement_kind", "dedupe_key"},
    }
    for table, columns in required.items():
        _require_columns(con, table, columns)


MIGRATIONS: tuple[Migration, ...] = (
    Migration(1, "legacy-production", "production-v1-columns", _migration_1),
    Migration(2, "combined-energy-samples", "energy-samples-v1-additive", _migration_2),
    Migration(
        3,
        "energy-memory-schema-foundation",
        "schema-ledger-metadata-sources-state-backfill-raw-v1",
        _migration_3,
    ),
    Migration(
        4,
        "solar-economy-tariff-periods",
        "additive-tariff-periods-v1-decimal-text-inclusive-date-ranges",
        _migration_4,
    ),
    Migration(
        5,
        "continuous-recording-counter-anchors",
        "runs-epochs-anchors-readings-gaps-v1-decimal-text",
        _migration_5,
    ),
    Migration(
        6,
        "fronius-local-archive-provenance",
        "provider-archive-sources-imports-points-v1-provenance-separated",
        _migration_6,
    ),
)

_MIGRATION_BY_VERSION = {migration.version: migration for migration in MIGRATIONS}


def _seed_ledger_for_completed_versions(
    con: sqlite3.Connection, *, through_version: int
) -> None:
    _create_migration_ledger(con)
    now = _utc_now_text()
    for migration in MIGRATIONS:
        if migration.version > through_version:
            break
        con.execute(
            """
            INSERT OR IGNORE INTO schema_migrations
                (version, name, checksum, applied_at_utc, app_version)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                migration.version,
                migration.name,
                migration.checksum,
                now,
                config.APP_VERSION,
            ),
        )


def _legacy_received_utc(value: str) -> str:
    """Mark the v2 receive timestamp as UTC without altering its wall value."""
    text = str(value).strip()
    return text if text.endswith("Z") else f"{text}Z"


def _migrate_v2_samples_additively(con: sqlite3.Connection, now: str) -> None:
    """Copy v2 values into auditable legacy source rows; keep v2 untouched."""
    if not _table_exists(con, "energy_samples_v1"):
        return

    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM energy_samples_v1 ORDER BY id").fetchall()
    if not rows:
        return

    has_pv = any(
        row["pv_power_w"] is not None or row["pv_energy_today_wh"] is not None
        for row in rows
    )
    has_grid = any(
        row["grid_power_w"] is not None
        or row["grid_import_total_wh"] is not None
        or row["grid_export_total_wh"] is not None
        for row in rows
    )

    source_ids: dict[str, int] = {}
    source_specs = []
    if has_pv:
        source_specs.append(
            (
                "legacy-fronius-v2",
                "fronius",
                "Legacy Fronius source",
                None,
            )
        )
    if has_grid:
        source_specs.append(
            (
                "legacy-tasmota-v2",
                "tasmota",
                "Legacy Tasmota smart meter",
                "grid_positive_import_v1",
            )
        )

    for source_uuid, provider, display_name, sign_convention in source_specs:
        con.execute(
            """
            INSERT OR IGNORE INTO device_sources (
                source_uuid, provider, display_name, adapter_version,
                sign_convention, capabilities_json, first_seen_utc
            ) VALUES (?, ?, ?, 'legacy-v2', ?, '{}', ?)
            """,
            (source_uuid, provider, display_name, sign_convention, now),
        )
        source_ids[source_uuid] = int(
            con.execute(
                "SELECT source_id FROM device_sources WHERE source_uuid = ?",
                (source_uuid,),
            ).fetchone()[0]
        )

    for row in rows:
        row_id = row["id"]
        received = _legacy_received_utc(row["received_at"])
        if has_pv and (
            row["pv_power_w"] is not None or row["pv_energy_today_wh"] is not None
        ):
            con.execute(
                """
                INSERT OR IGNORE INTO raw_samples (
                    source_id, observed_at_utc, received_at_utc,
                    source_time_text, dedupe_key,
                    pv_power_w, pv_energy_today_kwh,
                    source_available, provenance, quality_state,
                    quality_flags, adapter_version
                ) VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 'measured', ?, '[]', 'legacy-v2')
                """,
                (
                    source_ids["legacy-fronius-v2"],
                    received,
                    row["pv_measured_at"],
                    f"energy_samples_v1:pv:{row_id}",
                    row["pv_power_w"],
                    (
                        row["pv_energy_today_wh"] / 1000.0
                        if row["pv_energy_today_wh"] is not None
                        else None
                    ),
                    row["pv_quality_status"],
                ),
            )
        if has_grid and (
            row["grid_power_w"] is not None
            or row["grid_import_total_wh"] is not None
            or row["grid_export_total_wh"] is not None
        ):
            con.execute(
                """
                INSERT OR IGNORE INTO raw_samples (
                    source_id, observed_at_utc, received_at_utc,
                    source_time_text, dedupe_key,
                    grid_power_w, grid_import_total_kwh, grid_export_total_kwh,
                    source_available, provenance, quality_state,
                    quality_flags, adapter_version
                ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, 'measured', ?, '[]', 'legacy-v2')
                """,
                (
                    source_ids["legacy-tasmota-v2"],
                    received,
                    row["grid_measured_at"],
                    f"energy_samples_v1:grid:{row_id}",
                    row["grid_power_w"],
                    (
                        row["grid_import_total_wh"] / 1000.0
                        if row["grid_import_total_wh"] is not None
                        else None
                    ),
                    (
                        row["grid_export_total_wh"] / 1000.0
                        if row["grid_export_total_wh"] is not None
                        else None
                    ),
                    row["grid_quality_status"],
                ),
            )
    con.row_factory = None


def _validate_migration_ledger(con: sqlite3.Connection, user_version: int) -> None:
    if not _table_exists(con, "schema_migrations"):
        if user_version >= 3:
            raise MigrationMetadataError(
                "schema_migrations is missing for a version 3+ database"
            )
        return

    required = {"version", "name", "checksum", "applied_at_utc", "app_version"}
    if not required.issubset(_table_columns(con, "schema_migrations")):
        raise MigrationMetadataError("schema_migrations has an unsupported shape")

    rows = con.execute(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
    ).fetchall()
    versions = [int(row[0]) for row in rows]
    if versions and versions != list(range(1, max(versions) + 1)):
        raise MigrationMetadataError("schema_migrations versions are not contiguous")

    for version, name, checksum in rows:
        migration = _MIGRATION_BY_VERSION.get(int(version))
        if migration is None:
            if int(version) > config.SCHEMA_VERSION:
                raise UnsupportedSchemaVersion(
                    f"Database schema v{version} is newer than supported v{config.SCHEMA_VERSION}"
                )
            raise MigrationMetadataError(f"Unknown migration version {version}")
        if name != migration.name or checksum != migration.checksum:
            raise MigrationMetadataError(
                f"Migration metadata mismatch for version {version}"
            )

    ledger_version = max(versions, default=0)
    if user_version >= 3 and ledger_version != user_version:
        raise MigrationMetadataError(
            "PRAGMA user_version and schema_migrations do not agree"
        )


def _detect_current_version(con: sqlite3.Connection) -> int:
    user_version = int(con.execute("PRAGMA user_version").fetchone()[0])
    if user_version > config.SCHEMA_VERSION:
        raise UnsupportedSchemaVersion(
            f"Database schema v{user_version} is newer than supported v{config.SCHEMA_VERSION}"
        )
    _validate_migration_ledger(con, user_version)
    if user_version > 0:
        return user_version

    if _table_exists(con, "schema_migrations"):
        rows = con.execute("SELECT version FROM schema_migrations").fetchall()
        if rows:
            raise MigrationMetadataError(
                "schema_migrations exists but PRAGMA user_version is zero"
            )

    if _table_exists(con, "schema_info"):
        if "version" not in _table_columns(con, "schema_info"):
            raise MigrationMetadataError("schema_info has no version column")
        rows = con.execute("SELECT version FROM schema_info").fetchall()
        if len(rows) != 1:
            raise MigrationMetadataError(
                "schema_info must contain exactly one version row"
            )
        try:
            version = int(rows[0][0])
        except (TypeError, ValueError) as exc:
            raise MigrationMetadataError("schema_info version is invalid") from exc
        if version > config.SCHEMA_VERSION:
            raise UnsupportedSchemaVersion(
                f"Database schema v{version} is newer than supported v{config.SCHEMA_VERSION}"
            )
        return version

    if _table_exists(con, "energy_samples_v1"):
        return 2
    if _table_exists(con, "production"):
        return 1
    return 0


def _record_migration(con: sqlite3.Connection, migration: Migration) -> None:
    if migration.version >= 3:
        _create_migration_ledger(con)
        con.execute(
            """
            INSERT INTO schema_migrations
                (version, name, checksum, applied_at_utc, app_version)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                migration.version,
                migration.name,
                migration.checksum,
                _utc_now_text(),
                config.APP_VERSION,
            ),
        )
    _set_legacy_schema_version(con, migration.version)
    con.execute(f"PRAGMA user_version = {migration.version}")


def run_migrations() -> None:
    """Bring the configured database to ``config.SCHEMA_VERSION`` safely.

    Migrations run automatically at desktop startup and lazily before the
    first storage connection. Existing databases receive one consistent
    pre-migration backup. Each migration is idempotently selected by version,
    executes in its own transaction, and rolls back fully on failure.
    """
    with _MIGRATION_LOCK:
        database_path = Path(config.DB_PATH)
        database_path.parent.mkdir(parents=True, exist_ok=True)
        existed_before = database_path.exists()
        backup_path: Path | None = None

        con = _open_connection(database_path)
        try:
            current = _detect_current_version(con)
            if current == config.SCHEMA_VERSION:
                _integrity_check(con)
                _foreign_key_check(con)
                return

            _integrity_check(con)
            for migration in MIGRATIONS:
                if migration.version <= current:
                    continue
                try:
                    # Re-read the authoritative version while holding SQLite's
                    # write reservation. Another process may have completed the
                    # same migration since our initial inspection.
                    con.execute("BEGIN IMMEDIATE")
                    current = _detect_current_version(con)
                    if migration.version <= current:
                        con.rollback()
                        continue
                    if migration.version != current + 1:
                        raise MigrationMetadataError(
                            "Pending migrations are not contiguous"
                        )
                    if existed_before and backup_path is None:
                        backup_path = _create_consistent_backup(
                            database_path, current, config.SCHEMA_VERSION
                        )
                    log.info(
                        "Migrating database from v%s to v%s (%s)",
                        current,
                        migration.version,
                        migration.name,
                    )
                    migration.apply(con)
                    _record_migration(con, migration)
                    _foreign_key_check(con)
                    con.commit()
                except Exception:
                    con.rollback()
                    log.exception(
                        "Migration v%s (%s) failed and was rolled back",
                        migration.version,
                        migration.name,
                    )
                    raise
                current = migration.version

            _integrity_check(con)
            _validate_migration_ledger(con, current)
            log.info("Database migration completed at schema v%s", current)
        except Exception:
            log.exception("Database migration startup check failed")
            raise
        finally:
            con.close()
