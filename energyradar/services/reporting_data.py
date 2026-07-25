"""Reporting Data Service.

Verantwortlich für die Beschaffung und Validierung der fachlichen Daten
für Berichte. Erzeugt ein neutrales ReportModel, das von den Exportern
verwendet wird.
"""
import zoneinfo
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from energyradar.models.report import (
    ReportModel, ReportDataPoint, ReportSummary, ReportCoverage, ReportEvent
)
from energyradar.services import storage, history
from energyradar import config

def get_report_data(start_date: datetime, end_date: datetime, label: str) -> ReportModel:
    """Liest die Historie ein und aggregiert ein konsistentes ReportModel."""
    tz = zoneinfo.ZoneInfo(config.MT175_TIMEZONE)

    # Sicherstellen, dass Start/End tz-aware sind
    if start_date.tzinfo is None:
        start_date = start_date.replace(tzinfo=tz)
    if end_date.tzinfo is None:
        end_date = end_date.replace(tzinfo=tz)

    # 1. Messwerte abrufen
    # TODO: storage Methode anpassen/hinzufügen um einen Bereich abzufragen
    raw_samples = storage.get_samples_in_range(start_date, end_date)

    measurements = []

    # Coverage Tracking und Trapez-Integration (vereinfachte Logik ähnlich history.py)
    pv_covered_s = 0.0
    grid_covered_s = 0.0
    home_covered_s = 0.0
    total_seconds = max((end_date - start_date).total_seconds(), 1.0)

    last_pv = None
    last_grid_import = None
    last_grid_export = None
    last_home = None

    pv_wh_int = 0.0
    grid_import_wh_int = 0.0
    grid_export_wh_int = 0.0
    home_wh_int = 0.0

    first_pv_c = None
    last_pv_c = None
    first_imp_c = None
    last_imp_c = None
    first_exp_c = None
    last_exp_c = None

    warnings = []

    for row in raw_samples:
        dt = datetime.strptime(row["measured_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(tz)
        rx = datetime.strptime(row["received_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(tz)

        pv_w = row["pv_power_w"]
        grid_w = row["grid_power_w"]
        home_w = history.derive_home_power(pv_w, grid_w)

        grid_imp_w = max(grid_w, 0) if grid_w is not None else None
        grid_exp_w = max(-grid_w, 0) if grid_w is not None else None

        pv_c = row["pv_energy_today_wh"]
        imp_c = row["grid_import_total_wh"]
        exp_c = row["grid_export_total_wh"]

        # Counter Delta Tracking
        if pv_c is not None:
            if first_pv_c is None: first_pv_c = pv_c
            last_pv_c = pv_c
        if imp_c is not None:
            if first_imp_c is None: first_imp_c = imp_c
            last_imp_c = imp_c
        if exp_c is not None:
            if first_exp_c is None: first_exp_c = exp_c
            last_exp_c = exp_c

        # Coverage (Trapezregel)
        if last_pv is not None and pv_w is not None:
            diff = (dt - last_pv["time"]).total_seconds()
            if 0 < diff <= history.MAX_GAP_SECONDS:
                pv_covered_s += diff
                pv_wh_int += ((pv_w + last_pv["val"]) / 2) * (diff / 3600.0)
        last_pv = {"time": dt, "val": pv_w} if pv_w is not None else None

        if last_grid_import is not None and grid_imp_w is not None:
            diff = (dt - last_grid_import["time"]).total_seconds()
            if 0 < diff <= history.MAX_GAP_SECONDS:
                grid_covered_s += diff
                grid_import_wh_int += ((grid_imp_w + last_grid_import["val"]) / 2) * (diff / 3600.0)
                grid_export_wh_int += ((grid_exp_w + last_grid_export["val"]) / 2) * (diff / 3600.0)

        if grid_imp_w is not None:
            last_grid_import = {"time": dt, "val": grid_imp_w}
            last_grid_export = {"time": dt, "val": grid_exp_w}
        else:
            last_grid_import = None
            last_grid_export = None

        if last_home is not None and home_w is not None:
            diff = (dt - last_home["time"]).total_seconds()
            if 0 < diff <= history.MAX_GAP_SECONDS:
                home_covered_s += diff
                home_wh_int += ((home_w + last_home["val"]) / 2) * (diff / 3600.0)
        last_home = {"time": dt, "val": home_w} if home_w is not None else None

        measurements.append(ReportDataPoint(
            measured_at=dt,
            received_at=rx,
            pv_power_w=pv_w,
            grid_power_w=grid_w,
            home_power_w=home_w,
            pv_energy_today_wh=pv_c,
            grid_import_total_wh=imp_c,
            grid_export_total_wh=exp_c,
            sample_quality_status=row["sample_quality_status"],
            source="EnergyRadar"
        ))

    cov_pv = min(1.0, pv_covered_s / total_seconds)
    cov_grid = min(1.0, grid_covered_s / total_seconds)
    cov_home = min(1.0, home_covered_s / total_seconds)

    if cov_pv < 0.9: warnings.append(f"Solar-Abdeckung gering ({cov_pv*100:.1f}%)")
    if cov_grid < 0.9: warnings.append(f"Netz-Abdeckung gering ({cov_grid*100:.1f}%)")

    # Resolve summaries (Counter > Integral)
    solar_kwh = None
    if last_pv_c is not None and first_pv_c is not None:
        solar_kwh = (last_pv_c - first_pv_c) / 1000.0
        if solar_kwh < 0: solar_kwh = last_pv_c / 1000.0
    if solar_kwh is None and cov_pv > 0.5:
        solar_kwh = pv_wh_int / 1000.0

    import_kwh = None
    if last_imp_c is not None and first_imp_c is not None:
        import_kwh = (last_imp_c - first_imp_c) / 1000.0
    if import_kwh is None and cov_grid > 0.5:
        import_kwh = grid_import_wh_int / 1000.0

    export_kwh = None
    if last_exp_c is not None and first_exp_c is not None:
        export_kwh = (last_exp_c - first_exp_c) / 1000.0
    if export_kwh is None and cov_grid > 0.5:
        export_kwh = grid_export_wh_int / 1000.0

    consumption_kwh = None
    if solar_kwh is not None and import_kwh is not None and export_kwh is not None:
        if cov_home >= 0.9:
            consumption_kwh = max(0, solar_kwh + import_kwh - export_kwh)

    autarky_pct = None
    if consumption_kwh and consumption_kwh > 0 and cov_home >= 0.9 and cov_grid >= 0.9:
        autarky_pct = max(0, min(100, round((1.0 - (import_kwh / consumption_kwh)) * 100)))

    self_consumption_pct = None
    if solar_kwh and solar_kwh > 0 and cov_pv >= 0.9 and cov_grid >= 0.9:
        self_consumption_pct = max(0, min(100, round((1.0 - (export_kwh / solar_kwh)) * 100)))

    overall_quality = "good"
    if cov_pv < 0.9 or cov_grid < 0.9:
        overall_quality = "partial"
    if len(measurements) == 0:
        overall_quality = "no_data"

    summary = ReportSummary(
        solar_kwh=round(solar_kwh, 2) if solar_kwh is not None else None,
        consumption_kwh=round(consumption_kwh, 2) if consumption_kwh is not None else None,
        grid_import_kwh=round(import_kwh, 2) if import_kwh is not None else None,
        grid_export_kwh=round(export_kwh, 2) if export_kwh is not None else None,
        self_consumption_pct=self_consumption_pct,
        autarky_pct=autarky_pct
    )

    coverage = ReportCoverage(pv=round(cov_pv, 3), grid=round(cov_grid, 3), home=round(cov_home, 3))

    return ReportModel(
        app_version=config.APP_VERSION,
        timezone=str(tz),
        period_start=start_date,
        period_end=end_date,
        period_label=label,
        data_coverage=coverage,
        data_quality=overall_quality,
        summary=summary,
        measurements=measurements,
        warnings=warnings
    )
