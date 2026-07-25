"""Report Models.

Neutrales, exportierbares Datenmodell für alle Exportformate (PDF, CSV, JSON).
Garantien: Unknown ≠ Zero. Keine Exportklasse darf None in 0 umwandeln.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Any
import json

@dataclass
class ReportSummary:
    solar_kwh: Optional[float]
    consumption_kwh: Optional[float]
    grid_import_kwh: Optional[float]
    grid_export_kwh: Optional[float]
    self_consumption_pct: Optional[int]
    autarky_pct: Optional[int]

@dataclass
class ReportCoverage:
    pv: float
    grid: float
    home: float

@dataclass
class ReportEvent:
    timestamp: datetime
    level: str
    message: str

@dataclass
class ReportDataPoint:
    measured_at: datetime
    received_at: datetime
    pv_power_w: Optional[float]
    grid_power_w: Optional[float]
    home_power_w: Optional[float]
    pv_energy_today_wh: Optional[float]
    grid_import_total_wh: Optional[float]
    grid_export_total_wh: Optional[float]
    sample_quality_status: str
    source: str

@dataclass
class ReportModel:
    report_version: str = "1.0"
    app_version: str = "unknown"
    generated_at: datetime = field(default_factory=datetime.now)
    timezone: str = "UTC"
    period_start: datetime = None
    period_end: datetime = None
    period_label: str = ""
    data_coverage: ReportCoverage = None
    data_quality: str = "unknown"
    summary: ReportSummary = None
    measurements: List[ReportDataPoint] = field(default_factory=list)
    events: List[ReportEvent] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Sicheres Serialisieren nach JSON/Dict ohne None-Verlust."""
        def serialize_dt(dt: Optional[datetime]) -> Optional[str]:
            return dt.isoformat() if dt else None

        return {
            "metadata": {
                "report_version": self.report_version,
                "app_version": self.app_version,
                "generated_at": serialize_dt(self.generated_at),
                "timezone": self.timezone,
                "period_start": serialize_dt(self.period_start),
                "period_end": serialize_dt(self.period_end),
                "period_label": self.period_label,
            },
            "quality": {
                "data_quality": self.data_quality,
                "coverage": {
                    "pv": self.data_coverage.pv,
                    "grid": self.data_coverage.grid,
                    "home": self.data_coverage.home
                } if self.data_coverage else None,
                "warnings": self.warnings
            },
            "summary": {
                "solar_kwh": self.summary.solar_kwh,
                "consumption_kwh": self.summary.consumption_kwh,
                "grid_import_kwh": self.summary.grid_import_kwh,
                "grid_export_kwh": self.summary.grid_export_kwh,
                "self_consumption_pct": self.summary.self_consumption_pct,
                "autarky_pct": self.summary.autarky_pct,
            } if self.summary else None,
            "measurements": [
                {
                    "measured_at": serialize_dt(m.measured_at),
                    "received_at": serialize_dt(m.received_at),
                    "pv_power_w": m.pv_power_w,
                    "grid_power_w": m.grid_power_w,
                    "home_power_w": m.home_power_w,
                    "pv_energy_today_wh": m.pv_energy_today_wh,
                    "grid_import_total_wh": m.grid_import_total_wh,
                    "grid_export_total_wh": m.grid_export_total_wh,
                    "sample_quality_status": m.sample_quality_status,
                    "source": m.source
                }
                for m in self.measurements
            ],
            "events": [
                {
                    "timestamp": serialize_dt(e.timestamp),
                    "level": e.level,
                    "message": e.message
                }
                for e in self.events
            ]
        }
