import sys
import json
import logging
import threading
from pathlib import Path

# Fix relative imports
from energyradar import config

# Add the app directory to sys.path so its internal imports work
sys.path.insert(0, str(config.BASE_DIR))

from PySide6.QtGui import QGuiApplication, QFontDatabase, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtCore import Qt, qInstallMessageHandler, QtMsgType
from energyradar.ui.bridge import EnergyBridge
import logging

log = logging.getLogger(__name__)

def qt_message_handler(mode, context, message):
    if mode == QtMsgType.QtInfoMsg:
        log.info(message)
    elif mode == QtMsgType.QtWarningMsg:
        log.warning(message)
    elif mode == QtMsgType.QtCriticalMsg:
        log.error(message)
    elif mode == QtMsgType.QtFatalMsg:
        log.critical(message)

def main():
    import os
    os.environ["QT_QUICK_CONTROLS_STYLE"] = "Basic"
    
    # Logging Setup
    log_file = config.DATA_DIR / "energyradar.log"
    logging.basicConfig(
        filename=log_file,
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    console = logging.StreamHandler()
    console.setLevel(logging.WARNING)
    logging.getLogger("").addHandler(console)
    
    qInstallMessageHandler(qt_message_handler)

    log.info("Starting EnergyRadar QML...")

    # Set up Qt App
    QGuiApplication.setApplicationName("EnergyRadar")
    QGuiApplication.setOrganizationName("FHoffarth")
    QGuiApplication.setOrganizationDomain("hoffarth.com")
    
    # High DPI
    QGuiApplication.setAttribute(Qt.AA_EnableHighDpiScaling)

    app = QGuiApplication(sys.argv)
    
    # Load custom font if available
    font_path = config.BASE_DIR / "static" / "fonts" / "Inter-Regular.ttf"
    if font_path.exists():
        QFontDatabase.addApplicationFont(str(font_path))
        font_bold = config.BASE_DIR / "static" / "fonts" / "Inter-SemiBold.ttf"
        if font_bold.exists():
            QFontDatabase.addApplicationFont(str(font_bold))

    # Try setting window icon
    icon_path = config.BASE_DIR / "static" / "icons" / "favicon-32.png"
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    engine = QQmlApplicationEngine()

    # Load bridge
    bridge = EnergyBridge()
    engine.rootContext().setContextProperty("bridge", bridge)

    # Load UI
    qml_file = config.BASE_DIR / "ui" / "qml" / "main.qml"
    engine.load(str(qml_file))

    if not engine.rootObjects():
        log.error("Failed to load QML!")
        sys.exit(-1)
        
    window = engine.rootObjects()[0]
    
    # Window geometry persistence (compatible with desktop.py window.json)
    window_state_file = config.DATA_DIR / "window.json"
    
    def save_window_state():
        state = {
            "x": window.x(),
            "y": window.y(),
            "width": window.width(),
            "height": window.height(),
        }
        try:
            window_state_file.write_text(json.dumps(state))
        except OSError:
            pass

    # Restore window state
    if window_state_file.exists():
        try:
            state = json.loads(window_state_file.read_text())
            window.setX(state.get("x", window.x()))
            window.setY(state.get("y", window.y()))
            window.setWidth(state.get("width", window.width()))
            window.setHeight(state.get("height", window.height()))
        except Exception:
            pass

    # Shutdown hook
    app.aboutToQuit.connect(save_window_state)
    app.aboutToQuit.connect(bridge.shutdown)

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
