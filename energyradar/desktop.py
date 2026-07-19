"""EnergyRadar – nativer Desktop-Start.

Startet den bestehenden Flask-Server still im Hintergrund und zeigt die
Anwendung in einem nativen Fenster (pywebview). Reines Packaging bzw.
Orchestrierung – hier liegt keine Fachlogik.

Entwicklung:   python desktop.py
Gepackt:       EnergyRadar.app / EnergyRadar.exe (Doppelklick)
"""

import json
import logging
import os
import socket
import sys
import threading
import time
from pathlib import Path

# Die Package-Module (config, app, collectors, services) müssen importierbar
# sein, egal aus welchem Verzeichnis gestartet wird (Entwicklung oder gepackt).
sys.path.insert(0, str(Path(__file__).resolve().parent))

import webview  # noqa: E402
from webview.menu import Menu, MenuAction, MenuSeparator  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

import config  # noqa: E402

APP_NAME = "EnergyRadar"
APP_VERSION = "1.0.0"
HOST = "127.0.0.1"
DEFAULT_SIZE = (980, 900)
MIN_SIZE = (420, 640)
BACKGROUND = "#07111E"  # gleiche Grundfarbe wie die dunkle App-Oberfläche
STARTUP_TIMEOUT = 15.0
REVEAL_FALLBACK = 12.0  # Splash spätestens danach schließen

log = logging.getLogger("energyradar.desktop")

# Windows moves minimized windows to a sentinel position near -32000/-32000.
# It is not a real desktop coordinate and must never become a start position.
WINDOWS_MINIMIZED_SENTINEL = -30000


# --------------------------------------------------------------------------- #
# Infrastruktur
# --------------------------------------------------------------------------- #

def _setup_logging() -> None:
    """Entwicklerlogs wandern in eine Datei – der Nutzer sieht nie eine Konsole."""
    logfile = config.DATA_DIR / "energyradar.log"
    logfile.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        filename=str(logfile),
        filemode="a",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Zugriffs-Logs von Werkzeug nicht sichtbar machen.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


def _startup_milestone(name: str, **details) -> None:
    """Write distinct packaged-startup phases to the existing file log."""
    suffix = " ".join(f"{key}={value}" for key, value in details.items())
    log.info("STARTUP %s%s", name, f" {suffix}" if suffix else "")


def _free_port() -> int:
    """Einen freien, lokalen Port vom Betriebssystem erbitten."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


class FlaskServer(threading.Thread):
    """Führt die bestehende Flask-App im Hintergrund aus und lässt sich
    sauber wieder beenden (kein verwaister Prozess, kein Reloader)."""

    def __init__(self, host: str, port: int) -> None:
        super().__init__(daemon=True, name="energyradar-flask")
        from app import _seed_demo_history, app

        # Im gepackten Zustand liegen templates/ und static/ neben dem Programm.
        if getattr(sys, "frozen", False):
            base = Path(getattr(sys, "_MEIPASS", config.BASE_DIR))
            app.root_path = str(base)
            app.template_folder = str(base / "templates")
            app.static_folder = str(base / "static")

        _seed_demo_history()  # unverändert: nur im Demo-Modus aktiv
        self._server = make_server(host, port, app, threaded=True)

    def run(self) -> None:
        self._server.serve_forever()

    def shutdown(self) -> None:
        self._server.shutdown()


def _wait_until_ready(host: str, port: int, timeout: float) -> bool:
    """Wartet, bis der Server Verbindungen annimmt (verhindert leeres Fenster)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


# --------------------------------------------------------------------------- #
# Fensterposition und -größe merken
# --------------------------------------------------------------------------- #

def _state_file() -> Path:
    return config.DATA_DIR / "window.json"


def _load_window_state() -> dict:
    """Gemerkte Größe/Position; fällt auf sinnvolle Standardwerte zurück."""
    state = {"width": DEFAULT_SIZE[0], "height": DEFAULT_SIZE[1], "x": None, "y": None}
    try:
        data = json.loads(_state_file().read_text(encoding="utf-8"))
        w, h = int(data["width"]), int(data["height"])
        if w >= MIN_SIZE[0] and h >= MIN_SIZE[1]:
            state["width"], state["height"] = w, h
        if data.get("x") is not None and data.get("y") is not None:
            x, y = int(data["x"]), int(data["y"])
            if _is_window_position_visible(x, y, state["width"], state["height"]):
                state["x"], state["y"] = x, y
            else:
                log.warning(
                    "STARTUP saved_window_position_rejected x=%s y=%s", x, y
                )
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return state


