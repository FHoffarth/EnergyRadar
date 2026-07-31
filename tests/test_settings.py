import json
from pathlib import Path
import pytest
from energyradar.ui import settings as ui_settings
from energyradar.ui import viewmodels
from energyradar import config

def test_patch_semantics(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    # 1. Initialer Patch
    patch1 = {"theme": "dark", "motion_mode": "full", "refresh_seconds": 10}
    saved1 = ui_settings.save_patch(patch1)
    assert saved1["theme"] == "dark"
    assert saved1["motion_mode"] == "full"
    assert saved1["refresh_seconds"] == 10

    # 2. Zweiter Patch - update theme, missing keys MUST be retained
    patch2 = {"theme": "light"}
    saved2 = ui_settings.save_patch(patch2)
    assert saved2["theme"] == "light"
    assert saved2["motion_mode"] == "full"
    assert saved2["refresh_seconds"] == 10

    # 3. Explizites null setzt einen Wert auf None zurück
    patch3 = {"motion_mode": None}
    saved3 = ui_settings.save_patch(patch3)
    assert saved3["motion_mode"] is None
    assert saved3["theme"] == "light"


def test_defaults_not_persisted(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    # Save minimal user decision
    ui_settings.save_patch({"theme": "light"})

    raw_json = json.loads(settings_file.read_text(encoding="utf-8"))
    assert "theme" in raw_json
    # System defaults MUST NOT be written into the file
    assert "dynamic_bg_enabled" not in raw_json
    assert "motion_mode" not in raw_json
    assert "app_version" not in raw_json

    # Effective settings resolve defaults at runtime
    effective = ui_settings.resolve_effective(raw_json)
    assert effective["theme"] == "light"
    assert effective["dynamic_bg_enabled"] is True
    assert effective["motion_mode"] == "full"


def test_corrupt_settings_fallback(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    # Write corrupt JSON
    settings_file.write_text("{corrupt_json_invalid", encoding="utf-8")

    raw = ui_settings.load_raw_dict()
    assert raw == {}

    # Check that corrupt file was backed up
    corrupt_files = list(tmp_path.glob("ui-settings.corrupt-*.json"))
    assert len(corrupt_files) == 1


def test_coordinate_validation():
    # Valid coordinates
    valid = ui_settings.validate_patch({"latitude": 49.87, "longitude": 8.93})
    assert valid["latitude"] == 49.87
    assert valid["longitude"] == 8.93

    # Invalid latitude
    with pytest.raises(ValueError):
        ui_settings.validate_patch({"latitude": 105.0})

    # Invalid longitude
    with pytest.raises(ValueError):
        ui_settings.validate_patch({"longitude": -200.0})

    # NaN / Infinity rejection
    with pytest.raises(ValueError):
        ui_settings.validate_patch({"latitude": float('nan')})


def test_refresh_interval_stays_within_live_cadence():
    assert ui_settings.validate_patch({"refresh_seconds": 3})["refresh_seconds"] == 3
    assert ui_settings.validate_patch({"refresh_seconds": 7})["refresh_seconds"] == 7
    assert ui_settings.validate_patch({"refresh_seconds": 60})["refresh_seconds"] == 10

    with pytest.raises(ValueError):
        ui_settings.validate_patch({"refresh_seconds": float("inf")})


def test_viewmodel_separation(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    ui_settings.save_patch({"theme": "light"})
    vm = viewmodels.build_settings_vm()

    assert vm.settings == {"theme": "light"}
    assert vm.effective_settings["theme"] == "light"
    assert vm.effective_settings["dynamic_bg_enabled"] is True
    assert "app_version" in vm.system
    assert "database_schema_version" in vm.system
    assert "database_path" in vm.system


def test_personalized_greeting_settings_are_local_and_migration_safe(tmp_path, monkeypatch):
    settings_file = tmp_path / "ui-settings.json"
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: settings_file)

    effective = ui_settings.resolve_effective({})
    assert effective["preferred_name"] is None
    assert effective["greeting_enabled"] is True

    saved = ui_settings.save_patch({"preferred_name": "  Florian   Hoffarth  ", "greeting_enabled": False})
    assert saved["preferred_name"] == "Florian Hoffarth"
    assert saved["greeting_enabled"] is False
    assert ui_settings.load_raw_dict() == saved

    cleared = ui_settings.save_patch({"preferred_name": "   "})
    assert cleared["preferred_name"] is None


def test_settings_viewmodel_uses_authoritative_version(tmp_path, monkeypatch):
    monkeypatch.setattr(ui_settings, "_settings_path", lambda: tmp_path / "ui-settings.json")
    vm = viewmodels.build_settings_vm()
    assert vm.system["app_version"] == config.APP_VERSION


def test_legacy_footer_uses_authoritative_version():
    from energyradar.app import app

    with app.test_client() as client:
        html = client.get("/").get_data(as_text=True)
    assert f"EnergyRadar {config.APP_VERSION}" in html
    assert "EnergyRadar v1.0" not in html


def test_frontend_package_version_matches_authoritative_version():
    package_path = Path(__file__).parents[1] / "frontend" / "react-ui" / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    assert package["version"] == config.APP_VERSION
