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


def _build_live_vm(*, pv_power=1000.0, grid_power=0.0, skew_seconds=0):
    now = datetime.now(timezone.utc)
    fronius = EnergyReading(
        timestamp=now,
        power=pv_power,
        energy_today=1000.0,
        energy_year=50000.0,
        energy_total=100000.0,
    ) if pv_power is not None else None
    meter = MT175Reading(
        received_at=now + timedelta(seconds=skew_seconds),
        timestamp=now + timedelta(seconds=skew_seconds),
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=200.0,
        current_power_w=grid_power,
        phase_l1_w=None,
        phase_l2_w=None,
        phase_l3_w=None,
        meter_id=None,
        meter_type="MT631",
        pin_locked=False,
    ) if grid_power is not None else None
    return build_now_vm(
        fronius=fronius,
        mt175=meter,
        fronius_configured=True,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
        stale_threshold_s=15.0,
    )


def test_house_power_during_grid_import():
    vm = _build_live_vm(pv_power=1000.0, grid_power=1419.0)
    assert vm.consumption_w == 2419.0


def test_house_power_during_grid_export():
    vm = _build_live_vm(pv_power=1000.0, grid_power=-789.0)
    assert vm.consumption_w == 211.0


def test_house_power_requires_both_sources():
    assert _build_live_vm(pv_power=None, grid_power=1419.0).consumption_w is None
    assert _build_live_vm(pv_power=1000.0, grid_power=None).consumption_w is None


def test_house_power_is_unavailable_when_sources_are_misaligned():
    vm = _build_live_vm(pv_power=1000.0, grid_power=500.0, skew_seconds=20)
    assert vm.consumption_w is None


def test_small_negative_house_power_is_tolerated_but_large_is_unavailable():
    assert _build_live_vm(pv_power=1000.0, grid_power=-1025.0).consumption_w == 0.0
    assert _build_live_vm(pv_power=1000.0, grid_power=-1100.0).consumption_w is None


def test_valid_zero_grid_power_displays_as_zero_not_unavailable():
    vm = _build_live_vm(pv_power=1000.0, grid_power=0.0)
    assert vm.grid_power_w == 0.0
    assert vm.grid_label == "0 W"
    assert vm.grid_available is True
    assert vm.pin_locked is False
    assert vm.verdict_kind == "balanced"