def _save_window_state(state: dict) -> None:
    try:
        _state_file().parent.mkdir(parents=True, exist_ok=True)
        _state_file().write_text(json.dumps(state), encoding="utf-8")
    except OSError as exc:  # pragma: no cover - defensiv
        log.warning("Fensterzustand konnte nicht gespeichert werden: %s", exc)


def _windows_rect_intersects_monitor(x: int, y: int, width: int, height: int) -> bool:
    """Return whether a rectangle intersects an active Windows monitor."""
    try:
        import ctypes
        from ctypes import wintypes

        rect = wintypes.RECT(x, y, x + width, y + height)
        # MONITOR_DEFAULTTONULL avoids silently selecting the primary monitor.
        return bool(ctypes.windll.user32.MonitorFromRect(ctypes.byref(rect), 0))
    except (AttributeError, OSError):
        # The sentinel check still prevents the concrete minimize regression.
        return True


def _is_window_position_visible(x: int, y: int, width: int, height: int) -> bool:
    if x <= WINDOWS_MINIMIZED_SENTINEL or y <= WINDOWS_MINIMIZED_SENTINEL:
        return False
    if sys.platform == "win32":
        return _windows_rect_intersects_monitor(x, y, width, height)
    return True


def _capture_geometry(window, state: dict) -> None:
    """Aktuelle Größe/Position vom lebenden Fenster lesen (best effort)."""
    try:
        width, height = int(window.width), int(window.height)
        x, y = int(window.x), int(window.y)
        if width >= MIN_SIZE[0] and height >= MIN_SIZE[1]:
            state["width"], state["height"] = width, height
        if _is_window_position_visible(x, y, state["width"], state["height"]):
            state["x"], state["y"] = x, y
    except (TypeError, AttributeError):  # pragma: no cover - Fenster evtl. weg
        pass


def _track_window(window, state: dict) -> None:
    """Größe/Position laufend mitschreiben und beim Schließen sichern.
    (Werte müssen vor dem Zerstören gelesen werden – daher über Events.)"""

    def _on_resized(width: int, height: int) -> None:
        if width >= MIN_SIZE[0] and height >= MIN_SIZE[1]:
            state["width"], state["height"] = width, height

    def _on_moved(x: int, y: int) -> None:
        if _is_window_position_visible(x, y, state["width"], state["height"]):
            state["x"], state["y"] = x, y

    window.events.resized += _on_resized
    window.events.moved += _on_moved
    window.events.closed += lambda: _save_window_state(state)


# --------------------------------------------------------------------------- #
# Kleine HTML-Bausteine (Splash, Fehler, Über)
# --------------------------------------------------------------------------- #

_PAGE_CSS = """
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
       background:#07111E;color:#E6EDF3;-webkit-user-select:none;user-select:none;
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .box{max-width:32rem;text-align:center;padding:2rem}
  .logo{font-size:2.6rem;margin-bottom:1rem}
  h1{font-size:1.35rem;margin:0 0 .6rem}
  p{color:#9FB0C0;margin:.2rem 0}
  .muted{color:#5E7186;font-size:.85rem}
"""

_SPLASH_HTML = f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><style>{_PAGE_CSS}
  .spin{{width:26px;height:26px;margin:1.1rem auto 0;border-radius:50%;
        border:3px solid rgba(159,176,192,.25);border-top-color:#F5B301;
        animation:r .8s linear infinite}}
  @keyframes r{{to{{transform:rotate(360deg)}}}}
</style></head>
<body><div class="box">
  <div class="logo">☀️</div>
  <h1>{APP_NAME} wird gestartet …</h1>
  <div class="spin"></div>
</div></body></html>"""

_ERROR_HTML = f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><style>{_PAGE_CSS}</style></head>
<body><div class="box">
  <div class="logo">☀️</div>
  <h1>{APP_NAME} konnte nicht gestartet werden.</h1>
  <p>Bitte starten Sie die Anwendung neu.</p>
</div></body></html>"""

_ABOUT_HTML = f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><style>{_PAGE_CSS}</style></head>
<body><div class="box">
  <div class="logo">☀️</div>
  <h1>{APP_NAME}</h1>
  <p>Understand your energy.</p>
  <p class="muted">Version {APP_VERSION}</p>
