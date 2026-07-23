import sys
import os
import time
from pathlib import Path
from PySide6.QtCore import QUrl, QTimer, QFile, QIODevice
from PySide6.QtGui import QIcon
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QApplication

# add root path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from energyradar import config
from energyradar.services import migration
from energyradar.ui.bridge import EnergyBridge

out_dir = Path("artifacts")
out_dir.mkdir(parents=True, exist_ok=True)

def main():
    migration.run_migrations()
    app = QApplication(sys.argv)

    view = QWebEngineView()
    view.setWindowTitle("EnergyRadar Smoke Capture")
    view.resize(1440, 900)

    settings = view.settings()
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)

    qwc_file = QFile(":/qtwebchannel/qwebchannel.js")
    if qwc_file.open(QIODevice.OpenModeFlag.ReadOnly):
        qwc_js = bytes(qwc_file.readAll()).decode("utf-8")
        qwc_file.close()
        script = QWebEngineScript()
        script.setName("qwebchannel")
        script.setSourceCode(qwc_js)
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        view.page().scripts().insert(script)

    bridge = EnergyBridge()
    channel = QWebChannel()
    channel.registerObject("bridge", bridge)
    view.page().setWebChannel(channel)

    dist_index = root_dir / "frontend" / "react-ui" / "dist" / "index.html"
    view.load(QUrl.fromLocalFile(str(dist_index)))
    view.show()

    stages = [
        ("now_screen_dark", "now", "dark"),
        ("today_screen_dark", "today", "dark"),
        ("devices_screen_dark", "devices", "dark"),
        ("memory_screen_dark", "memory", "dark"),
        ("settings_screen_dark", "settings", "dark"),
        ("now_screen_light", "now", "light"),
        ("today_screen_light", "today", "light"),
        ("settings_screen_light", "settings", "light"),
    ]

    current_stage = 0

    def process_stage():
        nonlocal current_stage
        if current_stage >= len(stages):
            print("Smoke Capture completed.")
            app.quit()
            return

        name, view_id, theme = stages[current_stage]
        print(f"Capturing {name} ({view_id}, {theme})...")

        # Execute JS to switch view and theme
        js_code = f"""
        (function() {{
          if (window.energyBridge) {{
            // switch theme via patch
            window.energyBridge.updateSettings(JSON.stringify({{ theme: '{theme}' }}));
          }}
          // Dispatch custom event or click navigation if possible
          document.body.setAttribute('data-theme', '{theme}');
          const navBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.toLowerCase().includes('{view_id}'));
          if (navBtn) navBtn.click();
        }})();
        """
        view.page().runJavaScript(js_code)

        def take_screenshot():
            screen_obj = app.primaryScreen()
            img = screen_obj.grabWindow(view.winId())
            file_path = out_dir / f"screenshot_{name}.png"
            img.save(str(file_path))
            print(f"Saved: {file_path}")
            nonlocal current_stage
            current_stage += 1
            QTimer.singleShot(1500, process_stage)

        QTimer.singleShot(2000, take_screenshot)

    QTimer.singleShot(3000, process_stage)
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
