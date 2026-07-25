from datetime import datetime, timezone, timedelta
from energyradar.models.energy import EnergyReading
from energyradar.models.mt175 import MT175Reading
from energyradar.ui.viewmodels import build_now_vm, build_devices_vm

def test_now_vm_pin_locked():
    fronius = EnergyReading(
        timestamp=datetime.now(timezone.utc),
        power=800.0,
        energy_today=1000.0,
        energy_year=50000.0,
        energy_total=100000.0
    )
    mt175 = MT175Reading(
        received_at=datetime.now(timezone.utc),
        timestamp=datetime.now(timezone.utc),
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=200.0,
        current_power_w=None, # PIN locked
        phase_l1_w=None,
        phase_l2_w=None,
        phase_l3_w=None,
        meter_id="123"
    )

    vm = build_now_vm(
        fronius=fronius,
        mt175=mt175,
        fronius_configured=True,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
        stale_threshold_s=15.0
    )

    assert vm.pin_locked is True
    assert vm.grid_power_w is None
    assert vm.consumption_w is None
    assert vm.data_quality == "live"
    assert "PIN-entsperrt" in vm.verdict


def test_now_vm_stale():
    stale_time = datetime.now(timezone.utc) - timedelta(minutes=5)
    fronius = EnergyReading(
        timestamp=stale_time,
        power=800.0,
        energy_today=1000.0,
        energy_year=50000.0,
        energy_total=100000.0
    )
    mt175 = MT175Reading(
        received_at=stale_time,
        timestamp=stale_time,
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=200.0,
        current_power_w=50.0,
        phase_l1_w=10.0,
        phase_l2_w=20.0,
        phase_l3_w=20.0,
        meter_id="123"
    )

    vm = build_now_vm(
        fronius=fronius,
        mt175=mt175,
        fronius_configured=True,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
        stale_threshold_s=15.0
    )

    assert vm.data_quality == "stale"
    assert "Veraltet" in vm.freshness_label