</div></body></html>"""


# --------------------------------------------------------------------------- #
# Menü: Über-Dialog und Beenden
# --------------------------------------------------------------------------- #

_about_window = None


def _show_about() -> None:
    global _about_window
    if _about_window is not None:
        return  # bereits offen
    _about_window = webview.create_window(
        f"Über {APP_NAME}",
        html=_ABOUT_HTML,
        width=360,
        height=300,
        resizable=False,
        background_color=BACKGROUND,
    )

    def _closed() -> None:
        global _about_window
        _about_window = None

    _about_window.events.closed += _closed


def _quit() -> None:
    """Sauberer Ausstieg per Menü – schließt alle Fenster, der Rest folgt."""
    for win in list(webview.windows):
        try:
            win.destroy()
        except Exception:  # noqa: BLE001 - defensiv beim Herunterfahren
            pass


def _build_menu() -> list:
    return [
        Menu(APP_NAME, [
            MenuAction(f"Über {APP_NAME}", _show_about),
            MenuSeparator(),
            MenuAction("Beenden", _quit),
        ]),
    ]


# --------------------------------------------------------------------------- #
# Start
# --------------------------------------------------------------------------- #

def main() -> None:
    _setup_logging()
    _startup_milestone("process_started", pid=os.getpid())
    _startup_milestone("configuration_loaded", data_dir=config.DATA_DIR)
    log.info("%s %s startet …", APP_NAME, APP_VERSION)

    state = _load_window_state()
    server = None
    port = None

    # Server früh starten; auf Bereitschaft wird erst gewartet, wenn der Splash
    # bereits sichtbar ist (kein leeres weißes Fenster).
    try:
        port = _free_port()
        server = FlaskServer(HOST, port)
        server.start()
        _startup_milestone("flask_thread_started", port=port)
    except Exception:  # noqa: BLE001 - jede Startstörung führt zur Fehlerseite
        log.exception("Flask-Server konnte nicht gestartet werden.")

    _startup_milestone("window_creation_requested", kind="splash")
    splash = webview.create_window(
        APP_NAME,
        html=_SPLASH_HTML,
        width=380,
        height=240,
        frameless=True,
        resizable=False,
        on_top=True,
        background_color=BACKGROUND,
    )
    _startup_milestone("window_created", kind="splash")

    revealed = threading.Event()

    def boot() -> None:
        """Läuft nach dem Öffnen des GUI-Loops: wartet auf den Server und
        blendet dann das Hauptfenster ein (oder die Fehlerseite)."""
        _startup_milestone("webview_event_loop_entered")
        try:
            ready = _wait_until_ready(HOST, port, STARTUP_TIMEOUT) if port else False
            if not ready:
                log.error("Server nicht erreichbar – Fehlerseite wird angezeigt.")
                error = webview.create_window(
                    APP_NAME, html=_ERROR_HTML,
                    width=DEFAULT_SIZE[0], height=DEFAULT_SIZE[1], min_size=MIN_SIZE,
                    background_color=BACKGROUND,
                )
                error.events.shown += _close_splash
                return

            _startup_milestone("server_reachable", port=port)
            _startup_milestone(
                "window_creation_requested", kind="main",
                x=state["x"], y=state["y"],
            )
            main_win = webview.create_window(
                APP_NAME,
                url=f"http://{HOST}:{port}/",
                width=state["width"], height=state["height"],
                x=state["x"], y=state["y"],
                min_size=MIN_SIZE,
                resizable=True,
                background_color=BACKGROUND,
                hidden=True,
            )
            _startup_milestone("window_created", kind="main")
            _track_window(main_win, state)

            def _reveal() -> None:
                if revealed.is_set():
                    return
                revealed.set()
                _close_splash()
                try:
                    main_win.show()
                    _startup_milestone(
                        "window_shown", x=main_win.x, y=main_win.y,
                        width=main_win.width, height=main_win.height,
                    )
                except Exception:  # noqa: BLE001 - callback needs a traceback
                    log.exception("STARTUP fatal_exception phase=window_show")
                # Startgeometrie sichern, damit Position auch ohne Verschieben gilt.
                threading.Timer(0.7, _capture_geometry, args=(main_win, state)).start()

            main_win.events.loaded += _reveal
            # Sicherheitsnetz, falls 'loaded' ausbleibt.
            threading.Timer(REVEAL_FALLBACK, _reveal).start()
        except Exception:  # noqa: BLE001 - callback exceptions are otherwise hidden
            log.exception("STARTUP fatal_exception phase=boot")
            _close_splash()
            raise

    def _close_splash() -> None:
        try:
            splash.destroy()
        except Exception:  # noqa: BLE001 - Splash evtl. schon zu
            pass

    _startup_milestone("webview_start_requested")
    try:
        webview.start(boot, menu=_build_menu())
    except Exception:  # noqa: BLE001 - windowed build has no stderr
        log.exception("STARTUP fatal_exception phase=webview_start")
        raise

    # Sauberes Herunterfahren: Server stoppen, Port freigeben, Thread beenden.
    if server is not None:
        log.info("Fenster geschlossen – Server wird gestoppt.")
        server.shutdown()
        server.join(timeout=5)
    log.info("%s beendet.", APP_NAME)


if __name__ == "__main__":
    main()
