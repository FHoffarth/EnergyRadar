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
from concurrent.futures import ThreadPoolExecutor
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Optional

from PySide6.QtCore import (
    Property, QObject, QTimer, Signal, Slot, Qt,
)

from energyradar import config
from energyradar.ui import settings as ui_settings
from energyradar.ui.settings import UISettings

log = logging.getLogger(__name__)


def _open_path(path: Path) -> None:
    """Open an existing file or directory with the platform default app."""
    if sys.platform == "win32":
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.run(["open", str(path)], check=True)
    else:
        subprocess.run(["xdg-open", str(path)], check=True)

_STALE_MULTIPLIER = 3   # Wert gilt als veraltet nach 3× refresh_seconds


def _smart_meter_connection_result(reading, latency_ms: int) -> dict:
    """Build a connection-test result from measurements actually available."""
    from energyradar.ui.viewmodels import describe_smart_meter_availability

    availability = describe_smart_meter_availability(reading)
    connection_status = {
        "complete": "connected",
        "partial": "partial",
        "unavailable": "unavailable",
    }[availability.data_status]
    return {
        "ok": True,
        "status": connection_status,
        "data_status": availability.data_status,
        "latency_ms": latency_ms,
        "message": availability.message,
        "capabilities": availability.capabilities,
    }


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
    tariffOperationSucceeded = Signal(str)         # result json
    tariffOperationFailed = Signal(str)            # error json
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
    _connectionTestReady = Signal(str, str, str)
    _weatherCandidatesReady = Signal(str, str)
    _weatherReportReady = Signal(str)
    _weatherConnectionTestReady = Signal(str, str)

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
        self._refresh_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="energyradar-ui")

        # Interne Signale verbinden (immer auf Main-Thread ausgeliefert)
        self._nowReady.connect(self._apply_now, Qt.ConnectionType.QueuedConnection)
        self._todayReady.connect(self._apply_today, Qt.ConnectionType.QueuedConnection)
        self._devicesReady.connect(self._apply_devices, Qt.ConnectionType.QueuedConnection)
        self._connectionTestReady.connect(self._relay_connection_test, Qt.ConnectionType.QueuedConnection)
        self._weatherCandidatesReady.connect(self._relay_weather_candidates, Qt.ConnectionType.QueuedConnection)
        self._weatherReportReady.connect(self._relay_weather_report, Qt.ConnectionType.QueuedConnection)
        self._weatherConnectionTestReady.connect(self._relay_weather_connection_test, Qt.ConnectionType.QueuedConnection)

        # Initialen Settings-Snapshot sofort bereitstellen
        self._update_settings_snapshot()

        # Polling-Timer (Main-Thread)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._on_timer)
        effective_settings = ui_settings.resolve_effective()
        self._timer.start(int(effective_settings["refresh_seconds"]) * 1000)

        # Beim nächsten Event-Loop-Tick sofort abrufen. Der Live-Zustand darf
        # nicht erst ein vollständiges Timer-Intervall nach dem Start erscheinen.
        QTimer.singleShot(0, self._on_timer)

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

        self._refresh_executor.submit(self._do_refresh)

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
        from datetime import datetime
        import zoneinfo
        from energyradar import config
        from energyradar.services import periods
        from energyradar.services.runtime import get_runtime
        from energyradar.ui import viewmodels

        runtime_snapshot = get_runtime().projection.snapshot()
        pv_state = runtime_snapshot.fronius
        meter_state = runtime_snapshot.smart_meter
        effective_settings = ui_settings.resolve_effective()
        stale_s = int(effective_settings["refresh_seconds"]) * _STALE_MULTIPLIER
        tz = zoneinfo.ZoneInfo(config.MT175_TIMEZONE)
        now = datetime.now(tz)
        period_report = periods.calculate_period(
            now.replace(hour=0, minute=0, second=0, microsecond=0), now
        )
        forecast = runtime_snapshot.forecast_report
        forecast_dict = forecast.to_dict() if forecast is not None else None

        now_vm = viewmodels.build_now_vm(
            fronius=pv_state.reading,
            mt175=meter_state.reading,
            fronius_configured=pv_state.configured,
            mt175_configured=meter_state.configured,
            fronius_error=pv_state.error_code,
            mt175_error=meter_state.error_code,
            stale_threshold_s=stale_s,
            solar_forecast=forecast_dict,
            observed_at_utc=max(
                (value for value in (pv_state.observed_at, meter_state.observed_at) if value is not None),
                default=None,
            ).isoformat() if pv_state.observed_at or meter_state.observed_at else None,
            received_at_utc=max(
                (value for value in (pv_state.received_at, meter_state.received_at) if value is not None),
                default=None,
            ).isoformat() if pv_state.received_at or meter_state.received_at else None,
            source_states={"fronius": pv_state.health, "smart_meter": meter_state.health},
        )
        today_vm = viewmodels.build_today_vm_from_anchors(
            fronius=pv_state.reading,
            mt175=meter_state.reading,
            period_report=period_report,
            solar_forecast=forecast_dict,
            has_source=pv_state.configured or meter_state.configured,
        )
        devices_vm = viewmodels.build_devices_vm(
            fronius=pv_state.reading,
            mt175=meter_state.reading,
            fronius_configured=pv_state.configured,
            mt175_configured=meter_state.configured,
            fronius_error=pv_state.error_code,
            mt175_error=meter_state.error_code,
            mt175_address=str(effective_settings["mt175_address"] or "").strip(),
            test_results=self._test_results,
        )
        self._nowReady.emit(json.dumps(dataclasses.asdict(now_vm), ensure_ascii=False))
        self._todayReady.emit(json.dumps(dataclasses.asdict(today_vm), ensure_ascii=False))
        self._devicesReady.emit(json.dumps([dataclasses.asdict(item) for item in devices_vm], ensure_ascii=False))

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

    @Slot(str, str, str)
    def _relay_connection_test(self, device_id: str, operation_id: str, result_json: str) -> None:
        self.connectionTestResult.emit(device_id, operation_id, result_json)

    @Slot(str, str)
    def _relay_weather_candidates(self, operation_id: str, result_json: str) -> None:
        self.weatherCandidatesResult.emit(operation_id, result_json)

    @Slot(str)
    def _relay_weather_report(self, report_json: str) -> None:
        self.weatherReportChanged.emit(report_json)

    @Slot(str, str)
    def _relay_weather_connection_test(self, operation_id: str, result_json: str) -> None:
        self.weatherConnectionTestResult.emit(operation_id, result_json)

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
            from energyradar.collectors import mt175 as mt175_coll
            from energyradar.services import data_source as ds
            from energyradar.services.runtime import get_runtime

            start_time = time.time()
            try:
                if target_id == "fronius_primary":
                    src = ds.effective()
                    if not src:
                        res = {"ok": False, "status": "unconfigured", "latency_ms": 0, "message": "Fronius ist nicht konfiguriert", "capabilities": []}
                    else:
                        get_runtime().probe_source("fronius", src["url"])
                        latency = int((time.time() - start_time) * 1000)
                        res = {"ok": True, "status": "connected", "latency_ms": latency, "message": "Gerät antwortet", "capabilities": ["current_power", "daily_energy"]}
                elif target_id == "mt175_primary":
                    raw_s = ui_settings.load_raw_dict()
                    addr = str(raw_s.get("mt175_address") or self._settings.mt175_address or "").strip()
                    if not addr:
                        res = {"ok": False, "status": "unconfigured", "latency_ms": 0, "message": "Smart Meter ist nicht konfiguriert", "capabilities": []}
                    else:
                        reading = get_runtime().probe_source("smart_meter", addr)
                        latency = int((time.time() - start_time) * 1000)
                        res = _smart_meter_connection_result(reading, latency)
                else:
                    res = {"ok": False, "status": "error", "latency_ms": 0, "message": f"Unbekanntes Gerät: {target_id}", "capabilities": []}
            except mt175_coll.MT175AddressError as exc:
                res = {"ok": False, "status": "error", "latency_ms": 0, "message": f"Adresse ungültig: {str(exc)[:80]}", "capabilities": []}
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
            self._connectionTestReady.emit(target_id, operation_id, res_json)

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
            validated_patch = ui_settings.validate_patch(patch)

            # Fronius has a dedicated data-source store. Persist it before the
            # UI settings file so a failed device-address write cannot change
            # the general settings. Keep its previous state for rollback if
            # the later atomic UI-settings write fails.
            previous_source = None
            source_changed = False
            if "fronius_address" in validated_patch:
                previous_source = ds.load_saved()
                addr = validated_patch["fronius_address"] or ""
                if addr:
                    ds.save(addr)
                else:
                    ds.remove_saved()
                source_changed = True

            try:
                updated_raw = ui_settings.save_patch(validated_patch)
            except Exception as settings_exc:
                if source_changed:
                    try:
                        if previous_source:
                            ds.save(previous_source["url"])
                        else:
                            ds.remove_saved()
                    except Exception as rollback_exc:
                        raise RuntimeError(
                            f"Settings konnten nicht gespeichert und die Fronius-Konfiguration "
                            f"nicht wiederhergestellt werden: {rollback_exc}"
                        ) from settings_exc
                raise
            self._settings = ui_settings.load()

            # Timer-Intervall anpassen, falls refresh_seconds im Patch
            effective = ui_settings.resolve_effective(updated_raw)
            ref_s = effective.get("refresh_seconds", 5)
            self._timer.setInterval(ref_s * 1000)

            self._update_settings_snapshot()
            self.settingsSaveSucceeded.emit(json.dumps({"ok": True}, ensure_ascii=False))
            # Sofortigen Refresh anstoßen
            QTimer.singleShot(100, self._on_timer)
        except Exception:
            log.exception("Einstellungen konnten nicht aktualisiert werden")
            self.settingsSaveFailed.emit(json.dumps({
                "ok": False,
                "message": "Einstellungen konnten nicht gespeichert werden.",
            }, ensure_ascii=False))

    @Slot(str)
    def saveSettings(self, settings_json: str) -> None:
        """Abwärtskompatible Wrapper-Methode für saveSettings."""
        self.updateSettings(settings_json)

    @Slot(str)
    def saveTariff(self, tariff_json: str) -> None:  # noqa: N802
        """Create or update one validated tariff period."""
        from energyradar.services import tariffs
        try:
            payload = json.loads(tariff_json)
            if not isinstance(payload, dict):
                raise ValueError("Tarif muss ein JSON-Objekt sein.")
            record_id = payload.pop("id", None)
            record = (
                tariffs.update_record(int(record_id), payload)
                if record_id is not None
                else tariffs.create_record(payload)
            )
            self._update_settings_snapshot()
            self.tariffOperationSucceeded.emit(json.dumps({"ok": True, "record": record}, ensure_ascii=False))
            QTimer.singleShot(0, self._on_timer)
        except Exception as exc:
            log.warning("Tarif konnte nicht gespeichert werden: %s", exc)
            self.tariffOperationFailed.emit(json.dumps({
                "ok": False,
                "message": str(exc),
            }, ensure_ascii=False))

    @Slot(int)
    def deleteTariff(self, record_id: int) -> None:  # noqa: N802
        """Delete the explicitly selected tariff period."""
        from energyradar.services import tariffs
        try:
            if not tariffs.delete_record(record_id):
                raise ValueError("Tarif wurde nicht gefunden.")
            self._update_settings_snapshot()
            self.tariffOperationSucceeded.emit(json.dumps({"ok": True, "deleted_id": record_id}, ensure_ascii=False))
            QTimer.singleShot(0, self._on_timer)
        except Exception as exc:
            log.warning("Tarif konnte nicht gelöscht werden: %s", exc)
            self.tariffOperationFailed.emit(json.dumps({"ok": False, "message": str(exc)}, ensure_ascii=False))

    @Slot()
    def chooseExportDirectory(self) -> None:
        """Open the native folder picker without persisting its selection."""
        from PySide6.QtWidgets import QFileDialog, QApplication
        try:
            active_window = QApplication.activeWindow()
            curr_eff = ui_settings.resolve_effective()
            default_dir = curr_eff.get("export_directory") or str(Path.home() / "Documents")
            path = QFileDialog.getExistingDirectory(active_window, "Exportordner wählen", default_dir)
            if not path:
                self.systemActionResult.emit(json.dumps({
                    "ok": True,
                    "status": "cancelled",
                    "action": "chooseExportDirectory",
                    "message": "Ordnerauswahl abgebrochen.",
                }, ensure_ascii=False))
                return

            self.directorySelected.emit(path)
            self.systemActionResult.emit(json.dumps({
                "ok": True,
                "status": "success",
                "action": "chooseExportDirectory",
                "message": "Exportordner ausgewählt. Noch nicht gespeichert.",
                "path": path,
            }, ensure_ascii=False))
        except Exception:
            log.exception("Exportordner konnte nicht ausgewählt werden")
            self.systemActionResult.emit(json.dumps({
                "ok": False,
                "status": "error",
                "action": "chooseExportDirectory",
                "message": "Der Exportordner konnte nicht ausgewählt werden.",
            }, ensure_ascii=False))

    @Slot()
    def openExportDirectory(self) -> None:
        """Öffnet den eingestellten Exportordner im OS-Dateimanager."""
        curr_eff = ui_settings.resolve_effective()
        exp_dir = curr_eff.get("export_directory") or str(Path.home() / "Documents")
        try:
            p = Path(exp_dir)
            p.mkdir(parents=True, exist_ok=True)
            _open_path(p)
            self.systemActionResult.emit(json.dumps({
                "ok": True,
                "status": "success",
                "action": "openExportDirectory",
                "message": "Exportordner geöffnet.",
                "path": str(p),
            }, ensure_ascii=False))
        except Exception:
            log.exception("Konnte Exportordner nicht öffnen")
            self.systemActionResult.emit(json.dumps({
                "ok": False,
                "status": "error",
                "action": "openExportDirectory",
                "message": "Der Exportordner konnte nicht geöffnet werden.",
            }, ensure_ascii=False))

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
                res_json = json.dumps(
                    {
                        "ok": True,
                        "operation_id": operation_id,
                        "candidates": res,
                    },
                    ensure_ascii=False,
                )
                self._weatherCandidatesReady.emit(operation_id, res_json)
            except Exception as exc:
                log.warning("Standortsuche fehlgeschlagen: %s", exc)
                res_json = json.dumps(
                    {
                        "ok": False,
                        "operation_id": operation_id,
                        "error": str(exc),
                        "candidates": [],
                    },
                    ensure_ascii=False,
                )
                self._weatherCandidatesReady.emit(operation_id, res_json)

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
                    from energyradar.services.runtime import get_runtime
                    runtime = get_runtime()
                    runtime.refresh_weather()
                    report = runtime.projection.snapshot().weather_report
                    rep_json = json.dumps(report.to_dict(), ensure_ascii=False)
                    self._weatherReportReady.emit(rep_json)
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

    @Slot()
    def requestWeatherReport(self) -> None:
        """Lädt den aktuellen Wetterbericht nach erfolgreicher Bridge-Verbindung."""
        from energyradar.services.weather.service import WeatherService

        def _do_request() -> None:
            try:
                from energyradar.services.runtime import get_runtime
                report = get_runtime().projection.snapshot().weather_report
                payload = report.to_dict() if report is not None else {
                    "status": "no_data_yet", "provider_status": "unknown",
                    "served_from_cache": False, "observed_at": None,
                    "fetched_at": None, "quality": None, "warnings": [],
                }
            except Exception:
                log.exception("Wetterbericht konnte nicht geladen werden")
                payload = {
                    "status": "error",
                    "provider_status": "unreachable",
                    "served_from_cache": False,
                    "observed_at": None,
                    "fetched_at": None,
                    "location": None,
                    "sun": None,
                    "current": None,
                    "quality": None,
                    "warnings": [
                        {
                            "code": "weather_request_failed",
                            "message": "Wetterdaten konnten nicht geladen werden.",
                        }
                    ],
                }
            self._weatherReportReady.emit(json.dumps(payload, ensure_ascii=False))

        threading.Thread(
            target=_do_request,
            name="weather-report-request",
            daemon=True,
        ).start()

    @Slot(str)
    def testWeatherConnection(self, operation_id: str) -> None:
        """Führt einen erzwungenen Live-Verbindungstest durch (ohne Cache). Mutiert KEINE Settings!"""
        import time
        from datetime import datetime, timezone
        from energyradar.services.weather.service import WeatherService
        self.weatherConnectionTestStarted.emit(operation_id)

        def _do_test():
            start_time = time.time()
            try:
                from energyradar.services.runtime import get_runtime
                runtime = get_runtime()
                runtime.refresh_weather()
                report = runtime.projection.snapshot().weather_report
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

            res["operation_id"] = operation_id
            res_json = json.dumps(res, ensure_ascii=False)
            self._weatherConnectionTestReady.emit(operation_id, res_json)

        threading.Thread(target=_do_test, name=f"test-wconn-{operation_id}", daemon=True).start()

    @Slot()
    def validateWeatherConfiguration(self) -> None:
        """Prüft die Standortkonfiguration für Wetter (Sprint 5A & 5B)."""
        from energyradar.services.runtime import get_runtime
        report = get_runtime().projection.snapshot().weather_report
        if report is None:
            self.weatherConfigurationResult.emit(json.dumps({
                "ok": False, "status": "no_data_yet",
                "message": "Wetterdaten wurden noch nicht aktualisiert.",
            }, ensure_ascii=False))
            return

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
        log_path = config.DATA_DIR / "energyradar.log"
        try:
            if not log_path.exists():
                self.systemActionResult.emit(json.dumps({
                    "ok": False,
                    "status": "error",
                    "action": "openDiagnosticLog",
                    "message": "Das Systemprotokoll ist derzeit nicht verfügbar.",
                }, ensure_ascii=False))
                return
            _open_path(log_path)
            self.systemActionResult.emit(json.dumps({
                "ok": True,
                "status": "success",
                "action": "openDiagnosticLog",
                "message": "Systemprotokoll geöffnet.",
                "path": str(log_path),
            }, ensure_ascii=False))
        except Exception:
            log.exception("Konnte Log-Datei nicht öffnen")
            self.systemActionResult.emit(json.dumps({
                "ok": False,
                "status": "error",
                "action": "openDiagnosticLog",
                "message": "Das Systemprotokoll ist derzeit nicht verfügbar.",
            }, ensure_ascii=False))

    @Slot()
    def openLogDirectory(self) -> None:
        """Öffnet den Anwendungsdaten-Ordner im OS-Dateimanager."""
        try:
            if not config.DATA_DIR.exists():
                self.systemActionResult.emit(json.dumps({
                    "ok": False,
                    "status": "error",
                    "action": "openLogDirectory",
                    "message": "Der Protokollordner ist derzeit nicht verfügbar.",
                }, ensure_ascii=False))
                return
            _open_path(config.DATA_DIR)
            self.systemActionResult.emit(json.dumps({
                "ok": True,
                "status": "success",
                "action": "openLogDirectory",
                "message": "Protokollordner geöffnet.",
                "path": str(config.DATA_DIR),
            }, ensure_ascii=False))
        except Exception:
            log.exception("Konnte Log-Ordner nicht öffnen")
            self.systemActionResult.emit(json.dumps({
                "ok": False,
                "status": "error",
                "action": "openLogDirectory",
                "message": "Der Protokollordner konnte nicht geöffnet werden.",
            }, ensure_ascii=False))

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
        self._refresh_executor.shutdown(wait=True, cancel_futures=True)
        log.info("EnergyBridge heruntergefahren.")


# ------------------------------------------------------------------ #
# Verbindungstest-Helfer (läuft auf Worker-Thread)
# ------------------------------------------------------------------ #

def _run_connection_test(device_id: str, address: str) -> tuple[bool, str]:
    from energyradar.ui.strings_de import S
    from energyradar.services.runtime import get_runtime
    try:
        if device_id == "fronius":
            from energyradar.services import data_source as ds
            normalized = ds.normalize_address(address)
            get_runtime().probe_source("fronius", normalized)
            return True, S.settings_test_ok

        if device_id == "mt175":
            get_runtime().probe_source("smart_meter", address)
            return True, S.settings_test_ok

    except Exception as exc:
        from energyradar.collectors import mt175 as mc
        from energyradar.services import data_source as ds
        if isinstance(exc, (ds.UnsafeTargetError, mc.MT175AddressError)):
            return False, S.settings_invalid_address
        return False, S.settings_test_failed

    return False, S.settings_test_failed
