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

from energyradar import config
from energyradar.ui import settings as ui_settings
from energyradar.ui.settings import UISettings

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
    # Argumente: device_id, operation_id, result_json
    connectionTestStarted = Signal(str, str)
    connectionTestResult = Signal(str, str, str)

    # Export Signale
    exportStarted = Signal(str)      # operation_id
    exportCompleted = Signal(str)    # payload json: operation_id, path, size
    exportFailed = Signal(str, str)  # operation_id, error_message
    mailHandoffPrepared = Signal(str)# operation_id

    # ---------------------------------------------------------------- #
    # Settings & System Signale (Sprint 5A & 5B)
    # ---------------------------------------------------------------- #
    settingsSaveSucceeded = Signal(str)            # result json
    settingsSaveFailed = Signal(str)               # error json
    directorySelected = Signal(str)                # selected path
    weatherConfigurationResult = Signal(str)       # result json
    systemActionResult = Signal(str)               # result json
    weatherLocationSearchStarted = Signal(str)     # operation_id
    weatherCandidatesResult = Signal(str, str)     # operation_id, candidates_json
    weatherLocationConfirmed = Signal(str)         # resolved_location_json
    weatherConnectionTestStarted = Signal(str)   # operation_id
    weatherConnectionTestResult = Signal(str, str) # operation_id, result_json
    weatherReportChanged = Signal(str)             # weather_report_json

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

        # Overlap-Schutz & Test-State
        self._refresh_lock = threading.Lock()
        self._refresh_running = False
        self._test_lock = threading.Lock()
        self._testing_devices: set[str] = set()
        self._test_results: dict[str, dict] = {}

        # Interne Signale verbinden (immer auf Main-Thread ausgeliefert)
        self._nowReady.connect(self._apply_now, Qt.ConnectionType.QueuedConnection)
        self._todayReady.connect(self._apply_today, Qt.ConnectionType.QueuedConnection)
        self._devicesReady.connect(self._apply_devices, Qt.ConnectionType.QueuedConnection)

        # Initialen Settings-Snapshot sofort bereitstellen
        self._update_settings_snapshot()

        # Polling-Timer (Main-Thread)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._on_timer)
        effective_settings = ui_settings.resolve_effective()
        self._timer.start(int(effective_settings["refresh_seconds"]) * 1000)

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
        from energyradar.collectors import fronius as fronius_coll
        from energyradar.collectors import mt175 as mt175_coll
        from energyradar.services import data_source as ds
        from energyradar.services import storage
        from energyradar.models.energy import QualityStatus
        from energyradar.ui import viewmodels
        from datetime import datetime, timezone

        fronius_source = ds.effective()
        effective_settings = ui_settings.resolve_effective()
        mt175_address = str(effective_settings["mt175_address"] or "").strip()
        stale_s = int(effective_settings["refresh_seconds"]) * _STALE_MULTIPLIER

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
        if mt175_address or config.DEMO:
            def _read_mt175() -> None:
                nonlocal mt175_reading, mt175_error
                try:
                    mt175_reading = (
                        mt175_coll.read_demo() if config.DEMO else mt175_coll.read_url(mt175_address)
                    )
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

        # ── Messwert in SQLite persistieren ──────────────────────────
        measured_at = datetime.now(timezone.utc)

        pv_q = QualityStatus.VALID if fronius_reading else (QualityStatus.OFFLINE if fronius_configured else QualityStatus.UNKNOWN)
        grid_q = QualityStatus.VALID if mt175_reading else (QualityStatus.OFFLINE if mt175_configured else QualityStatus.UNKNOWN)
        if mt175_reading and getattr(mt175_reading, "error", "") == "PIN required":
            grid_q = QualityStatus.LOCKED
        elif mt175_error:
            grid_q = QualityStatus.INVALID

        sample_q = QualityStatus.VALID
        if not fronius_reading or not mt175_reading:
            sample_q = QualityStatus.PARTIAL

        if fronius_configured or mt175_configured:
            # Nur speichern, wenn mindestens eine Quelle konfiguriert ist
            storage.save_sample(
                measured_at=measured_at,
                received_at=measured_at,
                pv=fronius_reading,
                mt175=mt175_reading,
                pv_quality=pv_q,
                grid_quality=grid_q,
                sample_quality=sample_q
            )

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
            mt175_address=mt175_address,
            test_results=self._test_results,
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

    @Slot(str)
    def testConnection(self, device_id: str) -> None:
        """Verbindungstest für ein Gerät ausführen (nutzt gespeicherte Konfiguration)."""
        target_id = "fronius_primary" if "fronius" in device_id else ("mt175_primary" if "mt175" in device_id else device_id)

        with self._test_lock:
            if target_id in self._testing_devices:
                log.info("Test für %s läuft bereits.", target_id)
                return
            self._testing_devices.add(target_id)

        import uuid
        operation_id = str(uuid.uuid4())[:8]
        self.connectionTestStarted.emit(target_id, operation_id)

        def _do_test() -> None:
            import time
            from datetime import datetime, timezone
            from energyradar.services import data_source as ds

            start_time = time.time()
            try:
                if target_id == "fronius_primary":
                    src = ds.effective()
                    if not src:
                        res = {"ok": False, "status": "unconfigured", "latency_ms": 0, "message": "Fronius ist nicht konfiguriert", "capabilities": []}
                    else:
                        from energyradar.collectors import fronius as fc
                        fc.read_url(src["url"], require_local=True)
                        latency = int((time.time() - start_time) * 1000)
                        res = {"ok": True, "status": "connected", "latency_ms": latency, "message": "Gerät antwortet", "capabilities": ["current_power", "daily_energy"]}
                elif target_id == "mt175_primary":
                    raw_s = ui_settings.load_raw_dict()
                    addr = str(raw_s.get("mt175_address") or self._settings.mt175_address or "").strip()
                    if not addr:
                        res = {"ok": False, "status": "unconfigured", "latency_ms": 0, "message": "MT175 ist nicht konfiguriert", "capabilities": []}
                    else:
                        from energyradar.collectors import mt175 as mc
                        reading = mc.read_url(addr)
                        latency = int((time.time() - start_time) * 1000)
                        if reading.current_power_w is None:
                            res = {"ok": True, "status": "partial", "latency_ms": latency, "message": "Gerät antwortet. PIN-Freigabe erforderlich.", "capabilities": ["grid_import_total", "grid_export_total"]}
                        else:
                            res = {"ok": True, "status": "connected", "latency_ms": latency, "message": "Gerät antwortet vollständig", "capabilities": ["grid_import_total", "grid_export_total", "current_power"]}
                else:
                    res = {"ok": False, "status": "error", "latency_ms": 0, "message": f"Unbekanntes Gerät: {target_id}", "capabilities": []}
            except Exception as exc:
                latency = int((time.time() - start_time) * 1000)
                res = {"ok": False, "status": "error", "latency_ms": latency, "message": f"Verbindung fehlgeschlagen: {str(exc)[:80]}", "capabilities": []}
            finally:
                with self._test_lock:
                    self._testing_devices.discard(target_id)

            res["tested_at"] = datetime.now(timezone.utc).isoformat()
            if res["ok"]:
                self._test_results[target_id] = res

            res_json = json.dumps(res, ensure_ascii=False)
            QTimer.singleShot(0, lambda t_id=target_id, o_id=operation_id, r_json=res_json: self.connectionTestResult.emit(t_id, o_id, r_json))

        threading.Thread(target=_do_test, name=f"test-{target_id}", daemon=True).start()

    @Slot(str)
    def saveFroniusAddress(self, address: str) -> None:
        """Fronius-Adresse über bestehenden data_source-Service speichern."""
        from energyradar.services import data_source as ds
        address = address.strip()
        try:
            normalized = ds.normalize_address(address)
            ds.save(normalized)
            ui_settings.save_patch({"fronius_address": normalized})
            self._update_settings_snapshot()
            # Sofort neu laden
            QTimer.singleShot(0, self._on_timer)
        except ds.UnsafeTargetError:
            log.warning("Fronius: unsichere Adresse abgelehnt: %s", address)
        except Exception as exc:
            log.warning("Fronius-Adresse konnte nicht gespeichert werden: %s", exc)

    @Slot(str)
    def updateSettings(self, patch_json: str) -> None:
        """UI-Einstellungen atomar via Patch-Semantik aktualisieren."""
        from energyradar.services import data_source as ds
        try:
            patch = json.loads(patch_json)
            if not isinstance(patch, dict):
                raise ValueError("Patch muss ein JSON-Objekt sein.")
            updated_raw = ui_settings.save_patch(patch)
            self._settings = ui_settings.load()

            # Sync fronius_address mit data_source if present
            if "fronius_address" in patch:
                addr = str(patch["fronius_address"]).strip() if patch["fronius_address"] else ""
                if addr:
                    try:
                        ds.save(addr)
                    except Exception as exc:
                        log.warning("Fronius-Adresse konnte nicht in data_source gespeichert werden: %s", exc)
                else:
                    ds.remove_saved()

            # Timer-Intervall anpassen, falls refresh_seconds im Patch
            effective = ui_settings.resolve_effective(updated_raw)
            ref_s = effective.get("refresh_seconds", 5)
            self._timer.setInterval(ref_s * 1000)

            self._update_settings_snapshot()
            self.settingsSaveSucceeded.emit(json.dumps({"ok": True}, ensure_ascii=False))
            # Sofortigen Refresh anstoßen
            QTimer.singleShot(100, self._on_timer)
        except Exception as exc:
            log.warning("Einstellungen konnten nicht aktualisiert werden: %s", exc)
            self.settingsSaveFailed.emit(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))

    @Slot(str)
    def saveSettings(self, settings_json: str) -> None:
        """Abwärtskompatible Wrapper-Methode für saveSettings."""
        self.updateSettings(settings_json)

    @Slot()
    def chooseExportDirectory(self) -> None:
        """Öffnet den nativen Qt Ordnerauswahl-Dialog."""
        from PySide6.QtWidgets import QFileDialog, QApplication
        active_window = QApplication.activeWindow()
        curr_eff = ui_settings.resolve_effective()
        default_dir = curr_eff.get("export_directory") or str(Path.home() / "Documents")
        path = QFileDialog.getExistingDirectory(active_window, "Exportordner wählen", default_dir)
        if path:
            ui_settings.save_patch({"export_directory": path})
            self._update_settings_snapshot()
            self.directorySelected.emit(path)

    @Slot()
    def openExportDirectory(self) -> None:
        """Öffnet den eingestellten Exportordner im OS-Dateimanager."""
        import subprocess, sys
        from pathlib import Path
        curr_eff = ui_settings.resolve_effective()
        exp_dir = curr_eff.get("export_directory") or str(Path.home() / "Documents")
        try:
            p = Path(exp_dir)
            p.mkdir(parents=True, exist_ok=True)
            if sys.platform == "win32":
                os.startfile(str(p))
            elif sys.platform == "darwin":
                subprocess.run(["open", str(p)])
            else:
                subprocess.run(["xdg-open", str(p)])
            self.systemActionResult.emit(json.dumps({"ok": True, "action": "openExportDirectory"}, ensure_ascii=False))
        except Exception as exc:
            log.exception("Konnte Exportordner nicht öffnen")
            self.systemActionResult.emit(json.dumps({"ok": False, "action": "openExportDirectory", "error": str(exc)}, ensure_ascii=False))

    @Slot(str, str)
    def searchWeatherLocations(self, operation_id: str, query: str) -> None:
        """Sucht Standortkandidaten zu einer Texteingabe im Hintergrund."""
        from energyradar.services.weather.service import WeatherService
        self.weatherLocationSearchStarted.emit(operation_id)

        def _do_search():
            try:
                ws = WeatherService()
                candidates = ws.search_locations(query)
                res = [dataclasses.asdict(c) for c in candidates]
                res_json = json.dumps({"ok": True, "candidates": res}, ensure_ascii=False)
                QTimer.singleShot(0, lambda o_id=operation_id, r_json=res_json: self.weatherCandidatesResult.emit(o_id, r_json))
            except Exception as exc:
                log.warning("Standortsuche fehlgeschlagen: %s", exc)
                res_json = json.dumps({"ok": False, "error": str(exc), "candidates": []}, ensure_ascii=False)
                QTimer.singleShot(0, lambda o_id=operation_id, r_json=res_json: self.weatherCandidatesResult.emit(o_id, r_json))

        threading.Thread(target=_do_search, name=f"search-loc-{operation_id}", daemon=True).start()

    @Slot(str)
    def confirmWeatherLocation(self, candidate_json: str) -> None:
        """Speichert den vom Nutzer explizit ausgewählten Standort."""
        from energyradar.services.weather import cache
        from energyradar.services.weather.service import WeatherService
        from datetime import datetime, timezone

        try:
            cand = json.loads(candidate_json)
            if not isinstance(cand, dict):
                raise ValueError("Kandidat muss ein JSON-Objekt sein.")

            resolved = {
                "provider_id": str(cand.get("provider_id", "")),
                "display_name": str(cand.get("display_name", "")),
                "latitude": float(cand["latitude"]),
                "longitude": float(cand["longitude"]),
                "timezone": str(cand.get("timezone", "Europe/Berlin")),
                "country_code": cand.get("country_code"),
                "provider": str(cand.get("provider", "open_meteo")),
                "original_query": str(cand.get("name", "")),
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }

            patch = {
                "location_query": cand.get("name") or resolved["display_name"],
                "latitude": resolved["latitude"],
                "longitude": resolved["longitude"],
                "resolved_location": resolved,
                "weather_enabled": True,
            }

            updated_raw = ui_settings.save_patch(patch)
            cache.clear_cache()
            self._update_settings_snapshot()

            self.weatherLocationConfirmed.emit(json.dumps(resolved, ensure_ascii=False))

            # Sende frischen Wetterbericht asynchron auf Hintergrundthread
            def _async_report():
                try:
                    ws = WeatherService()
                    report = ws.get_weather_report(force_fresh=False)
                    rep_json = json.dumps(report.to_dict(), ensure_ascii=False)
                    QTimer.singleShot(0, lambda r_json=rep_json: self.weatherReportChanged.emit(r_json))
                except Exception as e:
                    log.warning("Hintergrund-Wetterabruf fehlgeschlagen: %s", e)

            threading.Thread(target=_async_report, daemon=True).start()
        except Exception as exc:
            log.warning("Standortbestätigung fehlgeschlagen: %s", exc)

    @Slot()
    def removeResolvedLocation(self) -> None:
        """Entfernt den gespeicherten Standort und deaktiviert Wetterdaten."""
        from energyradar.services.weather import cache
        patch = {
            "location_query": None,
            "latitude": None,
            "longitude": None,
            "resolved_location": None,
            "weather_enabled": False,
        }
        ui_settings.save_patch(patch)
        cache.clear_cache()
        self._update_settings_snapshot()
        self.weatherReportChanged.emit(json.dumps({"status": "disabled"}, ensure_ascii=False))

    @Slot(str)
    def testWeatherConnection(self, operation_id: str) -> None:
        """Führt einen erzwungenen Live-Verbindungstest durch (ohne Cache). Mutiert KEINE Settings!"""
        import time
        from energyradar.services.weather.service import WeatherService
        self.weatherConnectionTestStarted.emit(operation_id)

        def _do_test():
            start_time = time.time()
            try:
                ws = WeatherService()
                report = ws.get_weather_report(force_fresh=True)
                latency = int((time.time() - start_time) * 1000)

                is_ok = (report.status == "available" and report.provider_status == "reachable")
                res = {
                    "ok": is_ok,
                    "status": report.status,
                    "provider_status": report.provider_status,
                    "latency_ms": latency,
                    "provider": "open_meteo",
                    "attribution": "Weather data powered by Open-Meteo (CC BY 4.0)",
                    "tested_at": datetime.now(timezone.utc).isoformat(),
                    "report": report.to_dict(),
                    "message": "Wetterdienst erreichbar." if is_ok else "Wetterdienst nicht erreichbar oder unvollständig."
                }
            except Exception as exc:
                latency = int((time.time() - start_time) * 1000)
                res = {
                    "ok": False,
                    "status": "error",
                    "provider_status": "unreachable",
                    "latency_ms": latency,
                    "provider": "open_meteo",
                    "tested_at": datetime.now(timezone.utc).isoformat(),
                    "message": f"Verbindungstest fehlgeschlagen: {str(exc)[:100]}"
                }

            res_json = json.dumps(res, ensure_ascii=False)
            QTimer.singleShot(0, lambda o_id=operation_id, r_json=res_json: self.weatherConnectionTestResult.emit(o_id, r_json))

        threading.Thread(target=_do_test, name=f"test-wconn-{operation_id}", daemon=True).start()

    @Slot()
    def validateWeatherConfiguration(self) -> None:
        """Prüft die Standortkonfiguration für Wetter (Sprint 5A & 5B)."""
        from energyradar.services.weather.service import WeatherService
        ws = WeatherService()
        report = ws.get_weather_report(force_fresh=False)

        if report.status == "disabled":
            res = {"ok": True, "status": "disabled", "message": "Wetterdaten sind aktuell deaktiviert."}
        elif report.status == "missing_location":
            res = {"ok": False, "status": "missing_location", "message": "Bitte wähle zuerst einen bestätigten Standort aus."}
        else:
            loc_name = report.location.display_name if report.location else "Koordinaten"
            res = {"ok": True, "status": "valid", "message": f"Standortkonfiguration ist gültig ({loc_name})."}

        self.weatherConfigurationResult.emit(json.dumps(res, ensure_ascii=False))

    @Slot()
    def openDiagnosticLog(self) -> None:
        """Öffnet das Diagnoseprotokoll energyradar.log im Standard-Texteditor."""
        import subprocess, sys
        from energyradar import config
        log_path = config.DATA_DIR / "energyradar.log"
        try:
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            if not log_path.exists():
                log_path.write_text("=== EnergyRadar Log Start ===\n", encoding="utf-8")
            if sys.platform == "win32":
                os.startfile(str(log_path))
            elif sys.platform == "darwin":
                subprocess.run(["open", str(log_path)])
            else:
                subprocess.run(["xdg-open", str(log_path)])
            self.systemActionResult.emit(json.dumps({"ok": True, "action": "openDiagnosticLog"}, ensure_ascii=False))
        except Exception as exc:
            log.exception("Konnte Log-Datei nicht öffnen")
            self.systemActionResult.emit(json.dumps({"ok": False, "action": "openDiagnosticLog", "error": str(exc)}, ensure_ascii=False))

    @Slot()
    def openLogDirectory(self) -> None:
        """Öffnet den Anwendungsdaten-Ordner im OS-Dateimanager."""
        import subprocess, sys
        from energyradar import config
        try:
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            if sys.platform == "win32":
                os.startfile(str(config.DATA_DIR))
            elif sys.platform == "darwin":
                subprocess.run(["open", str(config.DATA_DIR)])
            else:
                subprocess.run(["xdg-open", str(config.DATA_DIR)])
            self.systemActionResult.emit(json.dumps({"ok": True, "action": "openLogDirectory"}, ensure_ascii=False))
        except Exception as exc:
            log.exception("Konnte Log-Ordner nicht öffnen")
            self.systemActionResult.emit(json.dumps({"ok": False, "action": "openLogDirectory", "error": str(exc)}, ensure_ascii=False))

    @Slot(str, str, str, str, str)
    def requestExport(self, operation_id: str, export_kind: str, range_type: str, start_date_str: str, end_date_str: str) -> None:
        """Fordert einen Export an. Löst QFileDialog auf dem Main-Thread aus, generiert im Hintergrund."""
        from PySide6.QtWidgets import QFileDialog, QApplication
        from datetime import datetime, timezone
        from energyradar.services import reporting

        # Determine file extension and filter
        ext = ".pdf"
        file_filter = "PDF Dokument (*.pdf)"
        if export_kind == "csv":
            ext = ".csv"
            file_filter = "CSV Datei (*.csv)"
        elif export_kind == "json":
            ext = ".json"
            file_filter = "JSON Datei (*.json)"
        elif export_kind == "zip":
            ext = ".zip"
            file_filter = "ZIP Archiv (*.zip)"

        # Format explicit, friendly default filenames
        now_date_str = datetime.now().strftime("%Y-%m-%d")
        if export_kind == "zip":
            now_time_str = datetime.now().strftime("%Y-%m-%d-%H%M")
            default_name = f"EnergyRadar-Backup-{now_time_str}.zip"
        else:
            kind_map = {
                "today": "Tagesbericht",
                "yesterday": "Tagesbericht",
                "7days": "Wochenbericht",
                "30days": "Monatsbericht",
                "month": "Monatsbericht",
                "year": "Jahresbericht"
            }
            report_label = kind_map.get(range_type, "Bericht")
            default_name = f"EnergyRadar-{report_label}-{now_date_str}{ext}"

        # Zeige nativen Dialog
        active_window = QApplication.activeWindow()
        path, _ = QFileDialog.getSaveFileName(active_window, "Bericht speichern", default_name, file_filter)

        if not path:
            # User aborted
            return

        self.exportStarted.emit(operation_id)

        # Hintergrund-Thread für die Erzeugung
        def _do_export():
            try:
                import os
                if export_kind == "zip":
                    reporting.create_backup_zip(path)
                else:
                    start_dt = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
                    end_dt = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
                    if export_kind == "pdf":
                        reporting.export_pdf(start_dt, end_dt, range_type, path)
                    elif export_kind == "csv":
                        reporting.export_csv(start_dt, end_dt, range_type, path)
                    elif export_kind == "json":
                        reporting.export_json(start_dt, end_dt, range_type, path)

                size = os.path.getsize(path)
                result = {
                    "operation_id": operation_id,
                    "format": export_kind,
                    "path": path,
                    "filename": os.path.basename(path),
                    "size_bytes": size,
                    "generated_at": datetime.now(timezone.utc).isoformat()
                }
                self.exportCompleted.emit(json.dumps(result, ensure_ascii=False))
            except Exception as exc:
                log.exception("Export fehlgeschlagen")
                self.exportFailed.emit(operation_id, str(exc))

        threading.Thread(target=_do_export, name=f"export-{operation_id}", daemon=True).start()

    @Slot(str, str, str, str)
    def requestMailShare(self, operation_id: str, range_type: str, start_date_str: str, end_date_str: str) -> None:
        """Generiert PDF im Export-Ordner (temp, aber pers.) und startet Mail-Handoff."""
        from datetime import datetime
        from energyradar.services import reporting, mail_handoff
        import os
        from pathlib import Path

        self.exportStarted.emit(operation_id)

        def _do_mail():
            try:
                # Nutze Home-Verzeichnis für temporäre persistente Exporte
                export_dir = Path.home() / "Documents" / "EnergyRadar_Exports"
                export_dir.mkdir(parents=True, exist_ok=True)

                path = str(export_dir / f"EnergyRadar-Bericht-{range_type}.pdf")

                start_dt = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))

                reporting.export_pdf(start_dt, end_dt, range_type, path)

                subject = f"EnergyRadar Bericht: {range_type}"
                body = "Anbei der EnergyRadar Bericht als PDF.\n\n"

                mail_handoff.prepare_email_handoff(subject, body, path)
                self.mailHandoffPrepared.emit(operation_id)
            except Exception as exc:
                log.exception("Mail Handoff fehlgeschlagen")
                self.exportFailed.emit(operation_id, str(exc))

        threading.Thread(target=_do_mail, name=f"mail-{operation_id}", daemon=True).start()

    # ---------------------------------------------------------------- #
    # Interne Hilfsmethoden (Main-Thread)
    # ---------------------------------------------------------------- #

    def _update_settings_snapshot(self) -> None:
        """Settings-JSON für React aktualisieren."""
        from energyradar.ui import viewmodels

        vm = viewmodels.build_settings_vm()
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
    from energyradar.ui.strings_de import S
    try:
        if device_id == "fronius":
            from energyradar.collectors import fronius as fc
            from energyradar.services import data_source as ds
            normalized = ds.normalize_address(address)
            fc.read_url(normalized, require_local=True)
            return True, S.settings_test_ok

        if device_id == "mt175":
            from energyradar.collectors import mt175 as mc
            mc.read_url(address)
            return True, S.settings_test_ok

    except Exception as exc:
        from energyradar.services import data_source as ds
        if isinstance(exc, ds.UnsafeTargetError):
            return False, S.settings_invalid_address
        return False, S.settings_test_failed

    return False, S.settings_test_failed
