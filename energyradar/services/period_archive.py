"""Archive-backed period curve and PV total, from the provenance-separated
``provider_archive_*`` store (migration 6).

Read-only. Two responsibilities:

- ``archive_pv_energy`` — factual PV energy for a period by summing the
  ``EnergyReal_WAC_Sum_Produced`` interval totals (never power integration),
  labelled provenance ``fronius_local_archive``.
- ``build_period_curve`` — a source-tagged curve: healthy local samples are
  preferred, Fronius archive power fills intervals the local recorder is missing.
  Source boundaries are retained; overlapping timestamps are de-duplicated (local
  wins); genuine gaps are never interpolated.

Energy totals stay counter-derived upstream; the archive total is only a
lower-precedence PV source and is kept explicitly distinct from recorder truth.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

# Local sample and archive power points closer than this are treated as the same
# instant on the merged curve (local wins) so a mixed curve never double-plots.
_MERGE_WINDOW_SECONDS = 150

_ARCHIVE_ENERGY_CHANNEL = "EnergyReal_WAC_Sum_Produced"
_ARCHIVE_POWER_CHANNEL = "PowerReal_PAC_Sum"


def _z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _archive_available(con: sqlite3.Connection) -> bool:
    row = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='provider_archive_points'"
    ).fetchone()
    return row is not None


def archive_pv_energy(con: sqlite3.Connection, from_utc: datetime, to_utc: datetime) -> dict[str, Any]:
    """Sum archive interval-energy (Wh→kWh) over [from, to]. Provider Truth."""
    if not _archive_available(con):
        return {"value_kwh": None, "source": "unavailable", "provenance": None,
                "coverage_state": "unavailable", "reason": "archive_not_present",
                "n_points": 0, "first": None, "last": None}
    rows = con.execute(
        """SELECT observed_at_utc, value_decimal FROM provider_archive_points
           WHERE channel = ? AND observed_at_utc >= ? AND observed_at_utc <= ?
           ORDER BY observed_at_utc""",
        (_ARCHIVE_ENERGY_CHANNEL, _z(from_utc), _z(to_utc)),
    ).fetchall()
    if not rows:
        return {"value_kwh": None, "source": "unavailable", "provenance": None,
                "coverage_state": "unavailable", "reason": "no_archive_data_for_period",
                "n_points": 0, "first": None, "last": None}
    total_wh = sum(Decimal(str(r[1])) for r in rows)
    return {
        "value_kwh": float(total_wh / Decimal(1000)),
        "source": "fronius_local_archive_interval_energy",
        "provenance": "fronius_local_archive",
        "coverage_state": "partial",  # archive covers its captured intervals only
        "reason": None,
        "n_points": len(rows),
        "first": rows[0][0],
        "last": rows[-1][0],
    }


def _local_curve(con: sqlite3.Connection, from_text: str, to_text: str) -> list[dict[str, Any]]:
    rows = con.execute(
        """SELECT measured_at, pv_power_w, grid_power_w FROM energy_samples_v1
           WHERE measured_at >= ? AND measured_at <= ? ORDER BY measured_at""",
        (from_text, to_text),
    ).fetchall()
    points = []
    for measured_at, pv_w, grid_w in rows:
        dt = datetime.strptime(measured_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        points.append({"t": _z(dt), "ts": dt.timestamp(), "solar_w": pv_w, "grid_w": grid_w, "source": "local"})
    return points


def _archive_power_curve(con: sqlite3.Connection, from_utc: datetime, to_utc: datetime) -> list[dict[str, Any]]:
    if not _archive_available(con):
        return []
    rows = con.execute(
        """SELECT observed_at_utc, value_decimal FROM provider_archive_points
           WHERE channel = ? AND observed_at_utc >= ? AND observed_at_utc <= ?
           ORDER BY observed_at_utc""",
        (_ARCHIVE_POWER_CHANNEL, _z(from_utc), _z(to_utc)),
    ).fetchall()
    points = []
    for observed_at, value in rows:
        dt = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        points.append({"t": observed_at, "ts": dt.timestamp(), "solar_w": float(value), "grid_w": None,
                       "source": "fronius_archive"})
    return points


def build_period_curve(con: sqlite3.Connection, from_utc: datetime, to_utc: datetime) -> dict[str, Any]:
    """Merge local + archive into one source-tagged curve. Local wins on overlap."""
    from_text = from_utc.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    to_text = to_utc.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    local = _local_curve(con, from_text, to_text)
    archive = _archive_power_curve(con, from_utc, to_utc)

    local_ts = sorted(p["ts"] for p in local)
    merged = list(local)
    for ap in archive:
        # Skip an archive point that coincides with a local sample (no double-plot).
        if any(abs(ap["ts"] - lt) <= _MERGE_WINDOW_SECONDS for lt in local_ts):
            continue
        merged.append(ap)
    merged.sort(key=lambda p: p["ts"])

    sources = {p["source"] for p in merged}
    # Source segments: contiguous runs of one source.
    segments: list[dict[str, Any]] = []
    for p in merged:
        if segments and segments[-1]["source"] == p["source"]:
            segments[-1]["to"] = p["t"]
        else:
            segments.append({"source": p["source"], "from": p["t"], "to": p["t"]})

    if not merged:
        curve_source = "unavailable"
    elif sources == {"local"}:
        curve_source = "local"
    elif sources == {"fronius_archive"}:
        curve_source = "fronius_archive"
    else:
        curve_source = "mixed"

    return {
        "points": [{"t": p["t"], "solar_w": p["solar_w"], "grid_w": p["grid_w"], "source": p["source"]} for p in merged],
        "source": curve_source,
        "mixed_source": curve_source == "mixed",
        "segments": segments,
        "n_points": len(merged),
        "n_local": len(local),
        "n_archive": len(merged) - len(local),
        "first": merged[0]["t"] if merged else None,
        "last": merged[-1]["t"] if merged else None,
        "unavailable_reason": None if merged else "no_curve_local_or_archive",
    }
