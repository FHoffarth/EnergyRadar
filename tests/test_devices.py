from datetime import datetime, timezone, timedelta
from energyradar.models.energy import EnergyReading
from energyradar.models.mt175 import MT175Reading
from energyradar.ui.viewmodels import build_devices_vm
from energyradar.services import data_source as ds

def test_devices_vm_pin_locked():
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

    cards = build_devices_vm(
        fronius=None,
        mt175=mt175,
        fronius_configured=False,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
        mt175_address="http://192.168.1.41"
    )

    mt175_card = next(c for c in cards if c.device_id == "mt175_primary")
    assert mt175_card.connection_status == "connected"
    assert mt175_card.data_status == "partial"
    assert mt175_card.pin_status == "locked"
    assert mt175_card.pin_instructions is not None
    assert "PIN-Freigabe" in mt175_card.pin_instructions
    assert "grid_import_total" in mt175_card.capabilities
    assert "current_power" not in mt175_card.capabilities


def test_devices_vm_firmware_missing():
    fronius = EnergyReading(
        timestamp=datetime.now(timezone.utc),
        power=500.0,
        energy_today=10.0,
        energy_year=100.0,
        energy_total=1000.0
    )

    cards = build_devices_vm(
        fronius=fronius,
        mt175=None,
        fronius_configured=True,
        mt175_configured=False,
        fronius_error=None,
        mt175_error=None,
    )

    fronius_card = next(c for c in cards if c.device_id == "fronius_primary")
    assert fronius_card.firmware is None  # Unknown is None, not text placeholder
    assert fronius_card.connection_status == "connected"
    assert fronius_card.data_status == "complete"


def test_credential_masking():
    unsafe_url = "http://example-user:example-credential@192.168.1.40:8080/solar_api?parameter=example"
    masked = ds.mask_address_credentials(unsafe_url)
    assert "admin" not in masked
    assert "secret123" not in masked
    assert "token" not in masked
    assert masked == "http://192.168.1.40:8080"


def test_unconfigured_state():
    cards = build_devices_vm(
        fronius=None,
        mt175=None,
        fronius_configured=False,
        mt175_configured=False,
        fronius_error=None,
        mt175_error=None
    )
    for card in cards:
        assert card.connection_status == "unconfigured"
        assert card.data_status == "unconfigured"
        assert card.configuration_status == "unconfigured"
