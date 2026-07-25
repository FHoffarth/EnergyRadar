import sys
import os
from pathlib import Path
from PySide6.QtCore import QUrl, QTimer, QFile, QIODevice
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QApplication

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from energyradar import config
from energyradar.services import migration
from energyradar.ui.bridge import EnergyBridge

artifacts_dir = root_dir / "artifacts"
artifacts_dir.mkdir(parents=True, exist_ok=True)

def main():
    migration.run_migrations()
    app = QApplication(sys.argv)

    view = QWebEngineView()
    view.setWindowTitle("EnergyRadar Visual Showcase")
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
        ("now_dark", "now", "dark"),
        ("today_dark", "today", "dark"),
        ("devices_dark", "devices", "dark"),
        ("memory_dark", "memory", "dark"),
        ("settings_dark", "settings", "dark"),
        ("now_light", "now", "light"),
        ("today_light", "today", "light"),
        ("devices_light", "devices", "light"),
        ("memory_light", "memory", "light"),
        ("settings_light", "settings", "light"),
    ]

    stage_idx = 0

    def capture_stage():
        nonlocal stage_idx
        if stage_idx >= len(stages):
            print("All screenshots captured successfully!")
            app.quit()
            return

        name, view_id, theme = stages[stage_idx]
        print(f"[{stage_idx+1}/{len(stages)}] Capturing {name}...")

        # Switch theme & view via JS in React App
        js_code = f"""
        (function() {{
          document.body.setAttribute('data-theme', '{theme}');
          const navButtons = Array.from(document.querySelectorAll('nav button, div button'));
          const btn = navButtons.find(b => b.textContent && b.textContent.toLowerCase().includes('{view_id}'));
          if (btn) btn.click();
        }})();
        """
        view.page().runJavaScript(js_code)

        def save_screen():
            pix = view.grab()
            file_path = artifacts_dir / f"screenshot_{name}.png"
            pix.save(str(file_path))
            print(f"Saved: {file_path} ({pix.width()}x{pix.height()})")
            nonlocal stage_idx
            stage_idx += 1
            QTimer.singleShot(1000, capture_stage)

        QTimer.singleShot(1500, save_screen)

    # Wait for initial page load
    view.loadFinished.connect(lambda ok: QTimer.singleShot(2000, capture_stage))
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
