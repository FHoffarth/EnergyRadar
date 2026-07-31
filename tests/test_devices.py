from datetime import datetime, timezone, timedelta
import pytest
from energyradar.models.energy import EnergyReading
from energyradar.models.mt175 import MT175Reading
from energyradar.ui.viewmodels import build_devices_vm
from energyradar.ui.bridge import _smart_meter_connection_result
from energyradar.services import data_source as ds


def _meter(*, power, import_total, export_total):
    now = datetime.now(timezone.utc)
    return MT175Reading(
        received_at=now,
        timestamp=now,
        grid_import_total_kwh=import_total,
        grid_export_total_kwh=export_total,
        current_power_w=power,
        phase_l1_w=None,
        phase_l2_w=None,
        phase_l3_w=None,
        meter_id=None,
        meter_type="MT631",
        pin_locked=False,
    )


def _smart_meter_card(reading):
    cards = build_devices_vm(
        fronius=None,
        mt175=reading,
        fronius_configured=False,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
    )
    return next(card for card in cards if card.device_id == "mt175_primary")


@pytest.mark.parametrize(
    (
        "power",
        "import_total",
        "export_total",
        "expected_status",
        "expected_capabilities",
        "message_fragment",
    ),
    [
        (
            3557.0,
            None,
            None,
            "partial",
            ["current_power"],
            "Zählerstände sind nicht verfügbar",
        ),
        (0.0, None, None, "partial", ["current_power"], "aktuelle Netzleistung"),
        (
            0.0,
            0.0,
            0.0,
            "complete",
            ["grid_import_total", "grid_export_total", "current_power"],
            "Zählerstände und aktuelle Netzleistung",
        ),
        (
            3557.0,
            100.0,
            None,
            "partial",
            ["grid_import_total", "current_power"],
            "Einspeisezählerstand ist nicht verfügbar",
        ),
        (
            None,
            100.0,
            200.0,
            "partial",
            ["grid_import_total", "grid_export_total"],
            "aktuelle Netzleistung ist nicht verfügbar",
        ),
        (None, None, None, "unavailable", [], "keine gültigen Messwerte"),
    ],
    ids=[
        "power-only",
        "zero-power-only",
        "all-values-including-zero",
        "one-total-missing",
        "totals-only",
        "no-measurements",
    ],
)
def test_smart_meter_availability_is_consistent_across_ui_paths(
    power,
    import_total,
    export_total,
    expected_status,
    expected_capabilities,
    message_fragment,
):
    reading = _meter(
        power=power,
        import_total=import_total,
        export_total=export_total,
    )

    card = _smart_meter_card(reading)
    assert card.data_status == expected_status
    assert card.capabilities == expected_capabilities
    assert message_fragment in card.user_message

    connection = _smart_meter_connection_result(reading, latency_ms=12)
    assert connection["data_status"] == expected_status
    assert connection["capabilities"] == expected_capabilities
    assert connection["message"] == card.user_message
    assert connection["status"] == {
        "complete": "connected",
        "partial": "partial",
        "unavailable": "unavailable",
    }[expected_status]


def test_power_only_message_does_not_claim_totals_are_available():
    reading = _meter(power=3557.0, import_total=None, export_total=None)
    message = _smart_meter_card(reading).user_message
    assert "Zählerstände sind nicht verfügbar" in message
    assert "liefert Zählerstände" not in message

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


def test_mt631_unavailable_power_is_not_reported_as_pin_locked():
    now = datetime.now(timezone.utc)
    meter = MT175Reading(
        received_at=now,
        timestamp=now,
        grid_import_total_kwh=100.0,
        grid_export_total_kwh=200.0,
        current_power_w=None,
        phase_l1_w=None,
        phase_l2_w=None,
        phase_l3_w=None,
        meter_id=None,
        meter_type="MT631",
        pin_locked=False,
    )
    cards = build_devices_vm(
        fronius=None,
        mt175=meter,
        fronius_configured=False,
        mt175_configured=True,
        fronius_error=None,
        mt175_error=None,
    )
    card = next(c for c in cards if c.device_id == "mt175_primary")
    assert card.display_name == "Tasmota SmartMeterReader"
    assert card.data_status == "partial"
    assert card.pin_status == "not_applicable"
    assert card.pin_instructions is None
    assert "aktuelle Netzleistung ist nicht verfügbar" in card.user_message


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
