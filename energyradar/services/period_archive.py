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

import bisect
import sqlite3
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

# Local sample and archive power points closer than this are treated as the same
# instant on the merged curve (local wins) so a mixed curve never double-plots.
_MERGE_WINDOW_SECONDS = 150

# A time delta larger than this between adjacent curve points is a real gap and
# its boundary points are always kept through downsampling.
_GAP_SECONDS = 15 * 60


def _display_budget(from_utc: datetime, to_utc: datetime) -> int:
    """Maximum rendered curve points for a period span (display only)."""
    span_days = max(0.0, (to_utc - from_utc).total_seconds() / 86400.0)
    if span_days <= 2:
        return 600
    if span_days <= 7:
        return 1000
    if span_days <= 31:
        return 1200
    return 730  # year and beyond: daily-scale bound


def downsample_curve(points: list[dict[str, Any]], max_points: int | None) -> list[dict[str, Any]]:
    """Bound rendered points without inventing or interpolating any.

    Deterministic and gap/extrema/source-boundary preserving:
    - the first and last point are always kept;
    - both sides of every source change and every gap are always kept;
    - within each remaining bucket the min- and max-``solar_w`` real points are
      kept, so peaks and troughs survive.
    Every returned point is a real, unmodified input point. Totals are unaffected
    (they are computed from raw counters/energy, never from this curve).
    """
    n = len(points)
    if max_points is None or n <= max_points:
        return points
    keep: set[int] = {0, n - 1}
    for i in range(1, n):
        prev, cur = points[i - 1], points[i]
        if cur["source"] != prev["source"] or (cur["ts"] - prev["ts"]) > _GAP_SECONDS:
            keep.add(i - 1)
            keep.add(i)
    remaining = max_points - len(keep)
    if remaining > 0:
        buckets = max(1, remaining // 2)
        step = n / buckets
        for b in range(buckets):
            lo, hi = int(b * step), int((b + 1) * step)
            seg = [(j, points[j]["solar_w"]) for j in range(lo, hi)
                   if j not in keep and points[j]["solar_w"] is not None]
            if not seg:
                continue
            keep.add(min(seg, key=lambda x: x[1])[0])
            keep.add(max(seg, key=lambda x: x[1])[0])
    return [points[i] for i in sorted(keep)]

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


def _parse_z(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def derive_house_consumption(
    pv_kwh: float | None,
    import_kwh: float | None,
    export_kwh: float | None,
    *,
    archive_pv: dict[str, Any] | None,
    resolved_period: dict[str, Any] | None,
    tolerance_seconds: int = 1800,
) -> dict[str, Any]:
    """House = PV + grid_import − grid_export, only over a *compatible* period.

    Sources need not share a producer (archive PV + anchor grid is fine), but they
    must cover a compatible period: the PV coverage window must sit within the
    resolved grid period (± tolerance) so the PV total is not counting production
    outside the grid-measured window. Returns a metric-shaped dict; on failure the
    machine ``reason`` and a precise human ``detail`` explain exactly why.
    """
    def _out(value, reason, detail):
        return {
            "value_kwh": value,
            "source": "derived_compatible_energy" if value is not None else "unavailable",
            "provenance": "derived" if value is not None else None,
            "confidence": "calculated" if value is not None else None,
            "coverage_state": "partial" if value is not None else "unavailable",
            "reason": reason,
            "detail": detail,
        }

    if pv_kwh is None or import_kwh is None or export_kwh is None:
        missing = [n for n, v in (("Solar", pv_kwh), ("Netzbezug", import_kwh), ("Einspeisung", export_kwh)) if v is None]
        return _out(None, "house_missing_dependency",
                    f"Für die Berechnung fehlt: {', '.join(missing)}.")

    gf = _parse_z((resolved_period or {}).get("from"))
    gt = _parse_z((resolved_period or {}).get("to"))
    pf = _parse_z((archive_pv or {}).get("first"))
    pl = _parse_z((archive_pv or {}).get("last"))
    tol = timedelta(seconds=tolerance_seconds)
    if gf and gt and pf and pl:
        if pf < gf - tol:
            minutes = int((gf - pf).total_seconds() // 60)
            return _out(None, "pv_window_starts_before_grid_period",
                        f"Der Fronius-Verlauf beginnt {minutes} Minuten vor dem ausgewerteten Netzzeitraum.")
        if pl > gt + tol:
            minutes = int((pl - gt).total_seconds() // 60)
            return _out(None, "pv_window_ends_after_grid_period",
                        f"Der Fronius-Verlauf endet {minutes} Minuten nach dem ausgewerteten Netzzeitraum.")

    balance = pv_kwh + import_kwh - export_kwh
    if balance < -0.05:
        return _out(None, "house_balance_negative",
                    "Der rechnerische Hausverbrauch wäre negativ; die Quellen sind für diesen Zeitraum nicht vergleichbar.")
    return _out(max(0.0, balance), None, None)


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


def build_period_curve(
    con: sqlite3.Connection, from_utc: datetime, to_utc: datetime, *, max_points: int | None = None
) -> dict[str, Any]:
    """Merge local + archive into one source-tagged curve. Local wins on overlap.

    ``max_points`` bounds the *rendered* points via :func:`downsample_curve`; the
    raw counts (``n_points``/``n_local``/``n_archive``) stay the true totals.
    """
    from_text = from_utc.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    to_text = to_utc.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    local = _local_curve(con, from_text, to_text)
    archive = _archive_power_curve(con, from_utc, to_utc)

    # O(n log n) overlap check: binary-search the sorted local timestamps rather
    # than scanning them for every archive point (the old O(n·m) freeze path).
    local_ts = sorted(p["ts"] for p in local)

    def _coincides(ts: float) -> bool:
        i = bisect.bisect_left(local_ts, ts)
        for j in (i - 1, i):
            if 0 <= j < len(local_ts) and abs(local_ts[j] - ts) <= _MERGE_WINDOW_SECONDS:
                return True
        return False

    merged = list(local)
    for ap in archive:
        if not _coincides(ap["ts"]):
            merged.append(ap)
    merged.sort(key=lambda p: p["ts"])

    n_points = len(merged)
    n_local = len(local)
    n_archive = n_points - n_local
    rendered = downsample_curve(merged, max_points)

    sources = {p["source"] for p in merged}
    # Source segments from raw merged points: contiguous runs of one source.
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
        "points": [{"t": p["t"], "solar_w": p["solar_w"], "grid_w": p["grid_w"], "source": p["source"]} for p in rendered],
        "source": curve_source,
        "mixed_source": curve_source == "mixed",
        "segments": segments,
        "n_points": n_points,
        "n_local": n_local,
        "n_archive": n_archive,
        "n_rendered": len(rendered),
        "downsampled": len(rendered) < n_points,
        "first": merged[0]["t"] if merged else None,
        "last": merged[-1]["t"] if merged else None,
        "unavailable_reason": None if merged else "no_curve_local_or_archive",
    }
