import sys
import os
import time
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtCore import QTimer
import json
from pathlib import Path

os.environ["QT_QUICK_CONTROLS_STYLE"] = "Basic"

# add path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from energyradar.config import APP_VERSION, APP_STAGE, APP_BUILD

main_qml_path = "energyradar/ui/qml/main.qml"
with open(main_qml_path, "r", encoding="utf-8") as f:
    original_qml = f.read()

# VM Mocks
memory_vm = {
    "size_mb": 43.0,
    "metrics_count": 2318442,
    "events_count": 9,
    "snapshots_count": 14,
    "last_backup_at": "21.07.2026 18:42",
    "last_export_at": "Heute 09:15",
    "app_version": f"Version {APP_VERSION} {APP_STAGE} - Build {APP_BUILD}",
    "snapshots": [],
    "events": []
}

settings_vm = {
    "fronius_address": "192.168.1.100",
    "fronius_editable": True,
    "mt175_address": "192.168.1.101",
    "refresh_seconds": 5,
    "timezone": "Europe/Berlin",
    "theme": "dark",
    "first_name": "Flo",
    "location": "Berlin",
    "app_version": f"Version {APP_VERSION} {APP_STAGE} - Build {APP_BUILD}"
}

stages = [
    ("MemoryScreen_Smoke", "MemoryScreen.qml", "dark", memory_vm, None),
    ("SettingsScreen_Smoke", "SettingsScreen.qml", "dark", None, settings_vm),
]

app = QGuiApplication(sys.argv)
engine = QQmlApplicationEngine()

current_index = 0
window = None

def capture_next():
    global current_index, window
    if current_index >= len(stages):
        app.quit()
        return

    name, screen, theme, mem_vm, set_vm = stages[current_index]
    print(f"Loading {name}...")

    if window:
        window.deleteLater()
        engine.clearComponentCache()
    
    # Modify main.qml for this stage
    content = original_qml
    
    import re
    # Inject Theme
    content = re.sub(r'return t !== "light";', f'return {"true" if theme == "dark" else "false"};', content)
    
    # Inject VMs
    if mem_vm:
        content = re.sub(r'property var _memoryVM:.*', lambda m: f'property var _memoryVM: JSON.parse(`{json.dumps(mem_vm)}`)', content)
    if set_vm:
        content = re.sub(r'property var _settingsVM:.*', lambda m: f'property var _settingsVM: JSON.parse(`{json.dumps(set_vm)}`)', content)
        
    # Set initial Item
    content = re.sub(r'initialItem: Qt\.resolvedUrl\(".*?"\)', lambda m: f'initialItem: Qt.resolvedUrl("{screen}")', content)

    with open(main_qml_path, "w", encoding="utf-8") as f:
        f.write(content)
        
    engine.load(main_qml_path)
    objs = engine.rootObjects()
    window = objs[-1]
    
    window.setWidth(1440)
    window.setHeight(900)
    
    def grab():
        screen_obj = app.primaryScreen()
        img = screen_obj.grabWindow(window.winId())
        
        out_dir = Path("review_artifacts/pre_release")
        out_dir.mkdir(parents=True, exist_ok=True)
        img.save(str(out_dir / f"{name}.png"))
        print(f"Saved {name}")
        global current_index
        current_index += 1
        QTimer.singleShot(500, capture_next)
        
    QTimer.singleShot(1000, grab)

QTimer.singleShot(100, capture_next)

def on_quit():
    with open(main_qml_path, "w", encoding="utf-8") as f:
        f.write(original_qml)

app.aboutToQuit.connect(on_quit)
sys.exit(app.exec())
