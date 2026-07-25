import sqlite3
from datetime import datetime, timezone, timedelta
import pytest

from energyradar.services import storage, migration
from energyradar.models.energy import EnergyReading, QualityStatus
from energyradar.models.mt175 import MT175Reading
from energyradar import config

@pytest.fixture
def memory_db(monkeypatch, tmp_path):
    db_path = tmp_path / "test_energy.db"
    monkeypatch.setattr(config, "DB_PATH", db_path)
    storage._MIGRATED = False
    yield db_path

def test_storage_merge_partial_samples(memory_db):
    base_time = datetime(2026, 7, 22, 12, 0, 5, tzinfo=timezone.utc)

    # 1. Nur PV kommt an
    pv = EnergyReading(timestamp=base_time, power=1000, energy_today=5000, energy_year=0, energy_total=0)

    storage.save_sample(
        measured_at=base_time,
        received_at=base_time,
        pv=pv,
        mt175=None,
        sample_quality=QualityStatus.PARTIAL,
        pv_quality=QualityStatus.VALID,
        grid_quality=QualityStatus.UNKNOWN
    )

    samples = storage.get_samples_since(base_time - timedelta(minutes=1))
    assert len(samples) == 1
    assert samples[0]["pv_power_w"] == 1000
    assert samples[0]["grid_power_w"] is None
    assert samples[0]["sample_quality_status"] == "partial"

    # 2. MT175 kommt 4 Sekunden später an (selbes 10s Bucket: 12:00:00)
    mt_time = datetime(2026, 7, 22, 12, 0, 9, tzinfo=timezone.utc)
    mt175 = MT175Reading(
        timestamp=mt_time,
        received_at=mt_time,
        meter_id="test",
        current_power_w=-300,
        phase_l1_w=0.0,
        phase_l2_w=0.0,
        phase_l3_w=0.0,
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=50.0
    )

    storage.save_sample(
        measured_at=base_time,
        received_at=mt_time,
        pv=None,
        mt175=mt175,
        sample_quality=QualityStatus.PARTIAL,
        pv_quality=QualityStatus.UNKNOWN,
        grid_quality=QualityStatus.VALID
    )

    samples = storage.get_samples_since(base_time - timedelta(minutes=1))
    assert len(samples) == 1 # Hat gemerged
    assert samples[0]["pv_power_w"] == 1000
    assert samples[0]["grid_power_w"] == -300
    assert samples[0]["sample_quality_status"] == "valid"

def test_storage_protect_against_null_overwrite(memory_db):
    base_time = datetime(2026, 7, 22, 12, 0, 5, tzinfo=timezone.utc)

    pv = EnergyReading(timestamp=base_time, power=1000, energy_today=5000, energy_year=0, energy_total=0)
    mt175 = MT175Reading(
        timestamp=base_time,
        received_at=base_time,
        meter_id="test",
        current_power_w=-300,
        phase_l1_w=0.0,
        phase_l2_w=0.0,
        phase_l3_w=0.0,
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=50.0
    )

    # Vollen validen Datensatz speichern
    storage.save_sample(
        measured_at=base_time, received_at=base_time,
        pv=pv, mt175=mt175,
        sample_quality=QualityStatus.VALID, pv_quality=QualityStatus.VALID, grid_quality=QualityStatus.VALID
    )

    # Späteres fehlerhaftes Save, das Null enthält, darf den validen Wert nicht löschen
    storage.save_sample(
        measured_at=base_time, received_at=base_time,
        pv=None, mt175=None,
        sample_quality=QualityStatus.PARTIAL, pv_quality=QualityStatus.UNKNOWN, grid_quality=QualityStatus.UNKNOWN
    )

    samples = storage.get_samples_since(base_time - timedelta(minutes=1))
    assert samples[0]["pv_power_w"] == 1000
    assert samples[0]["grid_power_w"] == -300
