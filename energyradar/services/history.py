"""History and Analytics Service.

Einzige Verantwortung: Historische Rohdaten (energy_samples_v1) einlesen,
ableiten (z. B. home_power), integrieren (Energie aus Leistung berechnen)
und auf Coverage prüfen. Liefert das fachliche History-Objekt für Viewmodels.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional, Any
from energyradar.services import storage
from energyradar.services.economy import coverage_state

# Wenn der Abstand zwischen zwei Punkten größer ist, wird die Lücke nicht interpoliert.
MAX_GAP_SECONDS = 300  # 5 Minuten


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

    samples = storage.get_samples_since(start_of_day)

    points = []

    pv_covered_s = 0.0
    grid_covered_s = 0.0
    home_covered_s = 0.0

    # Für Integration (Trapezregel)
    last_pv = None
    last_grid_import = None
    last_grid_export = None
    last_home = None

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

    # Economy uses a stricter evidence path: stale/partial/unknown source rows
    # remain visible in history but cannot support a current financial claim.
    econ_first_pv_counter = econ_last_pv_counter = None
    econ_first_import_counter = econ_last_import_counter = None
    econ_first_export_counter = econ_last_export_counter = None
    econ_last_pv = econ_last_import = econ_last_export = None
    econ_pv_wh = econ_import_wh = econ_export_wh = 0.0
    econ_pv_covered_s = econ_grid_covered_s = 0.0

    for row in samples:
        dt = datetime.strptime(row["measured_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(tz)

        pv_w = row["pv_power_w"]
        grid_w = row["grid_power_w"]

        pv_counter = row["pv_energy_today_wh"]
        import_counter = row["grid_import_total_wh"]
        export_counter = row["grid_export_total_wh"]
        pv_trusted = row.get("pv_quality_status", row.get("sample_quality_status")) == "valid"
        grid_trusted = row.get("grid_quality_status", row.get("sample_quality_status")) == "valid"

        if pv_trusted:
            if pv_counter is not None:
                if econ_first_pv_counter is None:
                    econ_first_pv_counter = pv_counter
                econ_last_pv_counter = pv_counter
            if econ_last_pv is not None and pv_w is not None:
                diff = (dt - econ_last_pv["time"]).total_seconds()
                if 0 < diff <= MAX_GAP_SECONDS:
                    econ_pv_covered_s += diff
                    econ_pv_wh += ((pv_w + econ_last_pv["val"]) / 2) * (diff / 3600.0)
            econ_last_pv = {"time": dt, "val": pv_w} if pv_w is not None else None
        else:
            econ_last_pv = None

        if grid_trusted:
            if import_counter is not None:
                if econ_first_import_counter is None:
                    econ_first_import_counter = import_counter
                econ_last_import_counter = import_counter
            if export_counter is not None:
                if econ_first_export_counter is None:
                    econ_first_export_counter = export_counter
                econ_last_export_counter = export_counter
            import_w = max(grid_w, 0) if grid_w is not None else None
            export_w = max(-grid_w, 0) if grid_w is not None else None
            if econ_last_import is not None and import_w is not None:
                diff = (dt - econ_last_import["time"]).total_seconds()
                if 0 < diff <= MAX_GAP_SECONDS:
                    econ_grid_covered_s += diff
                    econ_import_wh += ((import_w + econ_last_import["val"]) / 2) * (diff / 3600.0)
                    econ_export_wh += ((export_w + econ_last_export["val"]) / 2) * (diff / 3600.0)
            econ_last_import = {"time": dt, "val": import_w} if import_w is not None else None
            econ_last_export = {"time": dt, "val": export_w} if export_w is not None else None
        else:
            econ_last_import = econ_last_export = None

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
        home_w = derive_home_power(pv_w, grid_w)
        grid_import_w = max(grid_w, 0) if grid_w is not None else None
        grid_export_w = max(-grid_w, 0) if grid_w is not None else None

        points.append({
            "measured_at": dt.isoformat(),
            "pv_power_w": pv_w,
            "home_power_w": home_w,
            "grid_power_w": grid_w,
            "grid_import_w": grid_import_w,
            "grid_export_w": grid_export_w,
            "quality_status": row["sample_quality_status"]
        })

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

    period_key = f"{start_of_day.isoformat()}|{now.isoformat()}"

    def economy_energy(
        first_counter: Optional[float],
        last_counter: Optional[float],
        integrated_wh: float,
        coverage: float,
    ) -> dict[str, Any]:
        value_kwh: Optional[float] = None
        source = "unavailable"
        reason: Optional[str] = None
        if first_counter is not None and last_counter is not None:
            delta = last_counter - first_counter
            if delta >= 0:
                value_kwh = delta / 1000.0
                source = "counter_delta"
            else:
                reason = "counter_reset_or_negative_delta"
        if value_kwh is None and coverage >= 0.5:
            value_kwh = integrated_wh / 1000.0
            source = "integrated_power_history"
            reason = "counter_unusable_fallback_to_covered_power_history" if reason else None
        state = coverage_state(coverage)
        if value_kwh is None:
            state = "unavailable"
        return {
            "value_kwh": format(value_kwh, ".12g") if value_kwh is not None else None,
            "source": source,
            "coverage_ratio": round(coverage, 6),
            "coverage_state": state,
            "period_key": period_key,
            "reason": reason,
        }

    economy_basis = {
        "period": {
            "from": start_of_day.isoformat(),
            "to": now.isoformat(),
            "timezone": str(tz),
            "local_date_from": start_of_day.date().isoformat(),
            "local_date_to": now.date().isoformat(),
        },
        "source_hierarchy": [
            "counter_delta",
            "provider_energy_total",
            "integrated_power_history",
            "unavailable",
        ],
        "solar_generation": economy_energy(
            econ_first_pv_counter, econ_last_pv_counter, econ_pv_wh,
            min(1.0, econ_pv_covered_s / total_seconds_today),
        ),
        "grid_import": economy_energy(
            econ_first_import_counter,
            econ_last_import_counter,
            econ_import_wh,
            min(1.0, econ_grid_covered_s / total_seconds_today),
        ),
        "grid_export": economy_energy(
            econ_first_export_counter,
            econ_last_export_counter,
            econ_export_wh,
            min(1.0, econ_grid_covered_s / total_seconds_today),
        ),
    }

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
        "economy_basis": economy_basis,
        "points": points
    }
