"""QObject-Bridge zwischen Collector-Schicht und QML-UI.

Einzige Verantwortung:
- Collector-Daten periodisch im Hintergrund-Thread abrufen
- Ergebnisse in Viewmodels umwandeln
- Qt-Properties atomar auf dem Main-Thread aktualisieren

Regeln:
- Netzwerkzugriffe finden ausschließlich auf Worker-Threads statt.
- Qt-Objekte (Properties, Signals) werden nur auf dem Main-Thread berührt.
- Wenn ein Refresh-Zyklus noch läuft, wird der nächste Timer-Tick übersprungen.
- Keine zwei parallelen Refreshes möglich.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import threading
from typing import Optional

from PySide6.QtCore import (
    Property, QObject, QTimer, Signal, Slot, Qt,
)

import config
from ui import settings as ui_settings
from ui.settings import UISettings

log = logging.getLogger(__name__)

_STALE_MULTIPLIER = 3   # Wert gilt als veraltet nach 3× refresh_seconds


class EnergyBridge(QObject):
    """Zentraler Bridge zwischen Python-Backend und QML-Frontend."""

    # ---------------------------------------------------------------- #
    # Öffentliche Signale (QML abonniert)
    # ---------------------------------------------------------------- #
    nowDataChanged = Signal()
    todayDataChanged = Signal()
    devicesDataChanged = Signal()
    settingsDataChanged = Signal()

    # Ergebnis eines expliziten Verbindungstests
    # Argumente: device_id, result_json ({"ok": bool, "message": str})
    connectionTestResult = Signal(str, str)

    # ---------------------------------------------------------------- #
    # Interne Signale (Thread-safe Datenweitergabe → Main-Thread)
    # ---------------------------------------------------------------- #
    _nowReady = Signal(str)
    _todayReady = Signal(str)
    _devicesReady = Signal(str)

    # ---------------------------------------------------------------- #
    # Initialisierung
    # ---------------------------------------------------------------- #

    def __init__(self, parent: Optional[QObject] = None) -> None:
        super().__init__(parent)

        self._settings: UISettings = ui_settings.load()
        self._now_json: str = "{}"
        self._today_json: str = "{}"
        self._devices_json: str = "[]"
        self._settings_json: str = "{}"

        # Overlap-Schutz
        self._refresh_lock = threading.Lock()
        self._refresh_running = False

        # Interne Signale verbinden (immer auf Main-Thread ausgeliefert)
        self._nowReady.connect(self._apply_now, Qt.ConnectionType.QueuedConnection)
        self._todayReady.connect(self._apply_today, Qt.ConnectionType.QueuedConnection)
        self._devicesReady.connect(self._apply_devices, Qt.ConnectionType.QueuedConnection)

        # Initialen Settings-Snapshot sofort bereitstellen
        self._update_settings_snapshot()

        # Polling-Timer (Main-Thread)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._on_timer)
        self._timer.start(self._settings.refresh_seconds * 1000)

        # Ersten Refresh kurz nach Start anstoßen
        QTimer.singleShot(400, self._on_timer)

    # ---------------------------------------------------------------- #
    # Q_PROPERTY – nur auf Main-Thread schreiben
    # ---------------------------------------------------------------- #

    @Property(str, notify=nowDataChanged)
    def nowData(self) -> str:         # noqa: N802 (Qt naming)
        return self._now_json

    @Property(str, notify=todayDataChanged)
    def todayData(self) -> str:       # noqa: N802
        return self._today_json

    @Property(str, notify=devicesDataChanged)
    def devicesData(self) -> str:     # noqa: N802
        return self._devices_json

    @Property(str, notify=settingsDataChanged)
    def settingsData(self) -> str:    # noqa: N802
        return self._settings_json

    # ---------------------------------------------------------------- #
    # Timer / Refresh-Schleife
    # ---------------------------------------------------------------- #

    def _on_timer(self) -> None:
        """Auf dem Main-Thread durch QTimer aufgerufen."""
        with self._refresh_lock:
            if self._refresh_running:
                log.debug("Refresh übersprungen – vorheriger Zyklus läuft noch.")
                return
            self._refresh_running = True

        t = threading.Thread(
            target=self._do_refresh,
            name="energyradar-collector",
            daemon=True,
        )
        t.start()

    def _do_refresh(self) -> None:
        """Läuft auf dem Worker-Thread. Berührt keine Qt-Objekte direkt."""
        try:
            self._run_refresh()
        except Exception:
            log.exception("Unbehandelter Fehler im Refresh-Zyklus")
        finally:
            with self._refresh_lock:
                self._refresh_running = False

    def _run_refresh(self) -> None:
        """Eigentliche Refresh-Logik auf dem Worker-Thread."""
        from collectors import fronius as fronius_coll
        from collectors import mt175 as mt175_coll
        from services import data_source as ds
        from ui import viewmodels

        fronius_source = ds.effective()
        mt175_address = self._settings.mt175_address.strip()
        stale_s = self._settings.refresh_seconds * _STALE_MULTIPLIER

        fronius_reading = None
        mt175_reading = None
        fronius_error: Optional[str] = None
        mt175_error: Optional[str] = None

        # ── Fronius-Lesung ──────────────────────────────────────────
        if fronius_source is not None or config.DEMO:
            try:
                fronius_reading = (
                    fronius_coll.read_demo() if config.DEMO else fronius_coll.read()
                )
            except Exception as exc:
                fronius_error = str(exc)
                log.warning("Fronius-Collector Fehler: %s", exc)

        # ── MT175-Lesung (parallel) ──────────────────────────────────
        mt175_thread = None
        if mt175_address:
            def _read_mt175() -> None:
                nonlocal mt175_reading, mt175_error
                try:
                    mt175_reading = mt175_coll.read_url(mt175_address)
                except Exception as exc:
                    mt175_error = str(exc)
                    log.warning("MT175-Collector Fehler: %s", exc)

            mt175_thread = threading.Thread(
                target=_read_mt175, name="mt175-reader", daemon=True
            )
            mt175_thread.start()

        if mt175_thread is not None:
            mt175_thread.join(timeout=15)

        fronius_configured = fronius_source is not None or config.DEMO
        mt175_configured = bool(mt175_address)

        # ── Viewmodels bauen ─────────────────────────────────────────
        now_vm = viewmodels.build_now_vm(
            fronius=fronius_reading,
            mt175=mt175_reading,
            fronius_configured=fronius_configured,
            mt175_configured=mt175_configured,
            fronius_error=fronius_error,
            mt175_error=mt175_error,
            stale_threshold_s=stale_s,
        )

        today_vm = viewmodels.build_today_vm_with_mt175(
            fronius=fronius_reading,
            mt175=mt175_reading,
        )

        devices_vm = viewmodels.build_devices_vm(
            fronius=fronius_reading,
            mt175=mt175_reading,
            fronius_configured=fronius_configured,
            mt175_configured=mt175_configured,
            fronius_error=fronius_error,
            mt175_error=mt175_error,
        )

        # ── Ergebnisse über Signale auf den Main-Thread posten ───────
        self._nowReady.emit(json.dumps(dataclasses.asdict(now_vm), ensure_ascii=False))
        self._todayReady.emit(json.dumps(dataclasses.asdict(today_vm), ensure_ascii=False))
        self._devicesReady.emit(
            json.dumps([dataclasses.asdict(d) for d in devices_vm], ensure_ascii=False)
        )

    # ---------------------------------------------------------------- #
    # Slots (Main-Thread) für interne Signal-Lieferung
    # ---------------------------------------------------------------- #

    @Slot(str)
    def _apply_now(self, data_json: str) -> None:
        self._now_json = data_json
        self.nowDataChanged.emit()

    @Slot(str)
    def _apply_today(self, data_json: str) -> None:
        self._today_json = data_json
        self.todayDataChanged.emit()

    @Slot(str)
    def _apply_devices(self, data_json: str) -> None:
        self._devices_json = data_json
        self.devicesDataChanged.emit()

    # ---------------------------------------------------------------- #
    # Öffentliche Slots (aus QML aufgerufen)
    # ---------------------------------------------------------------- #

    @Slot(str, str)
    def testConnection(self, device_id: str, address: str) -> None:
        """Verbindungstest für ein Gerät (nicht-blockierend aus QML)."""
        def _test() -> None:
            ok, msg = _run_connection_test(device_id, address.strip())
            result = json.dumps({"ok": ok, "message": msg}, ensure_ascii=False)
            self.connectionTestResult.emit(device_id, result)

        threading.Thread(target=_test, name=f"test-{device_id}", daemon=True).start()

    @Slot(str)
    def saveFroniusAddress(self, address: str) -> None:
        """Fronius-Adresse über bestehenden data_source-Service speichern."""
        from services import data_source as ds
        address = address.strip()
        try:
            normalized = ds.normalize_address(address)
            ds.save(normalized)
            self._update_settings_snapshot()
            # Sofort neu laden
            QTimer.singleShot(0, self._on_timer)
        except ds.UnsafeTargetError:
            log.warning("Fronius: unsichere Adresse abgelehnt: %s", address)
        except Exception as exc:
            log.warning("Fronius-Adresse konnte nicht gespeichert werden: %s", exc)

    @Slot(str)
    def saveSettings(self, settings_json: str) -> None:
        """UI-Einstellungen aus QML entgegennehmen und persistieren."""
        try:
            data = json.loads(settings_json)
            self._settings.refresh_seconds = max(3, min(60, int(data.get("refresh_seconds", 5))))
            self._settings.theme = data.get("theme", "dark")
            mt175_addr = str(data.get("mt175_address", "")).strip()
            self._settings.mt175_address = mt175_addr
            ui_settings.save(self._settings)
            # Timer-Intervall anpassen
            self._timer.setInterval(self._settings.refresh_seconds * 1000)
            self._update_settings_snapshot()
            # Sofortigen Refresh anstoßen
            QTimer.singleShot(100, self._on_timer)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            log.warning("Einstellungen konnten nicht gespeichert werden: %s", exc)

    # ---------------------------------------------------------------- #
    # Interne Hilfsmethoden (Main-Thread)
    # ---------------------------------------------------------------- #

    def _update_settings_snapshot(self) -> None:
        """Settings-JSON für QML aktualisieren."""
        from services import data_source as ds
        from ui import viewmodels

        src = ds.effective()
        fronius_addr = ""
        fronius_editable = True
        if src is not None:
            if src.get("source") == "saved":
                fronius_addr = ds.display_address(src["url"])
                fronius_editable = True
            elif src.get("source") == "environment":
                fronius_addr = ds.display_address(src["url"])
                fronius_editable = False

        vm = viewmodels.build_settings_vm(
            fronius_address=fronius_addr,
            fronius_editable=fronius_editable,
            mt175_address=self._settings.mt175_address,
            refresh_seconds=self._settings.refresh_seconds,
            timezone_str=config.MT175_TIMEZONE,
            theme=self._settings.theme,
        )
        self._settings_json = json.dumps(
            dataclasses.asdict(vm), ensure_ascii=False
        )
        self.settingsDataChanged.emit()

    def shutdown(self) -> None:
        """Sauberes Herunterfahren: Timer stoppen, laufenden Thread abwarten."""
        self._timer.stop()
        log.info("EnergyBridge heruntergefahren.")


# ------------------------------------------------------------------ #
# Verbindungstest-Helfer (läuft auf Worker-Thread)
# ------------------------------------------------------------------ #

def _run_connection_test(device_id: str, address: str) -> tuple[bool, str]:
    from ui.strings_de import S
    try:
        if device_id == "fronius":
            from collectors import fronius as fc
            from services import data_source as ds
            normalized = ds.normalize_address(address)
            fc.read_url(normalized, require_local=True)
            return True, S.settings_test_ok

        if device_id == "mt175":
            from collectors import mt175 as mc
            mc.read_url(address)
            return True, S.settings_test_ok

    except Exception as exc:
        from services import data_source as ds
        if isinstance(exc, ds.UnsafeTargetError):
            return False, S.settings_invalid_address
        return False, S.settings_test_failed

    return False, S.settings_test_failed
