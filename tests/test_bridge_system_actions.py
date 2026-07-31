import json
from pathlib import Path

from PySide6.QtWidgets import QApplication, QFileDialog


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


def _results(bridge):
    received = []
    bridge.systemActionResult.connect(lambda payload: received.append(json.loads(payload)))
    return received


def test_export_directory_open_creates_configured_directory_and_uses_real_path(tmp_path, monkeypatch):
    from energyradar.ui import bridge as bridge_module
    from energyradar.ui import settings as ui_settings

    export_dir = tmp_path / "Export mit Leerzeichen" / "Energie"
    opened = []
    monkeypatch.setattr(bridge_module, "_open_path", lambda path: opened.append(path))
    bridge = _make_bridge(tmp_path, monkeypatch)
    ui_settings.save_patch({"export_directory": str(export_dir)})
    received = _results(bridge)

    bridge.openExportDirectory()
    bridge.shutdown()

    assert export_dir.is_dir()
    assert opened == [export_dir]
    assert received == [{
        "ok": True,
        "status": "success",
        "action": "openExportDirectory",
        "message": "Exportordner geöffnet.",
        "path": str(export_dir),
    }]


def test_folder_selection_updates_draft_signal_without_persisting(tmp_path, monkeypatch):
    from energyradar.ui import settings as ui_settings

    old_dir = tmp_path / "old"
    selected_dir = tmp_path / "neu gewählt"
    monkeypatch.setattr(QFileDialog, "getExistingDirectory", lambda *_args: str(selected_dir))
    bridge = _make_bridge(tmp_path, monkeypatch)
    ui_settings.save_patch({"export_directory": str(old_dir)})
    received = _results(bridge)
    selected = []
    bridge.directorySelected.connect(selected.append)

    bridge.chooseExportDirectory()
    bridge.shutdown()

    assert selected == [str(selected_dir)]
    assert ui_settings.load_raw_dict()["export_directory"] == str(old_dir)
    assert received[0]["status"] == "success"
    assert received[0]["path"] == str(selected_dir)


def test_folder_selection_cancellation_preserves_persisted_value(tmp_path, monkeypatch):
    from energyradar.ui import settings as ui_settings

    old_dir = tmp_path / "old"
    monkeypatch.setattr(QFileDialog, "getExistingDirectory", lambda *_args: "")
    bridge = _make_bridge(tmp_path, monkeypatch)
    ui_settings.save_patch({"export_directory": str(old_dir)})
    received = _results(bridge)
    selected = []
    bridge.directorySelected.connect(selected.append)

    bridge.chooseExportDirectory()
    bridge.shutdown()

    assert selected == []
    assert ui_settings.load_raw_dict()["export_directory"] == str(old_dir)
    assert received[0]["status"] == "cancelled"


def test_selected_export_directory_persists_only_after_settings_save(tmp_path, monkeypatch):
    from energyradar.ui import settings as ui_settings

    old_dir = tmp_path / "old"
    selected_dir = tmp_path / "selected"
    monkeypatch.setattr(QFileDialog, "getExistingDirectory", lambda *_args: str(selected_dir))
    bridge = _make_bridge(tmp_path, monkeypatch)
    ui_settings.save_patch({"export_directory": str(old_dir)})

    bridge.chooseExportDirectory()
    assert ui_settings.load_raw_dict()["export_directory"] == str(old_dir)

    bridge.updateSettings(json.dumps({"export_directory": str(selected_dir)}))
    bridge.shutdown()

    assert ui_settings.load_raw_dict()["export_directory"] == str(selected_dir)


def test_missing_diagnostic_log_is_friendly_and_does_not_create_file(tmp_path, monkeypatch):
    from energyradar.ui import bridge as bridge_module

    opened = []
    monkeypatch.setattr(bridge_module, "_open_path", lambda path: opened.append(path))
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = _results(bridge)
    log_path = tmp_path / "energyradar.log"
    log_path.unlink(missing_ok=True)

    bridge.openDiagnosticLog()
    bridge.shutdown()

    assert opened == []
    assert not log_path.exists()
    assert received[0]["ok"] is False
    assert received[0]["message"] == "Das Systemprotokoll ist derzeit nicht verfügbar."
    assert "error" not in received[0]


def test_existing_diagnostic_log_opens_actual_file(tmp_path, monkeypatch):
    from energyradar.ui import bridge as bridge_module

    log_path = tmp_path / "energyradar.log"
    log_path.write_text("existing log", encoding="utf-8")
    opened = []
    monkeypatch.setattr(bridge_module, "_open_path", lambda path: opened.append(path))
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = _results(bridge)

    bridge.openDiagnosticLog()
    bridge.shutdown()

    assert opened == [log_path]
    assert received[0]["path"] == str(log_path)


def test_log_directory_open_uses_application_data_directory(tmp_path, monkeypatch):
    from energyradar.ui import bridge as bridge_module

    opened = []
    monkeypatch.setattr(bridge_module, "_open_path", lambda path: opened.append(path))
    bridge = _make_bridge(tmp_path, monkeypatch)
    received = _results(bridge)

    bridge.openLogDirectory()
    bridge.shutdown()

    assert opened == [tmp_path]
    assert received[0]["path"] == str(tmp_path)


def test_platform_opener_failure_returns_friendly_message_without_exception_leak(tmp_path, monkeypatch):
    from energyradar.ui import bridge as bridge_module
    from energyradar.ui import settings as ui_settings

    secret_error = "NameError: private backend detail"
    export_dir = tmp_path / "exports"
    monkeypatch.setattr(bridge_module, "_open_path", lambda _path: (_ for _ in ()).throw(OSError(secret_error)))
    bridge = _make_bridge(tmp_path, monkeypatch)
    ui_settings.save_patch({"export_directory": str(export_dir)})
    received = _results(bridge)

    bridge.openExportDirectory()
    bridge.shutdown()

    assert received[0]["ok"] is False
    assert received[0]["message"] == "Der Exportordner konnte nicht geöffnet werden."
    assert secret_error not in json.dumps(received[0])
    assert "error" not in received[0]


def test_windows_opener_uses_os_startfile(monkeypatch, tmp_path):
    from energyradar.ui import bridge as bridge_module

    target = tmp_path / "Datei mit Leerzeichen.txt"
    target.write_text("x", encoding="utf-8")
    opened = []
    monkeypatch.setattr(bridge_module.sys, "platform", "win32")
    monkeypatch.setattr(bridge_module.os, "startfile", lambda path: opened.append(path), raising=False)

    bridge_module._open_path(target)

    assert opened == [str(target)]
