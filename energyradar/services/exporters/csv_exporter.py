import csv
from typing import Any
from energyradar.models.report import ReportModel
from energyradar.services.exporters.utils import write_atomic

def _protect_csv_injection(val: Any) -> Any:
    if isinstance(val, str) and val.startswith(('=', '+', '-', '@', '\t', '\r')):
        return f"'{val}"
    return val

def export_csv(report: ReportModel, path: str):
    """
    Exportiert das ReportModel im dokumentierten Long-Format als CSV.
    Regeln: UTF-8 mit BOM, ISO-8601, NULL als leer, keine lokal formatierten Zahlen, CSV-Injection-Schutz.
    """
    def write_func(f):
        # Schreibe UTF-8 BOM
        f.write('\ufeff')

        writer = csv.writer(f, dialect='excel')
        # Stabile Spaltenreihenfolge
        header = [
            "measured_at", "received_at", "metric_name", "value", "unit", "quality_status", "source"
        ]
        writer.writerow(header)

        def write_metric(measured_at, received_at, metric_name, value, unit, quality, source):
            # NULL als leeres Feld, Injection-Schutz
            if value is None:
                val_str = ""
            else:
                val_str = str(value)

            row = [
                _protect_csv_injection(measured_at.isoformat() if measured_at else ""),
                _protect_csv_injection(received_at.isoformat() if received_at else ""),
                _protect_csv_injection(metric_name),
                _protect_csv_injection(val_str),
                _protect_csv_injection(unit),
                _protect_csv_injection(quality),
                _protect_csv_injection(source)
            ]
            writer.writerow(row)

        for m in report.measurements:
            write_metric(m.measured_at, m.received_at, "pv_power", m.pv_power_w, "W", m.sample_quality_status, m.source)
            write_metric(m.measured_at, m.received_at, "grid_power", m.grid_power_w, "W", m.sample_quality_status, m.source)
            write_metric(m.measured_at, m.received_at, "home_power", m.home_power_w, "W", m.sample_quality_status, m.source)

            if m.pv_energy_today_wh is not None:
                write_metric(m.measured_at, m.received_at, "pv_energy_today", m.pv_energy_today_wh, "Wh", m.sample_quality_status, m.source)
            if m.grid_import_total_wh is not None:
                write_metric(m.measured_at, m.received_at, "grid_import_total", m.grid_import_total_wh, "Wh", m.sample_quality_status, m.source)
            if m.grid_export_total_wh is not None:
                write_metric(m.measured_at, m.received_at, "grid_export_total", m.grid_export_total_wh, "Wh", m.sample_quality_status, m.source)

    write_atomic(path, 'w', write_func, encoding='utf-8')
