"""History and Analytics Service.

Einzige Verantwortung: Historische Rohdaten (energy_samples_v1) einlesen,
ableiten (z. B. home_power), integrieren (Energie aus Leistung berechnen)
und auf Coverage prüfen. Liefert das fachliche History-Objekt für Viewmodels.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from energyradar.services import storage

# Wenn der Abstand zwischen zwei Punkten größer ist, wird die Lücke nicht interpoliert.
MAX_GAP_SECONDS = 300  # 5 Minuten
CURVE_GAP_SECONDS = 30


def derive_home_power(
    pv_power_w: Optional[float],
    grid_power_w: Optional[float],
    *,
    has_battery: bool = False,
) -> Optional[float]:
    """Berechnet Hausleistung aus PV und Netz (falls valide und ohne Batterie)."""
    if pv_power_w is None or grid_power_w is None or has_battery:
        return None

    home_power = pv_power_w + grid_power_w
    return home_power if home_power >= 0 else None


def get_today_history(tz: timezone) -> dict[str, Any]:
    """Liest den heutigen Tag aus und berechnet das Perioden-Modell."""
    now = datetime.now(tz)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    total_seconds_today = (now - start_of_day).total_seconds()

    # Vermeide Division by Zero direkt nach Mitternacht
    if total_seconds_today < 1:
        total_seconds_today = 1

    samples, _ = storage.get_persisted_history_rows(start_of_day, now)

    points = []

    pv_covered_s = 0.0
    grid_covered_s = 0.0
    home_covered_s = 0.0

    # Für Integration (Trapezregel)
    last_pv = None
    last_grid_import = None
    last_grid_export = None
    last_home = None
    last_point_time = None

    pv_wh_integrated = 0.0
    grid_import_wh_integrated = 0.0
    grid_export_wh_integrated = 0.0
    home_wh_integrated = 0.0

    # Zähler-Logik
    first_pv_counter: Optional[float] = None
    last_pv_counter: Optional[float] = None

    first_grid_import_counter: Optional[float] = None
    last_grid_import_counter: Optional[float] = None

    first_grid_export_counter: Optional[float] = None
    last_grid_export_counter: Optional[float] = None

    for row in samples:
        dt = datetime.fromisoformat(
            row["received_at_utc"].replace("Z", "+00:00")
        ).astimezone(tz)

        pv_w = row["pv_power_w"]
        grid_w = row["grid_power_w"]

        pv_counter = (
            row["pv_energy_today_kwh"] * 1000.0
            if row["pv_energy_today_kwh"] is not None else None
        )
        import_counter = (
            row["grid_import_total_kwh"] * 1000.0
            if row["grid_import_total_kwh"] is not None else None
        )
        export_counter = (
            row["grid_export_total_kwh"] * 1000.0
            if row["grid_export_total_kwh"] is not None else None
        )

        # Counter Delta Tracking
        if pv_counter is not None:
            if first_pv_counter is None:
                first_pv_counter = pv_counter
            last_pv_counter = pv_counter

        if import_counter is not None:
            if first_grid_import_counter is None:
                first_grid_import_counter = import_counter
            last_grid_import_counter = import_counter

        if export_counter is not None:
            if first_grid_export_counter is None:
                first_grid_export_counter = export_counter
            last_grid_export_counter = export_counter

        # Derive Base Metrics
        home_w = row["house_power_w"]
        grid_import_w = max(grid_w, 0) if grid_w is not None else None
        grid_export_w = max(-grid_w, 0) if grid_w is not None else None

        if (
            last_point_time is not None
            and (dt - last_point_time).total_seconds() > CURVE_GAP_SECONDS
        ):
            gap_time = last_point_time + (dt - last_point_time) / 2
            points.append({
                "measured_at": gap_time.isoformat(),
                "pv_power_w": None,
                "home_power_w": None,
                "grid_power_w": None,
                "grid_import_w": None,
                "grid_export_w": None,
                "quality_status": "missing",
            })

        points.append({
            "measured_at": dt.isoformat(),
            "pv_power_w": pv_w,
            "home_power_w": home_w,
            "grid_power_w": grid_w,
            "grid_import_w": grid_import_w,
            "grid_export_w": grid_export_w,
            "quality_status": row["quality_state"]
        })
        last_point_time = dt

        # Integration & Coverage (Trapezregel)
        if last_pv is not None and pv_w is not None:
            dt_diff = (dt - last_pv["time"]).total_seconds()
            if 0 < dt_diff <= MAX_GAP_SECONDS:
                pv_covered_s += dt_diff
                pv_wh_integrated += ((pv_w + last_pv["val"]) / 2) * (dt_diff / 3600.0)

        if pv_w is not None:
            last_pv = {"time": dt, "val": pv_w}
        else:
            last_pv = None

        if last_grid_import is not None and grid_import_w is not None:
            dt_diff = (dt - last_grid_import["time"]).total_seconds()
            if 0 < dt_diff <= MAX_GAP_SECONDS:
                grid_covered_s += dt_diff
                grid_import_wh_integrated += ((grid_import_w + last_grid_import["val"]) / 2) * (dt_diff / 3600.0)
                grid_export_wh_integrated += ((grid_export_w + last_grid_export["val"]) / 2) * (dt_diff / 3600.0)

        if grid_import_w is not None:
            last_grid_import = {"time": dt, "val": grid_import_w}
            last_grid_export = {"time": dt, "val": grid_export_w}
        else:
            last_grid_import = None
            last_grid_export = None

        if last_home is not None and home_w is not None:
            dt_diff = (dt - last_home["time"]).total_seconds()
            if 0 < dt_diff <= MAX_GAP_SECONDS:
                home_covered_s += dt_diff
                home_wh_integrated += ((home_w + last_home["val"]) / 2) * (dt_diff / 3600.0)

        if home_w is not None:
            last_home = {"time": dt, "val": home_w}
        else:
            last_home = None

    # Coverage calc
    cov_pv = min(1.0, pv_covered_s / total_seconds_today)
    cov_grid = min(1.0, grid_covered_s / total_seconds_today)
    cov_home = min(1.0, home_covered_s / total_seconds_today)

    # Resolution of summaries (Counter Delta prefers over integration)
    solar_kwh = None
    if last_pv_counter is not None and first_pv_counter is not None:
        solar_kwh = (last_pv_counter - first_pv_counter) / 1000.0
        # Fronius energy_today might reset, so if it's smaller, it means a reset happened. Just use the last value as fallback if it's just today.
        if solar_kwh < 0:
            solar_kwh = last_pv_counter / 1000.0

    if solar_kwh is None and cov_pv > 0.5:
        solar_kwh = pv_wh_integrated / 1000.0

    import_kwh = None
    if last_grid_import_counter is not None and first_grid_import_counter is not None:
        import_kwh = (last_grid_import_counter - first_grid_import_counter) / 1000.0
    if import_kwh is None and cov_grid > 0.5:
        import_kwh = grid_import_wh_integrated / 1000.0

    export_kwh = None
    if last_grid_export_counter is not None and first_grid_export_counter is not None:
        export_kwh = (last_grid_export_counter - first_grid_export_counter) / 1000.0
    if export_kwh is None and cov_grid > 0.5:
        export_kwh = grid_export_wh_integrated / 1000.0

    # Home consumption is solar + import - export
    consumption_kwh = None
    if solar_kwh is not None and import_kwh is not None and export_kwh is not None:
        if cov_home >= 0.90:
            consumption_kwh = solar_kwh + import_kwh - export_kwh
            if consumption_kwh < 0:
                consumption_kwh = 0.0

    # Autarky and Self-Consumption
    autarky_pct = None
    if consumption_kwh and consumption_kwh > 0 and cov_home >= 0.90 and cov_grid >= 0.90:
        autarky_pct = max(0, min(100, round((1.0 - (import_kwh / consumption_kwh)) * 100)))

    self_consumption_pct = None
    if solar_kwh and solar_kwh > 0 and cov_pv >= 0.90 and cov_grid >= 0.90: # Needs grid export reliable
        self_consumption_pct = max(0, min(100, round((1.0 - (export_kwh / solar_kwh)) * 100)))

    return {
        "period": {
            "from": start_of_day.isoformat(),
            "to": now.isoformat(),
            "timezone": str(tz)
        },
        "coverage": {
            "pv": round(cov_pv, 3),
            "grid": round(cov_grid, 3),
            "home": round(cov_home, 3)
        },
        "summary": {
            "solar_kwh": round(solar_kwh, 2) if solar_kwh is not None else None,
            "consumption_kwh": round(consumption_kwh, 2) if consumption_kwh is not None else None,
            "grid_import_kwh": round(import_kwh, 2) if import_kwh is not None else None,
            "grid_export_kwh": round(export_kwh, 2) if export_kwh is not None else None,
            "self_consumption_pct": self_consumption_pct,
            "autarky_pct": autarky_pct
        },
        "points": points
    }


def _range_bounds(
    range_key: str, tz: timezone, now: datetime
) -> tuple[datetime, datetime]:
    local_now = now.astimezone(tz)
    start_today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    days = {"today": 1, "7days": 7, "30days": 30}
    if range_key not in days:
        raise ValueError("Unsupported history range")
    start = start_today - timedelta(days=days[range_key] - 1)
    return start, local_now


def get_history(
    range_key: str,
    tz: timezone,
    *,
    now: datetime | None = None,
    max_points: int = 3_000,
) -> dict[str, Any]:
    """Return gap-aware persisted power history for Today, 7 or 30 days."""
    current = now or datetime.now(timezone.utc)
    start_local, end_local = _range_bounds(range_key, tz, current)
    rows, total = storage.get_persisted_history_rows(
        start_local, end_local, max_points=max_points
    )
    recording_start, recording_end = storage.get_history_recording_bounds()
    points: list[dict[str, Any]] = []
    has_gap = False
    has_partial = False

    for row in rows:
        previous = row.get("previous_received_at")
        if previous:
            previous_dt = datetime.fromisoformat(previous.replace("Z", "+00:00"))
            current_dt = datetime.fromisoformat(
                row["received_at_utc"].replace("Z", "+00:00")
            )
            if (current_dt - previous_dt).total_seconds() > 30.0:
                has_gap = True
                points.append({
                    "timestamp_utc": (
                        previous_dt + (current_dt - previous_dt) / 2
                    ).isoformat().replace("+00:00", "Z"),
                    "pv_power_w": None,
                    "house_power_w": None,
                    "grid_power_w": None,
                    "quality_state": "missing",
                    "source_available": False,
                    "source_uuid": row["source_uuid"],
                    "source_name": row["source_name"],
                    "provenance": "measured",
                    "gap": True,
                })
        quality = row["quality_state"]
        if quality != "derived":
            has_partial = True
        points.append({
            "timestamp_utc": row["received_at_utc"],
            "pv_power_w": row["pv_power_w"],
            "house_power_w": row["house_power_w"],
            "grid_power_w": row["grid_power_w"],
            "quality_state": quality,
            "quality_flags": row["quality_flags"],
            "source_available": bool(row["source_available"]),
            "source_uuid": row["source_uuid"],
            "source_name": row["source_name"],
            "provenance": row["provenance"],
            "gap": False,
        })

    status = "no_history"
    if rows:
        first = datetime.fromisoformat(rows[0]["received_at_utc"].replace("Z", "+00:00"))
        last = datetime.fromisoformat(rows[-1]["received_at_utc"].replace("Z", "+00:00"))
        start_utc = start_local.astimezone(timezone.utc)
        end_utc = end_local.astimezone(timezone.utc)
        edge_gap = (
            (first - start_utc).total_seconds() > 30.0
            or (end_utc - last).total_seconds() > 30.0
        )
        status = "partial" if has_gap or has_partial or edge_gap else "available"

    return {
        "range": range_key,
        "period": {
            "from": start_local.isoformat(),
            "to": end_local.isoformat(),
            "timezone": str(tz),
        },
        "status": status,
        "recording_since_utc": recording_start,
        "last_recorded_at_utc": recording_end,
        "total_samples": total,
        "returned_points": len(points),
        "points": points,
    }
