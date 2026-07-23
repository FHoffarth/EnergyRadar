import os
import json
import sqlite3
import tempfile
import zipfile
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path

from energyradar.models.report import ReportModel, ReportSummary, ReportCoverage, ReportDataPoint
from energyradar.services.exporters import csv_exporter, json_exporter, pdf_exporter, backup_service
from energyradar import config

@pytest.fixture
def sample_report():
    return ReportModel(
        period_start=datetime(2026, 7, 1, tzinfo=timezone.utc),
        period_end=datetime(2026, 7, 2, tzinfo=timezone.utc),
        period_label="Test",
        data_coverage=ReportCoverage(pv=0.95, grid=0.95, home=0.95),
        data_quality="good",
        summary=ReportSummary(
            solar_kwh=10.5,
            consumption_kwh=15.0,
            grid_import_kwh=5.0,
            grid_export_kwh=0.5,
            self_consumption_pct=95,
            autarky_pct=66
        ),
        measurements=[
            ReportDataPoint(
                measured_at=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
                received_at=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
                pv_power_w=1000.0,
                grid_power_w=-500.0,
                home_power_w=500.0,
                pv_energy_today_wh=None,
                grid_import_total_wh=None,
                grid_export_total_wh=None,
                sample_quality_status="valid",
                source="EnergyRadar"
            ),
            ReportDataPoint(
                measured_at=datetime(2026, 7, 1, 12, 1, tzinfo=timezone.utc),
                received_at=datetime(2026, 7, 1, 12, 1, tzinfo=timezone.utc),
                pv_power_w=None, # Missing value
                grid_power_w=None,
                home_power_w=None,
                pv_energy_today_wh=None,
                grid_import_total_wh=None,
                grid_export_total_wh=None,
                sample_quality_status="unknown",
                source="EnergyRadar"
            )
        ],
        warnings=["Test warning"]
    )

def test_json_exporter_handles_none(sample_report, tmp_path):
    out_path = tmp_path / "test.json"
    json_exporter.export_json(sample_report, str(out_path))

    assert out_path.exists()
    with open(out_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    assert data["metadata"]["period_label"] == "Test"
    # Ensure missing values are explicitly null (None)
    assert data["measurements"][1]["pv_power_w"] is None

def test_csv_exporter_handles_none_and_bom(sample_report, tmp_path):
    out_path = tmp_path / "test.csv"
    csv_exporter.export_csv(sample_report, str(out_path))

    assert out_path.exists()
    with open(out_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check BOM
    assert content.startswith('\ufeff')

    # Check NULL represents as empty
    # In CSV, we have 7 columns: measured_at, received_at, metric_name, value, unit, quality_status, source
    # For the second measurement, pv_power_w is None
    lines = content.splitlines()
    assert len(lines) > 2
    # Find the line for the missing pv_power
    missing_line = next(line for line in lines if "2026-07-01T12:01:00+00:00" in line and "pv_power" in line)
    parts = missing_line.split(',')
    # Value is at index 3
    assert parts[3] == ""

def test_pdf_exporter_creates_valid_pdf(sample_report, tmp_path):
    out_path = tmp_path / "test.pdf"

    # Qt requires a QApplication instance to use QPdfWriter usually,
    # but QPdfWriter might work without GUI if PySide6 is initialized properly.
    # Let's ensure QApplication exists
    from PySide6.QtWidgets import QApplication
    if not QApplication.instance():
        app = QApplication([])

    pdf_exporter.export_pdf(sample_report, str(out_path))

    assert out_path.exists()
    with open(out_path, 'rb') as f:
        header = f.read(4)
        assert header == b'%PDF' # Valid PDF signature

def test_backup_service_creates_valid_zip(tmp_path):
    # Setup dummy db
    db_path = tmp_path / "energy.db"
    with sqlite3.connect(db_path) as con:
        con.execute("CREATE TABLE test (id INTEGER PRIMARY KEY);")
        con.execute("INSERT INTO test VALUES (1);")

    settings_path = tmp_path / "ui-settings.json"
    settings_path.write_text('{"theme": "dark"}')

    # Mock config
    original_db = config.DB_PATH
    original_ud = config.USER_DATA_DIR
    config.DB_PATH = str(db_path)
    config.USER_DATA_DIR = tmp_path

    try:
        zip_path = tmp_path / "backup.zip"
        backup_service.create_backup_zip(str(zip_path))

        assert zip_path.exists()

        with zipfile.ZipFile(zip_path, 'r') as zf:
            files = zf.namelist()
            assert "energy.db" in files
            assert "ui-settings.json" in files
            assert "manifest.json" in files

            with zf.open("manifest.json") as f:
                manifest = json.load(f)
                assert manifest["integrity_check_result"].lower() == "ok"
                assert "sha256" in manifest["files"]["energy.db"]
    finally:
        config.DB_PATH = original_db
        config.USER_DATA_DIR = original_ud

def test_atomic_write_leaves_no_tmp_file(sample_report, tmp_path):
    out_path = tmp_path / "test_atomic.json"
    json_exporter.export_json(sample_report, str(out_path))

    assert out_path.exists()
    # Check that no temp files are left in the directory
    files = list(tmp_path.glob("*.tmp_*"))
    assert len(files) == 0
