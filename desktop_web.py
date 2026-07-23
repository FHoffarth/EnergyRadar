"""
desktop_web.py — EnergyRadar Desktop (React + QtWebEngine)

Entry Point für den Weg-A-Build:
- Lädt die gebaute React-App aus frontend/react-ui/dist/
- Verbindet EnergyBridge über QWebChannel
- Kein Flask, kein lokaler HTTP-Server, kein QML
"""
import json
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

from PySide6.QtCore import QUrl, Qt, QFile, QIODevice
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWidgets import QApplication

from energyradar import config
from energyradar.services import migration
from energyradar.ui.bridge import EnergyBridge


class DiagnosticWebPage(QWebEnginePage):
    """Route JavaScript console messages into the application diagnostics."""

    def javaScriptConsoleMessage(
        self,
        level: QWebEnginePage.JavaScriptConsoleMessageLevel,
        message: str,
        line_number: int,
        source_id: str,
    ) -> None:
        method = {
            QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel: log.info,
            QWebEnginePage.JavaScriptConsoleMessageLevel.WarningMessageLevel: log.warning,
            QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel: log.error,
        }.get(level, log.info)
        method(
            "WebEngine console: %s (%s:%s)",
            message,
            source_id or "<inline>",
            line_number,
        )


def _configure_file_logging() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_path = (config.DATA_DIR / "energyradar.log").resolve()
    root = logging.getLogger()
    if any(
        isinstance(handler, logging.FileHandler)
        and Path(handler.baseFilename).resolve() == log_path
        for handler in root.handlers
    ):
        return

    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    root.addHandler(handler)


def _find_dist() -> Path:
    """Findet das gebaute React-dist/ Verzeichnis (frozen oder Entwicklung)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # Im PyInstaller-Bundle
        return Path(sys._MEIPASS) / "react-ui" / "dist"
    else:
        # Entwicklungsmodus: relativ zur Projektroot
        return Path(__file__).resolve().parent / "frontend" / "react-ui" / "dist"


def _window_geometry_is_visible(x: int, y: int, width: int, height: int) -> bool:
    """Return whether the saved window rectangle intersects an active screen."""
    screens = [
        (
            geometry.x(),
            geometry.y(),
            geometry.width(),
            geometry.height(),
        )
        for screen in QGuiApplication.screens()
        for geometry in [screen.availableGeometry()]
    ]
    return _geometry_intersects_available_screens(x, y, width, height, screens)


def _geometry_intersects_available_screens(
    x: int,
    y: int,
    width: int,
    height: int,
    screens: list[tuple[int, int, int, int]],
) -> bool:
    """Return whether a usable window rectangle intersects a screen."""
    if width < 640 or height < 480:
        return False

    right = x + width
    bottom = y + height
    return any(
        x < screen_x + screen_width
        and right > screen_x
        and y < screen_y + screen_height
        and bottom > screen_y
        for screen_x, screen_y, screen_width, screen_height in screens
    )


def main() -> None:
    _configure_file_logging()
    log.info("Starting EnergyRadar (React/WebEngine)...")
    migration.run_migrations()

    app = QApplication(sys.argv)
    app.setApplicationName("EnergyRadar")
    app.setOrganizationName("EnergyRadar")

    # Icon
    icon_path = config.BASE_DIR / "ui" / "assets" / "logo.ico"
    if not icon_path.exists():
        icon_path = config.BASE_DIR / "ui" / "assets" / "icons" / "app.ico"

    if icon_path.exists():
        app_icon = QIcon(str(icon_path))
        app.setWindowIcon(app_icon)

    # ── Browser View ────────────────────────────────────────────────
    view = QWebEngineView()
    view.setPage(DiagnosticWebPage(view))
    view.setWindowTitle("EnergyRadar")
    if icon_path.exists():
        view.setWindowIcon(QIcon(str(icon_path)))
    view.resize(1200, 800)

    # WebEngine-Einstellungen
    settings = view.settings()
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)

    # ── Inject qwebchannel.js from Qt's internal resources ───────────
    # Qt ships this as qrc:/qtwebchannel/qwebchannel.js — we inject it
    # as a UserScript so window.QWebChannel is available in React.
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
        log.info("qwebchannel.js injected from Qt resources")
    else:
        log.warning("Could not load qrc:/qtwebchannel/qwebchannel.js — bridge will not connect")

    # ── QWebChannel ──────────────────────────────────────────────────
    bridge = EnergyBridge()
    channel = QWebChannel()
    channel.registerObject("bridge", bridge)
    view.page().setWebChannel(channel)

    # ── React-App laden ──────────────────────────────────────────────
    dist = _find_dist()
    index_html = dist / "index.html"

    if not index_html.exists():
        log.error("React dist not found at %s", index_html)
        log.error("Run: cd frontend/react-ui && npm run build")
        sys.exit(1)

    url = QUrl.fromLocalFile(str(index_html))
    log.info("Loading React app from: %s", index_html)
    view.load(url)

    # ── Window-State-Persistence ─────────────────────────────────────
    window_state_file = config.DATA_DIR / "window.json"

    def restore_window_state() -> None:
        try:
            if window_state_file.exists():
                state = json.loads(window_state_file.read_text())
                x, y = int(state.get("x", 100)), int(state.get("y", 100))
                w, h = int(state.get("width", 1200)), int(state.get("height", 800))
                if _window_geometry_is_visible(x, y, w, h):
                    view.setGeometry(x, y, w, h)
                else:
                    log.warning("Rejected off-screen window geometry: %s", state)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            log.warning("Could not restore saved window geometry", exc_info=True)

    def save_window_state() -> None:
        try:
            geo = view.geometry()
            state = {"x": geo.x(), "y": geo.y(), "width": geo.width(), "height": geo.height()}
            if not _window_geometry_is_visible(
                state["x"], state["y"], state["width"], state["height"]
            ):
                log.warning("Skipped off-screen window geometry: %s", state)
                return
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            window_state_file.write_text(json.dumps(state))
        except OSError:
            log.warning("Could not save window geometry", exc_info=True)

    restore_window_state()

    # ── Close handler ────────────────────────────────────────────────
    def on_close() -> None:
        save_window_state()
        bridge.shutdown()

    app.aboutToQuit.connect(on_close)

    view.show()
    log.info("EnergyRadar running — Qt event loop started")
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
