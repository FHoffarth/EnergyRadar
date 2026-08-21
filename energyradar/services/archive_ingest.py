"""Idempotent, crash-safe ingestion of Fronius local-archive history.

Reads through :mod:`energyradar.collectors.fronius_archive` and persists into the
provenance-separated ``provider_archive_*`` tables (migration 6). It never writes
to ``energy_samples_v1`` or the counter tables, never deletes, never overwrites
recorder truth, and never interpolates gaps. Re-running the same range is a
no-op (points are deduped; a completed import is short-circuited).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import sqlite3
from typing import Any, Callable

from energyradar import config
from energyradar.collectors import fronius_archive as archive
from energyradar.services import migration


def _utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class IngestResult:
    import_id: int | None
    status: str
    points_ingested: int
    chunk_count: int
    reason: str | None


def ingest_range(
    base_url: str,
    from_date: date,
    to_date: date,
    *,
    provider: str = "fronius_local_archive",
    device_key: str = "inverter/1",
    channels: tuple[str, ...] = archive.DEFAULT_CHANNELS,
    database_path=None,
    fetcher: Callable[..., dict[str, Any]] | None = None,
    force_refresh: bool = False,
) -> IngestResult:
    """Import [from_date, to_date] (inclusive, local dates) idempotently.

    ``force_refresh`` re-fetches even a previously-complete window (for the
    current day, which keeps growing); dedupe still prevents duplicate points.
    """
    migration.run_migrations()
    fetch = fetcher or archive.fetch_archive
    chunks = archive.daterange_chunks(from_date, to_date)
    idem = _fingerprint(f"{provider}|{device_key}|{from_date}|{to_date}|{','.join(sorted(channels))}")

    con = sqlite3.connect(database_path or config.DB_PATH, timeout=migration.BUSY_TIMEOUT_MS / 1000)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(f"PRAGMA busy_timeout = {migration.BUSY_TIMEOUT_MS}")
    try:
        existing = con.execute(
            "SELECT import_id, status, points_ingested, chunk_count, reason FROM provider_archive_imports WHERE idempotency_key = ?",
            (idem,),
        ).fetchone()
        if existing is not None and existing["status"] == "complete" and not force_refresh:
            return IngestResult(int(existing["import_id"]), "complete",
                                int(existing["points_ingested"]), int(existing["chunk_count"]), existing["reason"])

        now = _utc_now_text()
        source_id = _resolve_source(con, provider, device_key, base_url, now)
        req_from = f"{from_date.isoformat()}T00:00:00Z"
        req_to = f"{to_date.isoformat()}T23:59:59Z"
        with con:
            cur = con.execute(
                """INSERT OR IGNORE INTO provider_archive_imports
                   (source_id, requested_from_utc, requested_to_utc, started_at_utc, status, idempotency_key)
                   VALUES (?, ?, ?, ?, 'partial', ?)""",
                (source_id, req_from, req_to, now, idem),
            )
        import_row = con.execute("SELECT import_id FROM provider_archive_imports WHERE idempotency_key = ?", (idem,)).fetchone()
        import_id = int(import_row["import_id"])

        total_points = 0
        empty_chunks = 0
        restricted = False
        failed = False
        for chunk_start, chunk_end in chunks:
            try:
                payload = fetch(base_url, chunk_start, chunk_end, channels=channels)
                points = archive.parse_archive(payload)
            except archive.ArchiveRangeRestricted:
                restricted = True
                continue
            except archive.ArchiveError:
                failed = True
                continue
            if not points:
                empty_chunks += 1
                continue
            tz_name = archive.archive_timezone(payload)
            if tz_name:
                con.execute("UPDATE provider_archive_sources SET timezone_name = ?, last_seen_utc = ? WHERE source_id = ?",
                            (tz_name, _utc_now_text(), source_id))
            # One transaction per chunk → crash-safe resume; INSERT OR IGNORE
            # makes re-ingestion of an already-stored interval a no-op.
            with con:
                for p in points:
                    dedupe = f"{source_id}|{p.channel}|{p.observed_at_utc}"
                    inserted = con.execute(
                        """INSERT OR IGNORE INTO provider_archive_points
                           (source_id, import_id, channel, observed_at_utc, interval_seconds,
                            value_decimal, unit, measurement_kind, dedupe_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (source_id, import_id, p.channel, p.observed_at_utc, p.interval_seconds,
                         format(p.value, "f"), p.unit, p.measurement_kind, dedupe),
                    )
                    total_points += inserted.rowcount if inserted.rowcount and inserted.rowcount > 0 else 0

        status, reason = _classify(total_points, empty_chunks, len(chunks), restricted, failed)
        with con:
            con.execute(
                "UPDATE provider_archive_imports SET status = ?, points_ingested = ?, chunk_count = ?, reason = ?, completed_at_utc = ? WHERE import_id = ?",
                (status, total_points, len(chunks), reason, _utc_now_text(), import_id),
            )
        return IngestResult(import_id, status, total_points, len(chunks), reason)
    finally:
        con.close()


def catch_up(
    base_url: str,
    *,
    today: date | None = None,
    backfill_days: int = 7,
    database_path=None,
    fetcher: Callable[..., dict[str, Any]] | None = None,
) -> list[IngestResult]:
    """Bounded startup / incremental catch-up.

    Policy (see docs): import the recent ``backfill_days`` window once (idempotent,
    so already-complete days are skipped), then force-refresh the current day so
    new intervals are picked up after downtime. Never re-downloads full history;
    never blocks live polling (callers run this off the main path).
    """
    from datetime import timedelta

    day = today or date.today()
    results: list[IngestResult] = []
    window_start = day - timedelta(days=max(0, backfill_days - 1))
    if window_start < day:
        results.append(ingest_range(base_url, window_start, day - timedelta(days=1),
                                    database_path=database_path, fetcher=fetcher))
    results.append(ingest_range(base_url, day, day, database_path=database_path,
                                fetcher=fetcher, force_refresh=True))
    return results


def _resolve_source(con: sqlite3.Connection, provider: str, device_key: str, base_url: str, now: str) -> int:
    con.execute(
        """INSERT OR IGNORE INTO provider_archive_sources
           (provider, device_key, base_fingerprint, first_seen_utc)
           VALUES (?, ?, ?, ?)""",
        (provider, device_key, _fingerprint(base_url), now),
    )
    row = con.execute(
        "SELECT source_id FROM provider_archive_sources WHERE provider = ? AND device_key = ?",
        (provider, device_key),
    ).fetchone()
    con.commit()
    return int(row["source_id"])


def _classify(points: int, empty_chunks: int, chunk_count: int, restricted: bool, failed: bool) -> tuple[str, str | None]:
    if points > 0 and not failed and not restricted:
        return "complete", None
    if points > 0:
        return "partial", "partial_range_restricted" if restricted else "partial_chunk_failed"
    if restricted:
        return "source_unsupported", "query_window_restricted"
    if failed:
        return "import_failed", "archive_fetch_failed"
    if empty_chunks == chunk_count:
        return "no_archive_data", "outside_retention_or_empty"
    return "no_archive_data", None
