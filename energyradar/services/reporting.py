"""Reporting Facade.

Bietet die Haupt-API für den Report-Export.
Delegiert an ReportDataService und die spezifischen Exporter.
"""
from datetime import datetime
import logging

from energyradar.services import reporting_data
from energyradar.services.exporters import csv_exporter, json_exporter, pdf_exporter, backup_service

log = logging.getLogger(__name__)

def export_csv(start_date: datetime, end_date: datetime, label: str, path: str):
    """Erzeugt einen CSV Export."""
    report = reporting_data.get_report_data(start_date, end_date, label)
    csv_exporter.export_csv(report, path)
    return report

def export_json(start_date: datetime, end_date: datetime, label: str, path: str):
    """Erzeugt einen JSON Export."""
    report = reporting_data.get_report_data(start_date, end_date, label)
    json_exporter.export_json(report, path)
    return report

def export_pdf(start_date: datetime, end_date: datetime, label: str, path: str):
    """Erzeugt einen PDF Export via Qt."""
    report = reporting_data.get_report_data(start_date, end_date, label)
    pdf_exporter.export_pdf(report, path)
    return report

def create_backup_zip(path: str):
    """Sichert die Datenbank und Einstellungen in ein ZIP."""
    backup_service.create_backup_zip(path)
    return None
