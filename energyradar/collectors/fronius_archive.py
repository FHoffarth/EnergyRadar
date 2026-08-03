"""Read-only client + parser for the Fronius Solar API local archive.

Proven against a real Fronius datalogger (Solar API v1, CompatibilityRange 1.8-1):

- ``GET /solar_api/v1/GetArchiveData.cgi?Scope=System&StartDate=&EndDate=&Channel=...``
- ``Body.Data["inverter/N"].Data[<channel>].Values`` maps an integer *second
  offset from the local ``Start``* to the channel value.
- ``Start``/``End`` carry the device's local UTC offset (DST-correct: ``+02:00``
  in summer, ``+01:00`` in winter).
- Max query window is **16 days** (``Head.Status.Code == 255`` otherwise).
- ``EnergyReal_WAC_Sum_Produced`` (Wh) is an **interval total** and its per-day
  sum equals ``E_Day`` — so it is factual energy history, never power integration.

This module only *reads* and *parses*. It never persists and never mutates the
device. Provenance-separated persistence is handled by ``services.archive_ingest``.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import time
from typing import Any, Callable, Iterable
import json
import urllib.request

# Fronius restricts a single GetArchiveData query to 16 days.
MAX_QUERY_DAYS = 16

# Channel -> (measurement_kind). Anything unlisted is 'unsupported' and never
# treated as a factual total.
CHANNEL_KIND: dict[str, str] = {
    "EnergyReal_WAC_Sum_Produced": "interval_total",   # Wh, sums to E_Day
    "PowerReal_PAC_Sum": "interval_average",            # W
    "Current_DC_String_1": "interval_average",          # A
    "Voltage_DC_String_1": "interval_average",          # V
    "Temperature_Powerstage": "interval_average",       # °C
}

DEFAULT_CHANNELS = ("EnergyReal_WAC_Sum_Produced", "PowerReal_PAC_Sum", "TimeSpanInSec")


class ArchiveError(RuntimeError):
    """Archive request could not be completed."""


class ArchiveRangeRestricted(ArchiveError):
    """The device rejected the query window (e.g. > 16 days)."""


@dataclass(frozen=True)
class ArchivePoint:
    device_key: str
    channel: str
    observed_at_utc: str      # ISO 8601 'Z'
    interval_seconds: int | None
    value: Decimal
    unit: str | None
    measurement_kind: str


def daterange_chunks(start: date, end: date, *, max_days: int = MAX_QUERY_DAYS) -> list[tuple[date, date]]:
    """Split an inclusive [start, end] date range into <= max_days windows.

    Deterministic and gap-free: chunks tile the range with no overlap and no
    hole, so repeated imports of the same range are stable.
    """
    if end < start:
        raise ValueError("end date precedes start date")
    chunks: list[tuple[date, date]] = []
    cursor = start
    span = timedelta(days=max_days - 1)
    while cursor <= end:
        chunk_end = min(cursor + span, end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def _to_utc_z(local_start: str, offset_seconds_key: str | int) -> str:
    """``Start`` (offset-aware) + integer second offset -> UTC 'Z' timestamp."""
    base = datetime.fromisoformat(str(local_start))
    if base.tzinfo is None:
        raise ArchiveError("archive Start timestamp is not offset-aware")
    moment = base + timedelta(seconds=int(offset_seconds_key))
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_archive(payload: dict[str, Any]) -> list[ArchivePoint]:
    """Parse one GetArchiveData response into normalized points.

    Missing samples stay missing — gaps are never interpolated. Values are read
    verbatim (interval totals are NOT re-derived from power).
    """
    head = payload.get("Head", {}) or {}
    status = head.get("Status", {}) or {}
    code = status.get("Code")
    if code == 255:
        raise ArchiveRangeRestricted(status.get("Reason") or "query interval restricted")
    if code not in (0, None):
        raise ArchiveError(f"archive status code {code}: {status.get('Reason') or ''}".strip())

    data = (payload.get("Body", {}) or {}).get("Data", {}) or {}
    points: list[ArchivePoint] = []
    for device_key, device in data.items():
        local_start = device.get("Start")
        if not local_start:
            continue
        channels = device.get("Data") or {}
        spans = ((channels.get("TimeSpanInSec") or {}).get("Values")) or {}
        for channel, block in channels.items():
            if channel == "TimeSpanInSec":
                continue
            kind = CHANNEL_KIND.get(channel, "unsupported")
            unit = block.get("Unit")
            for key, raw in (block.get("Values") or {}).items():
                if raw is None:
                    continue  # never invent a point
                observed = _to_utc_z(local_start, key)
                span = spans.get(key)
                points.append(ArchivePoint(
                    device_key=str(device_key),
                    channel=str(channel),
                    observed_at_utc=observed,
                    interval_seconds=int(span) if isinstance(span, (int, float)) else None,
                    value=Decimal(str(raw)),
                    unit=unit,
                    measurement_kind=kind,
                ))
    return points


def archive_timezone(payload: dict[str, Any]) -> str | None:
    """Return the device-local offset (e.g. '+02:00') from the first device Start."""
    data = (payload.get("Body", {}) or {}).get("Data", {}) or {}
    for device in data.values():
        start = device.get("Start")
        if start:
            dt = datetime.fromisoformat(str(start))
            if dt.tzinfo is not None:
                return dt.strftime("%z")
    return None


def fetch_archive(
    base_url: str,
    start: date,
    end: date,
    *,
    channels: Iterable[str] = DEFAULT_CHANNELS,
    scope: str = "System",
    timeout: float = 20.0,
    retries: int = 2,
    backoff: float = 0.5,
    opener: Callable[[str, float], bytes] | None = None,
) -> dict[str, Any]:
    """Read one <=16-day window from the device. Read-only GET with retry/backoff.

    ``base_url`` is the device origin (``http://host``); no credentials, no
    redirects followed by the default opener. Callers pass sanitized origins.
    """
    if (end - start).days >= MAX_QUERY_DAYS:
        raise ArchiveRangeRestricted(f"window exceeds {MAX_QUERY_DAYS} days")
    query = f"/solar_api/v1/GetArchiveData.cgi?Scope={scope}&StartDate={start.isoformat()}&EndDate={end.isoformat()}"
    for channel in channels:
        query += f"&Channel={channel}"
    url = base_url.rstrip("/") + query

    def _default_opener(u: str, t: float) -> bytes:
        with urllib.request.urlopen(u, timeout=t) as response:  # noqa: S310 (local device)
            return response.read()

    read = opener or _default_opener
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            raw = read(url, timeout)
            return json.loads(raw.decode("utf-8", "replace"))
        except Exception as exc:  # network/JSON errors are retryable
            last_exc = exc
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
    raise ArchiveError(f"archive fetch failed: {type(last_exc).__name__}: {last_exc}")
