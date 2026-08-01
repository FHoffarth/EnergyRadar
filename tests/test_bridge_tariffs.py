import json

from PySide6.QtWidgets import QApplication


_qt_app = None


def _make_bridge(tmp_path, monkeypatch):
    global _qt_app
    from energyradar import config
    from energyradar.ui.bridge import EnergyBridge

    monkeypatch.setattr(config, "USER_DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "database" / "energy.db")
    monkeypatch.setattr(config, "DATA_SOURCE_CONFIG_PATH", tmp_path / "data-source.json")
    monkeypatch.setattr(EnergyBridge, "_on_timer", lambda self: None)
    _qt_app = QApplication.instance() or QApplication([])
    return EnergyBridge()


def test_tariff_bridge_create_update_delete_refreshes_settings(tmp_path, monkeypatch):
    bridge = _make_bridge(tmp_path, monkeypatch)
    success = []
    bridge.tariffOperationSucceeded.connect(lambda payload: success.append(json.loads(payload)))
    payload = {
        "tariff_type": "grid_work_price", "value_ct_per_kwh": "34.00", "annual_eur": None,
        "valid_from": "2026-01-01", "valid_until": None, "label": "Vertrag",
        "source_type": "contract", "provisional": False,
    }
    bridge.saveTariff(json.dumps(payload))
    created = success[-1]["record"]
    assert json.loads(bridge.settingsData)["tariffs"][0]["id"] == created["id"]
    bridge.saveTariff(json.dumps({**payload, "id": created["id"], "value_ct_per_kwh": "35.5"}))
    assert json.loads(bridge.settingsData)["tariffs"][0]["value_ct_per_kwh"] == "35.5"
    bridge.deleteTariff(created["id"])
    assert json.loads(bridge.settingsData)["tariffs"] == []
    bridge.shutdown()


def test_tariff_bridge_failure_emits_no_success(tmp_path, monkeypatch):
    bridge = _make_bridge(tmp_path, monkeypatch)
    success = []
    failed = []
    bridge.tariffOperationSucceeded.connect(success.append)
    bridge.tariffOperationFailed.connect(lambda payload: failed.append(json.loads(payload)))
    bridge.saveTariff(json.dumps({
        "tariff_type": "feed_in_tariff", "value_ct_per_kwh": "NaN",
        "valid_from": "2026-01-01", "source_type": "user_entry", "provisional": False,
    }))
    assert success == []
    assert failed and failed[0]["ok"] is False
    assert json.loads(bridge.settingsData)["tariffs"] == []
    bridge.shutdown()
