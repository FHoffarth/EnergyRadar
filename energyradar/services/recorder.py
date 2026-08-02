"""Atomic SQLite recorder for runs, source results and counter anchors."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
import sqlite3
import threading
from typing import Mapping
from uuid import uuid4

from energyradar import config
from energyradar.services import migration


class _ClosingConnection(sqlite3.Connection):
    """Commit/rollback like sqlite3.Connection, then release the file handle."""

    def __exit__(self, exc_type, exc, traceback):
        try:
            return super().__exit__(exc_type, exc, traceback)
        finally:
            self.close()


def utc_text(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("UTC persistence requires timezone-aware datetime")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def exact_decimal(value: object) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise ValueError("counter value unavailable")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid counter value") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("counter value must be finite and non-negative")
    return result


def stable_source_uuid(provider: str, identity: str) -> str:
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"{provider}:{digest}"


@dataclass(frozen=True)
class SourceCapture:
    source_uuid: str
    provider: str
    display_name: str
    observed_at: datetime | None
    received_at: datetime
    status: str
    counters: Mapping[str, object] = field(default_factory=dict)
    counter_identity: str = "default"
    firmware: str | None = None
    capabilities: tuple[str, ...] = ()
    error_code: str | None = None
    measurements: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class AnchorCapture:
    trigger: str
    requested_at: datetime
    completed_at: datetime
    sources: tuple[SourceCapture, ...]
    idempotency_key: str
    timing_state: str = "normal"


class CounterRecorder:
    def __init__(self, *, database_path=None, now=None, process_identity: str | None = None) -> None:
        self.database_path = database_path or config.DB_PATH
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.process_identity = process_identity or f"{os.getpid()}:{uuid4()}"
        self._lock = threading.RLock()
        self.run_id: int | None = None
        self.started_at: datetime | None = None

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(
            self.database_path,
            timeout=migration.BUSY_TIMEOUT_MS / 1000,
            factory=_ClosingConnection,
        )
        con.execute("PRAGMA foreign_keys = ON")
        con.execute(f"PRAGMA busy_timeout = {migration.BUSY_TIMEOUT_MS}")
        con.execute("PRAGMA journal_mode = WAL")
        con.execute("PRAGMA synchronous = FULL")
        return con

    def start_run(self, *, mode: str = "live") -> int:
        migration.run_migrations()
        started = self.now()
        with self._lock, self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            previous = con.execute(
                "SELECT run_id, started_at_utc, clean_shutdown_at_utc FROM recording_runs ORDER BY run_id DESC LIMIT 1"
            ).fetchone()
            if previous is not None and previous[2] is None:
                last = con.execute("SELECT completed_at_utc FROM counter_anchors WHERE run_id = ? ORDER BY sequence DESC LIMIT 1", (previous[0],)).fetchone()
                gap_from = last[0] if last else previous[1]
                con.execute(
                    "INSERT OR IGNORE INTO recording_gaps(scope, source_id, from_utc, to_utc, reason, detected_at_utc) VALUES('process', NULL, ?, ?, 'crash', ?)",
                    (gap_from, utc_text(started), utc_text(started)),
                )
            cur = con.execute(
                "INSERT INTO recording_runs(started_at_utc, app_version, mode, process_identity) VALUES(?, ?, ?, ?)",
                (utc_text(started), config.APP_VERSION, mode, self.process_identity),
            )
            self.run_id = int(cur.lastrowid)
            self.started_at = started
        return self.run_id

    def finish_run(self) -> None:
        if self.run_id is None:
            return
        with self._lock, self._connect() as con:
            con.execute("UPDATE recording_runs SET clean_shutdown_at_utc = ? WHERE run_id = ? AND clean_shutdown_at_utc IS NULL", (utc_text(self.now()), self.run_id))

    def _source_id(self, con: sqlite3.Connection, source: SourceCapture) -> int:
        now = utc_text(source.received_at)
        con.execute(
            """INSERT OR IGNORE INTO device_sources(
                source_uuid, provider, display_name, adapter_version,
                capabilities_json, first_seen_utc
            ) VALUES(?, ?, ?, 'continuous-v1', ?, ?)""",
            (source.source_uuid, source.provider, source.display_name, json.dumps(source.capabilities), now),
        )
        con.execute(
            "UPDATE device_sources SET last_seen_utc = ?, firmware = COALESCE(?, firmware), capabilities_json = ? WHERE source_uuid = ?",
            (now, source.firmware, json.dumps(source.capabilities), source.source_uuid),
        )
        return int(con.execute("SELECT source_id FROM device_sources WHERE source_uuid = ?", (source.source_uuid,)).fetchone()[0])

    def _epoch_for(self, con: sqlite3.Connection, *, source_id: int, register: str, identity: str, value: Decimal, at: str, firmware: str | None) -> int:
        con.execute(
            """UPDATE counter_epochs
               SET ended_at_utc = ?, end_reason = 'source_counter_identity_changed'
               WHERE source_id = ? AND register_name = ?
                 AND source_counter_identity != ? AND ended_at_utc IS NULL""",
            (at, source_id, register, identity),
        )
        row = con.execute(
            "SELECT epoch_id FROM counter_epochs WHERE source_id = ? AND register_name = ? AND source_counter_identity = ? AND ended_at_utc IS NULL",
            (source_id, register, identity),
        ).fetchone()
        if row is not None:
            epoch_id = int(row[0])
            prior = con.execute(
                "SELECT value_decimal FROM counter_readings WHERE epoch_id = ? ORDER BY reading_id DESC LIMIT 1", (epoch_id,)
            ).fetchone()
            if prior is None or value >= Decimal(prior[0]):
                return epoch_id
            con.execute("UPDATE counter_epochs SET ended_at_utc = ?, end_reason = 'counter_reset' WHERE epoch_id = ?", (at, epoch_id))
        cur = con.execute(
            """INSERT INTO counter_epochs(
                source_id, register_name, unit, scale, started_at_utc,
                source_firmware, source_counter_identity
            ) VALUES(?, ?, 'kWh', '1', ?, ?, ?)""",
            (source_id, register, at, firmware, identity),
        )
        return int(cur.lastrowid)

    def record_anchor(self, capture: AnchorCapture, *, fail_after_anchor: bool = False) -> int:
        if self.run_id is None:
            raise RuntimeError("recording run has not started")
        if capture.completed_at < capture.requested_at:
            raise ValueError("anchor completion precedes request")
        successful = [s for s in capture.sources if s.status in {"success", "partial"}]
        all_required = {"pv_total", "grid_import_total", "grid_export_total"}
        present = {name for source in successful for name, value in source.counters.items() if value is not None}
        status = "complete" if all_required.issubset(present) else "partial" if present else "failed"
        observed = [s.observed_at or s.received_at for s in successful]
        skew_ms = int((max(observed) - min(observed)).total_seconds() * 1000) if len(observed) > 1 else 0 if observed else None

        with self._lock, self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            existing = con.execute("SELECT anchor_id FROM counter_anchors WHERE idempotency_key = ?", (capture.idempotency_key,)).fetchone()
            if existing is not None:
                return int(existing[0])
            sequence = int(con.execute("SELECT COALESCE(MAX(sequence), 0) + 1 FROM counter_anchors").fetchone()[0])
            cur = con.execute(
                """INSERT INTO counter_anchors(
                    run_id, trigger, requested_at_utc, completed_at_utc, status,
                    skew_ms, sequence, idempotency_key, timing_state
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (self.run_id, capture.trigger, utc_text(capture.requested_at), utc_text(capture.completed_at), status, skew_ms, sequence, capture.idempotency_key, capture.timing_state),
            )
            anchor_id = int(cur.lastrowid)
            if fail_after_anchor:
                raise RuntimeError("injected anchor transaction failure")
            for source in capture.sources:
                source_id = self._source_id(con, source)
                con.execute(
                    "INSERT INTO anchor_source_results(anchor_id, source_id, observed_at_utc, received_at_utc, status, error_code) VALUES(?, ?, ?, ?, ?, ?)",
                    (anchor_id, source_id, utc_text(source.observed_at) if source.observed_at else None, utc_text(source.received_at), source.status, source.error_code),
                )
                if source.status not in {"success", "partial"}:
                    continue
                observed_text = utc_text(source.observed_at or source.received_at)
                con.execute(
                    """INSERT OR IGNORE INTO raw_samples(
                        source_id, observed_at_utc, received_at_utc, dedupe_key,
                        pv_power_w, grid_power_w, grid_import_total_kwh,
                        grid_export_total_kwh, pv_energy_lifetime_kwh,
                        source_available, provenance, quality_state,
                        quality_flags, adapter_version
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'measured', ?, '[]', 'continuous-v1')""",
                    (
                        source_id, observed_text, utc_text(source.received_at),
                        f"counter-anchor:{anchor_id}:{source.source_uuid}",
                        float(source.measurements["pv_power_w"]) if source.measurements.get("pv_power_w") is not None else None,
                        float(source.measurements["grid_power_w"]) if source.measurements.get("grid_power_w") is not None else None,
                        float(source.counters["grid_import_total"]) if source.counters.get("grid_import_total") is not None else None,
                        float(source.counters["grid_export_total"]) if source.counters.get("grid_export_total") is not None else None,
                        float(source.counters["pv_total"]) if source.counters.get("pv_total") is not None else None,
                        "valid" if source.status == "success" else "partial",
                    ),
                )
                for register, raw_value in source.counters.items():
                    if raw_value is None:
                        continue
                    value = exact_decimal(raw_value)
                    at = observed_text
                    epoch_id = self._epoch_for(con, source_id=source_id, register=register, identity=source.counter_identity, value=value, at=at, firmware=source.firmware)
                    con.execute(
                        "INSERT OR IGNORE INTO counter_readings(anchor_id, epoch_id, source_id, register_name, observed_at_utc, received_at_utc, value_decimal) VALUES(?, ?, ?, ?, ?, ?, ?)",
                        (anchor_id, epoch_id, source_id, register, at, utc_text(source.received_at), format(value, "f")),
                    )
        return anchor_id

    def record_gap(self, *, scope: str, source_uuid: str | None, from_utc: datetime, to_utc: datetime, reason: str, details: Mapping[str, object] | None = None) -> None:
        with self._lock, self._connect() as con:
            source_id = None
            if source_uuid:
                row = con.execute("SELECT source_id FROM device_sources WHERE source_uuid = ?", (source_uuid,)).fetchone()
                source_id = int(row[0]) if row else None
            con.execute(
                "INSERT OR IGNORE INTO recording_gaps(scope, source_id, from_utc, to_utc, reason, detected_at_utc, details_json) VALUES(?, ?, ?, ?, ?, ?, ?)",
                (scope, source_id, utc_text(from_utc), utc_text(to_utc), reason, utc_text(self.now()), json.dumps(details or {})),
            )
