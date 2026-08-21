"""Backend-owned recording runtime: poll once, persist and project many."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
from decimal import Decimal
import logging
import sqlite3
import threading
from typing import Callable
from uuid import uuid4

from energyradar import config
from energyradar.collectors import fronius as fronius_collector
from energyradar.collectors import mt175 as meter_collector
from energyradar.models.energy import EnergyReading, QualityStatus
from energyradar.models.mt175 import MT175Reading
from energyradar.services import data_source, storage
from energyradar.services.forecast import SolarForecastEngine
from energyradar.services.projection import CurrentStateProjection, SourceSnapshot
from energyradar.services.recorder import AnchorCapture, CounterRecorder, SourceCapture, stable_source_uuid
from energyradar.services.scheduler import BackendScheduler
from energyradar.services.weather.service import WeatherService
from energyradar.ui import settings as ui_settings

log = logging.getLogger(__name__)

LIVE_DEFAULT_SECONDS = 5.0
ANCHOR_SECONDS = 60.0
WEATHER_SECONDS = 15 * 60.0
FORECAST_SECONDS = 30 * 60.0
ARCHIVE_SECONDS = 10 * 60.0
CAPTURE_TIMEOUT_SECONDS = 6.0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None, fallback: datetime) -> datetime:
    if value is None:
        return fallback
    if value.tzinfo is None:
        # Legacy Fronius readings had no source offset. Do not invent one;
        # received-at is the first trustworthy UTC timestamp.
        return fallback
    return value.astimezone(timezone.utc)


class EnergyRuntime:
    def __init__(
        self,
        *,
        scheduler: BackendScheduler | None = None,
        recorder: CounterRecorder | None = None,
        projection: CurrentStateProjection | None = None,
        now: Callable[[], datetime] = _utc_now,
        monotonic: Callable[[], float] | None = None,
        fronius_read: Callable[[], EnergyReading] | None = None,
        meter_read: Callable[[str], MT175Reading] | None = None,
    ) -> None:
        import time
        self.now = now
        self.monotonic = monotonic or time.monotonic
        self.scheduler = scheduler or BackendScheduler()
        self.recorder = recorder or CounterRecorder(now=now)
        self.projection = projection or CurrentStateProjection()
        self.fronius_read = fronius_read or fronius_collector.read
        self.meter_read = meter_read or meter_collector.read_url
        self._capture_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="energyradar-source")
        self._poll_lock = threading.Lock()
        self._weather_lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._started = False
        self._last_anchor_mono: float | None = None
        self._last_poll_mono: float | None = None
        self._last_poll_wall: datetime | None = None
        self._outage_started: dict[str, datetime] = {}
        self._source_futures: dict[str, object] = {}
        self._instance_token = uuid4().hex

    def start(self) -> bool:
        with self._start_lock:
            if self._started:
                return False
            self.recorder.start_run(mode="demo" if config.DEMO else "live")
            self.projection.set_recording(active=True, started_at=self.recorder.started_at)
            self._rebuild_projection()
            cadence = float(ui_settings.resolve_effective().get("refresh_seconds") or LIVE_DEFAULT_SECONDS)
            self.scheduler.add_task("energy", cadence, self.poll_once, immediate=True, max_backoff=60.0)
            self.scheduler.add_task("weather", WEATHER_SECONDS, self.refresh_weather, immediate=True, max_backoff=WEATHER_SECONDS * 4)
            # The first weather completion triggers forecast. This prevents two
            # concurrent provider requests during process startup.
            self.scheduler.add_task("forecast", FORECAST_SECONDS, self.refresh_forecast, immediate=False, max_backoff=FORECAST_SECONDS * 4)
            # Fronius local-archive catch-up: startup + bounded current-day
            # refresh, on its own cadence so it never blocks live polling.
            if not config.DEMO:
                self.scheduler.add_task("archive", ARCHIVE_SECONDS, self.refresh_archive, immediate=True, max_backoff=ARCHIVE_SECONDS * 4)
            self._started = True
            self.scheduler.start()
            return True

    def _rebuild_projection(self) -> None:
        if not config.DB_PATH.exists():
            return
        try:
            con = sqlite3.connect(config.DB_PATH)
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM energy_samples_v1 ORDER BY measured_at DESC LIMIT 1").fetchone()
            con.close()
            if row is None:
                return
            received = datetime.fromisoformat(str(row["received_at"]).replace("Z", "+00:00"))
            if received.tzinfo is None:
                received = received.replace(tzinfo=timezone.utc)
            if row["pv_power_w"] is not None:
                reading = EnergyReading(received, float(row["pv_power_w"]), row["pv_energy_today_wh"], None, None)
                self.projection.rebuild_stale(fronius=SourceSnapshot(True, reading, received, received, "stale"))
            if row["grid_power_w"] is not None or row["grid_import_total_wh"] is not None or row["grid_export_total_wh"] is not None:
                meter = MT175Reading(None, received, (row["grid_import_total_wh"] / 1000 if row["grid_import_total_wh"] is not None else None), (row["grid_export_total_wh"] / 1000 if row["grid_export_total_wh"] is not None else None), row["grid_power_w"], None, None, None, None)
                self.projection.rebuild_stale(smart_meter=SourceSnapshot(True, meter, received, received, "stale"))
        except (sqlite3.Error, OSError, ValueError, TypeError):
            log.warning("Could not rebuild stale current projection", exc_info=True)

    def refresh_archive(self) -> None:
        """Ingest missing Fronius local-archive history (startup + current day).

        Read-only against the device, idempotent, and provenance-separated. Any
        failure is swallowed so archive ingestion never disturbs live recording.
        """
        if config.DEMO:
            return
        source = data_source.effective()
        if not source or not source.get("url"):
            return
        from urllib.parse import urlsplit
        from energyradar.services import archive_ingest
        parts = urlsplit(source["url"])
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return
        base = f"{parts.scheme}://{parts.netloc}"
        try:
            archive_ingest.catch_up(base)
        except Exception:
            log.warning("Fronius archive catch-up failed", exc_info=True)

    def _configured(self) -> tuple[dict | None, str]:
        source = data_source.effective()
        effective = ui_settings.resolve_effective()
        return source, str(effective.get("mt175_address") or "").strip()

    def poll_once(self, *, force_anchor: bool = False) -> None:
        if not self._poll_lock.acquire(blocking=False):
            return
        requested = self.now()
        mono = self.monotonic()
        try:
            timing_state = self._detect_timing(requested, mono)
            fronius_source, meter_address = self._configured()
            futures = {}
            if fronius_source is not None or config.DEMO:
                previous = self._source_futures.get("fronius")
                if previous is None or previous.done():
                    futures["fronius"] = self._capture_pool.submit(fronius_collector.read_demo if config.DEMO else self.fronius_read)
                    self._source_futures["fronius"] = futures["fronius"]
            if meter_address or config.DEMO:
                previous = self._source_futures.get("smart_meter")
                if previous is None or previous.done():
                    futures["smart_meter"] = self._capture_pool.submit(meter_collector.read_demo if config.DEMO else self.meter_read, *(() if config.DEMO else (meter_address,)))
                    self._source_futures["smart_meter"] = futures["smart_meter"]

            results: dict[str, object] = {}
            errors: dict[str, str] = {}
            deadline = self.monotonic() + CAPTURE_TIMEOUT_SECONDS
            for name, future in futures.items():
                try:
                    results[name] = future.result(timeout=max(0.01, deadline - self.monotonic()))
                    self._source_futures.pop(name, None)
                except FutureTimeout:
                    future.cancel()
                    errors[name] = "timeout"
                except Exception as exc:
                    self._source_futures.pop(name, None)
                    errors[name] = type(exc).__name__
                    log.warning("%s collection failed: %s", name, exc)

            completed = self.now()
            captures = self._project_results(
                fronius_source=fronius_source,
                meter_address=meter_address,
                results=results,
                errors=errors,
                received_at=completed,
            )
            anchor_due = self._last_anchor_mono is None or mono - self._last_anchor_mono >= ANCHOR_SECONDS
            if not config.DEMO and (force_anchor or anchor_due) and captures:
                key = f"{self.recorder.run_id}:{int(mono * 1000)}"
                self.recorder.record_anchor(AnchorCapture("startup" if self._last_anchor_mono is None else "scheduled", requested, completed, tuple(captures), key, timing_state))
                pv = results.get("fronius") if isinstance(results.get("fronius"), EnergyReading) else None
                meter = results.get("smart_meter") if isinstance(results.get("smart_meter"), MT175Reading) else None
                storage.save_sample(
                    measured_at=completed, received_at=completed, pv=pv, mt175=meter,
                    pv_quality=QualityStatus.VALID if pv else QualityStatus.OFFLINE,
                    grid_quality=QualityStatus.VALID if meter else QualityStatus.OFFLINE,
                    sample_quality=QualityStatus.VALID if pv and meter else QualityStatus.PARTIAL,
                )
                self._last_anchor_mono = mono
                self.projection.anchor_recorded(completed)
            self._last_poll_mono, self._last_poll_wall = mono, requested
        finally:
            self._poll_lock.release()

    def _detect_timing(self, wall: datetime, mono: float) -> str:
        if self._last_poll_mono is None or self._last_poll_wall is None:
            return "normal"
        mono_elapsed = mono - self._last_poll_mono
        wall_elapsed = (wall - self._last_poll_wall).total_seconds()
        if wall_elapsed < -1:
            return "wall_clock_reversed"
        if wall_elapsed - mono_elapsed > max(30.0, LIVE_DEFAULT_SECONDS * 3):
            self.recorder.record_gap(scope="host", source_uuid=None, from_utc=self._last_poll_wall, to_utc=wall, reason="host_suspended", details={"monotonic_elapsed_seconds": mono_elapsed, "wall_elapsed_seconds": wall_elapsed})
            self.projection.gap_ended(wall)
            return "host_resumed"
        return "normal"

    def _project_results(self, *, fronius_source: dict | None, meter_address: str, results: dict[str, object], errors: dict[str, str], received_at: datetime) -> list[SourceCapture]:
        captures: list[SourceCapture] = []
        specs = (
            ("fronius", fronius_source is not None or config.DEMO, fronius_source["url"] if fronius_source else "demo-fronius"),
            ("smart_meter", bool(meter_address) or config.DEMO, meter_address or "demo-meter"),
        )
        for name, configured, identity in specs:
            reading = results.get(name)
            source_uuid = stable_source_uuid("fronius" if name == "fronius" else "tasmota", identity)
            if reading is None:
                prior = getattr(self.projection.snapshot(), name)
                health = "provider_unavailable" if configured else "not_configured"
                self.projection.update_source(name, SourceSnapshot(configured, prior.reading, prior.observed_at, prior.received_at, health, errors.get(name), source_uuid))
                if configured and not config.DEMO:
                    self._outage_started.setdefault(name, received_at)
                    captures.append(SourceCapture(source_uuid, "fronius" if name == "fronius" else "tasmota", name, None, received_at, "failed", error_code=errors.get(name) or "provider_unavailable"))
                continue
            observed = _aware(reading.timestamp if name == "fronius" else reading.timestamp, received_at)
            self.projection.update_source(name, SourceSnapshot(configured, reading, observed, received_at, "fresh", None, source_uuid))
            outage = self._outage_started.pop(name, None)
            if outage is not None and not config.DEMO:
                self.recorder.record_gap(scope="source", source_uuid=source_uuid, from_utc=outage, to_utc=received_at, reason="provider_unavailable")
                self.projection.gap_ended(received_at)
            if config.DEMO:
                continue
            if name == "fronius":
                counters = {
                    "pv_total": (
                        Decimal(str(reading.energy_total)) / Decimal("1000")
                        if reading.energy_total is not None else None
                    )
                }
                counter_identity = "fronius:E_Total"
                capabilities = ("current_power", "pv_total")
            else:
                counters = {"grid_import_total": reading.grid_import_total_kwh, "grid_export_total": reading.grid_export_total_kwh}
                counter_identity = f"{reading.meter_type}:{reading.meter_id or source_uuid}"
                capabilities = ("current_power", "grid_import_total", "grid_export_total")
            available = [value for value in counters.values() if value is not None]
            captures.append(SourceCapture(
                source_uuid,
                "fronius" if name == "fronius" else "tasmota",
                "Fronius inverter" if name == "fronius" else "Tasmota smart meter",
                observed,
                received_at,
                "success" if len(available) == len(counters) else "partial",
                counters,
                counter_identity,
                capabilities=capabilities,
                measurements={"pv_power_w": reading.power} if name == "fronius" else {"grid_power_w": reading.current_power_w},
            ))
        return captures

    def refresh_weather(self) -> None:
        with self._weather_lock:
            report = WeatherService().get_weather_report(force_fresh=True)
            self.projection.update_weather(report)
        self.scheduler.trigger("forecast")

    def refresh_forecast(self) -> None:
        weather_report = self.projection.snapshot().weather_report
        if weather_report is None:
            return
        report = SolarForecastEngine().generate_forecast(
            now_dt=self.now(), weather_report=weather_report
        )
        self.projection.update_forecast(report)

    def request_poll(self) -> None:
        self.scheduler.trigger("energy")

    def probe_source(self, kind: str, address: str | None = None) -> object:
        """Probe a setup target through the single collector owner.

        The poll lock prevents a user-requested probe from racing a scheduled
        cycle. Probe results never enter history or counter-anchor tables.
        """
        with self._poll_lock:
            if kind == "fronius":
                if address is None:
                    return self.fronius_read()
                return fronius_collector.read_url(address, require_local=True)
            if kind == "smart_meter" and address:
                return self.meter_read(address)
            raise ValueError(f"unsupported source probe: {kind}")

    def stop(self) -> None:
        with self._start_lock:
            if not self._started:
                return
            self.scheduler.stop()
            self._capture_pool.shutdown(wait=True, cancel_futures=True)
            self.recorder.finish_run()
            self.projection.set_recording(active=False)
            self._started = False

    @property
    def started(self) -> bool:
        return self._started


_RUNTIME: EnergyRuntime | None = None
_RUNTIME_LOCK = threading.Lock()


def get_runtime() -> EnergyRuntime:
    global _RUNTIME
    with _RUNTIME_LOCK:
        if _RUNTIME is None:
            _RUNTIME = EnergyRuntime()
        return _RUNTIME


def start_runtime() -> EnergyRuntime:
    runtime = get_runtime()
    runtime.start()
    return runtime


def stop_runtime() -> None:
    runtime = get_runtime()
    runtime.stop()


def _reset_runtime_for_tests() -> None:
    global _RUNTIME
    with _RUNTIME_LOCK:
        if _RUNTIME is not None and _RUNTIME.started:
            _RUNTIME.stop()
        _RUNTIME = None
