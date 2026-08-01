"""Präsentations-Viewmodels für EnergyRadar.

Einzige Verantwortung: Collector-Rohdaten in darstellungsfertige,
typisierte Datenstrukturen übersetzen.

Regeln:
- Kein Netzwerk-Code, kein Qt-Code.
- Unbekannte Werte werden niemals als Null dargestellt.
- Stale-Erkennung: Wert älter als stale_threshold_s → Qualität "stale".
- Alle Felder sind serialisierbar mit dataclasses.asdict().
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

log = logging.getLogger(__name__)

# Importiert on-demand, um zirkuläre Imports zu vermeiden
# (models werden auch ohne Qt benötigt → kein PySide6 hier)


# ------------------------------------------------------------------ #
# Viewmodel-Definitionen
# ------------------------------------------------------------------ #

@dataclass
class NowViewModel:
    # Verdikt-Satz (natürlichsprachlich)
    verdict: str
    # "importing" | "exporting" | "balanced" | "unavailable"
    # | "pin_locked" | "error" | "no_source" | "connecting"
    verdict_kind: str

    # PV-Leistung (Watt), None = nicht verfügbar
    pv_power_w: Optional[float]
    pv_label: str           # formatiert, z. B. "1,20 kW"
    pv_available: bool

    # Netzleistung (Watt, positiv = Bezug, negativ = Einspeisung)
    grid_power_w: Optional[float]
    grid_label: str
    grid_available: bool

    # Verbrauch = PV + Netzbezug (nur wenn beide bekannt)
    consumption_w: Optional[float]
    consumption_label: str
    consumption_available: bool

    # Datenqualität
    data_quality: str       # "live" | "stale" | "unavailable" | "error" | "no_source"
    freshness_label: str    # z. B. "Aktuell · 18:59"

    # MT175-spezifisch
    pin_locked: bool        # True wenn Zähler nicht entsperrt

    # Solar-Prognose (Sprint 5D)
    solar_forecast: Optional[dict] = None


@dataclass
class TodayViewModel:
    generated_kwh: Optional[float]
    generated_label: str
    consumption_kwh: Optional[float]
    consumption_label: str
    import_total_kwh: Optional[float]
    import_total_label: str
    export_total_kwh: Optional[float]
    export_total_label: str
    self_consumption_pct: Optional[int]
    autarky_pct: Optional[int]
    coverage: dict
    period: dict
    history: List[dict]
    has_data: bool
    has_source: bool

    # Solar-Prognose (Sprint 5E)
    solar_forecast: Optional[dict] = None


@dataclass
class DeviceCardViewModel:
    device_id: str               # "fronius_primary" | "mt175_primary"
    device_type: str             # "inverter" | "smart_meter"
    display_name: str            # "Fronius Wechselrichter" | smart-meter label
    connection_status: str       # "connected" | "stale" | "offline" | "error" | "unconfigured" | "testing"
    data_status: str             # "complete" | "partial" | "unavailable" | "error" | "unconfigured"
    configuration_status: str    # "configured" | "unconfigured"
    address_display: str         # "192.168.1.40"
    protocol: str                # "Fronius Solar API v1" | "Tasmota SML / HTTP"
    firmware: Optional[str]      # None or "1.24.5"
    last_seen_at: Optional[str]  # ISO string or None
    last_measurement_at: Optional[str] # ISO string or None
    last_successful_test_at: Optional[str] # ISO string or None
    last_error_at: Optional[str] # ISO string or None
    capabilities: List[str]      # ["current_power", "daily_energy"]
    data_quality_label: str      # "Vollständig", "Teilweise verfügbar", "Kein Signal"
    pin_status: str              # "locked" | "unlocked" | "not_applicable"
    pin_instructions: Optional[str] # None or instruction string
    user_message: str            # Friendly message for the user
    technical_error: Optional[str] # Technical error message or None


@dataclass
class SettingsViewModel:
    settings: dict              # Rohe gespeicherte Nutzerentscheidungen (mit null)
    effective_settings: dict    # Effektive Laufzeitwerte inkl. Defaults
    system: dict                # Schreibgeschützte Laufzeit-Systeminfos
    fronius_address: str        # Für Abwärtskompatibilität
    fronius_editable: bool
    mt175_address: str
    refresh_seconds: int
    timezone: str
    theme: str              # "dark" | "light" | "system"


@dataclass(frozen=True)
class SmartMeterAvailability:
    """User-facing availability derived from actual smart-meter values."""

    data_status: str
    capabilities: List[str]
    message: str
    pin_locked: bool


# ------------------------------------------------------------------ #
# Hilfsfunktionen
# ------------------------------------------------------------------ #

def _fmt_power(watts: Optional[float]) -> str:
    from energyradar.ui.strings_de import S
    return S.fmt_power(watts)


def _fmt_energy(kwh: Optional[float]) -> str:
    from energyradar.ui.strings_de import S
    return S.fmt_energy(kwh)


def _age_s(dt: Optional[datetime]) -> Optional[float]:
    """Alter eines Zeitstempels in Sekunden (None → None)."""
    if dt is None:
        return None
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (now - dt.astimezone(timezone.utc)).total_seconds())


def _time_str(dt: Optional[datetime]) -> str:
    if dt is None:
        return "–"
    local = dt.astimezone()   # Systemzone
    return local.strftime("%H:%M")


def describe_smart_meter_availability(reading) -> SmartMeterAvailability:
    """Describe only measurements the smart meter actually supplied.

    Explicit ``None`` checks are intentional: zero watts and zero cumulative
    energy are valid measurements and therefore real capabilities.
    """
    has_import = reading.grid_import_total_kwh is not None
    has_export = reading.grid_export_total_kwh is not None
    has_power = reading.current_power_w is not None

    capabilities = []
    if has_import:
        capabilities.append("grid_import_total")
    if has_export:
        capabilities.append("grid_export_total")
    if has_power:
        capabilities.append("current_power")

    available_count = sum((has_import, has_export, has_power))
    data_status = (
        "complete"
        if available_count == 3
        else "partial"
        if available_count > 0
        else "unavailable"
    )

    explicit_pin_state = getattr(reading, "pin_locked", None)
    pin_locked = (
        reading.current_power_w is None
        if explicit_pin_state is None
        else explicit_pin_state
    )
    power_unavailable = (
        "Für die aktuelle Netzleistung ist die PIN-Freigabe erforderlich."
        if pin_locked
        else "Die aktuelle Netzleistung ist nicht verfügbar."
    )

    if available_count == 3:
        message = "Der Smart Meter liefert Zählerstände und aktuelle Netzleistung."
    elif has_power and not has_import and not has_export:
        message = (
            "Der Smart Meter liefert aktuelle Netzleistung. "
            "Zählerstände sind nicht verfügbar."
        )
    elif has_power and has_import and not has_export:
        message = (
            "Der Smart Meter liefert aktuelle Netzleistung und den "
            "Bezugszählerstand. Der Einspeisezählerstand ist nicht verfügbar."
        )
    elif has_power and has_export and not has_import:
        message = (
            "Der Smart Meter liefert aktuelle Netzleistung und den "
            "Einspeisezählerstand. Der Bezugszählerstand ist nicht verfügbar."
        )
    elif has_import and has_export:
        message = f"Der Smart Meter liefert Zählerstände. {power_unavailable}"
    elif has_import:
        message = (
            "Der Smart Meter liefert den Bezugszählerstand. "
            f"Der Einspeisezählerstand ist nicht verfügbar. {power_unavailable}"
        )
    elif has_export:
        message = (
            "Der Smart Meter liefert den Einspeisezählerstand. "
            f"Der Bezugszählerstand ist nicht verfügbar. {power_unavailable}"
        )
    elif pin_locked:
        message = (
            "Der Smart Meter liefert noch keine gültigen Messwerte. "
            "Für die aktuelle Netzleistung ist die PIN-Freigabe erforderlich."
        )
    else:
        message = "Der Smart Meter liefert derzeit keine gültigen Messwerte."

    return SmartMeterAvailability(
        data_status=data_status,
        capabilities=capabilities,
        message=message,
        pin_locked=pin_locked,
    )


# ------------------------------------------------------------------ #
# Builder-Funktionen
# ------------------------------------------------------------------ #

def build_now_vm(
    *,
    fronius,            # EnergyReading | None
    mt175,              # MT175Reading | None
    fronius_configured: bool,
    mt175_configured: bool,
    fronius_error: Optional[str],
    mt175_error: Optional[str],
    stale_threshold_s: float,
) -> NowViewModel:
    from energyradar.ui.strings_de import S

    # --- PV-Leistung ---
    pv_power_w: Optional[float] = None
    fronius_age: Optional[float] = None
    if fronius is not None:
        fronius_age = _age_s(fronius.timestamp)
        if fronius_age is not None and fronius_age < stale_threshold_s:
            pv_power_w = fronius.power

    # --- Netzleistung ---
    grid_power_w: Optional[float] = None
    pin_locked = False
    mt175_age: Optional[float] = None
    if mt175 is not None:
        explicit_pin_state = getattr(mt175, "pin_locked", None)
        # Compatibility for readings instantiated before explicit PIN metadata.
        pin_locked = (
            mt175.current_power_w is None
            if explicit_pin_state is None
            else explicit_pin_state
        )
        mt175_age = _age_s(mt175.received_at)
        if not pin_locked and mt175_age is not None and mt175_age < stale_threshold_s:
            grid_power_w = mt175.current_power_w

    # --- Verbrauch ---
    consumption_w: Optional[float] = None
    sources_aligned = False
    if (
        pv_power_w is not None
        and grid_power_w is not None
        and fronius.timestamp is not None
        and mt175.received_at is not None
    ):
        source_skew_s = abs(
            (
                fronius.timestamp.astimezone(timezone.utc)
                - mt175.received_at.astimezone(timezone.utc)
            ).total_seconds()
        )
        sources_aligned = source_skew_s < stale_threshold_s

    if sources_aligned:
        candidate_consumption = pv_power_w + grid_power_w
        # Collection skew and meter rounding can produce tiny negative values.
        # Up to 50 W is treated as a balanced boundary; larger contradictions
        # remain unavailable because they cannot represent house consumption.
        if candidate_consumption >= 0:
            consumption_w = candidate_consumption
        elif candidate_consumption >= -50.0:
            consumption_w = 0.0

    # --- Datenqualität ---
    no_source = not fronius_configured and not mt175_configured
    if no_source:
        data_quality = "no_source"
    elif fronius_error and mt175_error:
        data_quality = "error"
    elif fronius_error and not mt175_configured:
        data_quality = "error"
    elif not mt175_configured and fronius is None:
        data_quality = "unavailable"
    else:
        # Mindestens eine Quelle hat Daten geliefert
        # Stale wenn beide konfigurierten Quellen veraltet sind
        fronius_stale = (
            fronius_configured
            and fronius_age is not None
            and fronius_age >= stale_threshold_s
        )
        mt175_stale = (
            mt175_configured
            and mt175_age is not None
            and mt175_age >= stale_threshold_s
        )
        if fronius_stale and mt175_stale:
            data_quality = "stale"
        else:
            data_quality = "live"

    # --- Verdikt ---
    verdict, verdict_kind = _make_verdict(
        grid_power_w=grid_power_w,
        pin_locked=pin_locked,
        mt175_configured=mt175_configured,
        mt175_error=mt175_error,
        fronius_configured=fronius_configured,
        fronius_error=fronius_error,
        no_source=no_source,
        data_quality=data_quality,
    )

    # --- Frische-Label ---
    freshness_label = _make_freshness_label(
        data_quality=data_quality,
        fronius=fronius,
        mt175=mt175,
    )

    # Solar-Prognose (Sprint 5D)
    try:
        from energyradar.services.forecast import SolarForecastEngine
        forecast_report = SolarForecastEngine().generate_forecast()
        solar_forecast_dict = forecast_report.to_dict()
    except Exception as exc:
        log.warning("Fehler beim Erstellen des Forecast-Viewmodels: %s", exc)
        solar_forecast_dict = None

    return NowViewModel(
        verdict=verdict,
        verdict_kind=verdict_kind,
        pv_power_w=pv_power_w,
        pv_label=_fmt_power(pv_power_w),
        pv_available=pv_power_w is not None,
        grid_power_w=grid_power_w,
        grid_label=_fmt_power(grid_power_w),
        grid_available=grid_power_w is not None,
        consumption_w=consumption_w,
        consumption_label=_fmt_power(consumption_w),
        consumption_available=consumption_w is not None,
        data_quality=data_quality,
        freshness_label=freshness_label,
        pin_locked=pin_locked,
        solar_forecast=solar_forecast_dict,
    )


def _make_verdict(
    *,
    grid_power_w: Optional[float],
    pin_locked: bool,
    mt175_configured: bool,
    mt175_error: Optional[str],
    fronius_configured: bool,
    fronius_error: Optional[str],
    no_source: bool,
    data_quality: str,
) -> tuple[str, str]:
    from energyradar.ui.strings_de import S

    if no_source:
        return S.verdict_no_source(), "no_source"

    if data_quality == "error":
        return S.verdict_error(), "error"

    if mt175_configured:
        if pin_locked:
            return S.verdict_pin_locked(), "pin_locked"
        if grid_power_w is None:
            return S.verdict_grid_unavailable(), "unavailable"
        if grid_power_w > 5:
            return S.verdict_importing(grid_power_w), "importing"
        if grid_power_w < -5:
            return S.verdict_exporting(-grid_power_w), "exporting"
        return S.verdict_balanced(), "balanced"

    # Nur Fronius – kein Grid-Datum
    return S.verdict_grid_unavailable(), "unavailable"


def _make_freshness_label(
    *,
    data_quality: str,
    fronius,
    mt175,
) -> str:
    from energyradar.ui.strings_de import S

    if data_quality == "no_source":
        return S.freshness_no_source
    if data_quality in ("error", "unavailable"):
        return S.freshness_unavailable

    # Neuesten Zeitstempel finden
    candidates: list[datetime] = []
    if fronius is not None and fronius.timestamp is not None:
        candidates.append(fronius.timestamp)
    if mt175 is not None:
        candidates.append(mt175.received_at)

    if not candidates:
        return S.freshness_unavailable

    latest = max(candidates, key=lambda d: d.astimezone(timezone.utc))
    time_str = _time_str(latest)

    if data_quality == "stale":
        from energyradar.ui.strings_de import _relative_time
        return S.freshness_stale(_relative_time(latest))

    return S.freshness_live(time_str)


# ------------------------------------------------------------------ #

def build_today_vm_with_mt175(*, fronius, mt175) -> TodayViewModel:
    """Heute-Viewmodel über HistoryService."""
    from energyradar.ui.strings_de import S
    from energyradar.services import history
    from energyradar import config
    import zoneinfo

    has_source = fronius is not None or mt175 is not None

    tz = zoneinfo.ZoneInfo(config.MT175_TIMEZONE)
    hist_data = history.get_today_history(tz)

    summary = hist_data["summary"]

    gen_kwh = summary["solar_kwh"]
    cons_kwh = summary["consumption_kwh"]
    imp_kwh = summary["grid_import_kwh"]
    exp_kwh = summary["grid_export_kwh"]

    # Solar-Prognose (Sprint 5E)
    try:
        from energyradar.services.forecast import SolarForecastEngine
        forecast_report = SolarForecastEngine().generate_forecast()
        solar_forecast_dict = forecast_report.to_dict()
    except Exception as exc:
        log.warning("Fehler beim Erstellen des Forecast-Viewmodels für Today: %s", exc)
        solar_forecast_dict = None

    return TodayViewModel(
        generated_kwh=gen_kwh,
        generated_label=_fmt_energy(gen_kwh) if gen_kwh is not None else S.label_unknown,
        consumption_kwh=cons_kwh,
        consumption_label=_fmt_energy(cons_kwh) if cons_kwh is not None else S.label_unknown,
        import_total_kwh=imp_kwh,
        import_total_label=_fmt_energy(imp_kwh) if imp_kwh is not None else S.label_unknown,
        export_total_kwh=exp_kwh,
        export_total_label=_fmt_energy(exp_kwh) if exp_kwh is not None else S.label_unknown,
        self_consumption_pct=summary["self_consumption_pct"],
        autarky_pct=summary["autarky_pct"],
        coverage=hist_data["coverage"],
        period=hist_data["period"],
        history=hist_data["points"],
        has_data=len(hist_data["points"]) > 0,
        has_source=has_source,
        solar_forecast=solar_forecast_dict,
    )


def build_devices_vm(
    *,
    fronius,
    mt175,
    fronius_configured: bool,
    mt175_configured: bool,
    fronius_error: Optional[str],
    mt175_error: Optional[str],
    mt175_address: str = "",
    test_results: Optional[dict] = None,
) -> list[DeviceCardViewModel]:
    from energyradar.ui.strings_de import S
    from energyradar.services import data_source as ds

    if test_results is None:
        test_results = {}

    cards = []

    # --- Fronius Wechselrichter ---
    src = ds.effective()
    raw_f_addr = src["url"] if src and src.get("url") else ""
    f_addr_display = ds.mask_address_credentials(raw_f_addr)

    f_firmware = getattr(fronius, "firmware", None) if fronius else None

    if not fronius_configured:
        f_conn = "unconfigured"
        f_data = "unconfigured"
        f_msg = "Wechselrichter ist noch nicht eingerichtet."
        f_quality = "Nicht eingerichtet"
        f_caps = []
    elif fronius is not None:
        f_conn = "connected"
        f_data = "complete"
        f_msg = "Der Wechselrichter liefert aktuelle Energiedaten."
        f_quality = "Vollständig"
        f_caps = ["current_power", "daily_energy"]
    elif fronius_error:
        f_conn = "error"
        f_data = "error"
        f_msg = "Der Wechselrichter antwortet gerade nicht."
        f_quality = "Fehler"
        f_caps = []
    else:
        f_conn = "offline"
        f_data = "unavailable"
        f_msg = "Kein Signal vom Wechselrichter empfangen."
        f_quality = "Kein Signal"
        f_caps = []

    f_last_seen = fronius.timestamp.isoformat() if fronius and fronius.timestamp else None
    f_last_meas = fronius.timestamp.isoformat() if fronius and fronius.timestamp else None
    f_last_err = datetime.now(timezone.utc).isoformat() if fronius_error else None

    f_test = test_results.get("fronius_primary")
    f_last_test = f_test.get("tested_at") if f_test and f_test.get("ok") else None

    cards.append(DeviceCardViewModel(
        device_id="fronius_primary",
        device_type="inverter",
        display_name="Fronius Wechselrichter",
        connection_status=f_conn,
        data_status=f_data,
        configuration_status="configured" if fronius_configured else "unconfigured",
        address_display=f_addr_display,
        protocol="Fronius Solar API v1",
        firmware=f_firmware,
        last_seen_at=f_last_seen,
        last_measurement_at=f_last_meas,
        last_successful_test_at=f_last_test,
        last_error_at=f_last_err,
        capabilities=f_caps,
        data_quality_label=f_quality,
        pin_status="not_applicable",
        pin_instructions=None,
        user_message=f_msg,
        technical_error=fronius_error[:120] if fronius_error else None,
    ))

    # --- Tasmota SmartMeterReader ---
    m_addr_display = ds.mask_address_credentials(mt175_address)
    m_firmware = getattr(mt175, "firmware", None) if mt175 else None

    if not mt175_configured:
        m_conn = "unconfigured"
        m_data = "unconfigured"
        m_pin = "not_applicable"
        m_msg = "Smart Meter ist noch nicht eingerichtet."
        m_quality = "Nicht eingerichtet"
        m_caps = []
        m_instructions = None
    elif mt175 is not None:
        m_conn = "connected"
        availability = describe_smart_meter_availability(mt175)
        m_data = availability.data_status
        m_msg = availability.message
        m_caps = availability.capabilities
        m_quality = {
            "complete": "Vollständig",
            "partial": "Teilweise verfügbar",
            "unavailable": "Nicht verfügbar",
        }[m_data]
        if availability.pin_locked:
            m_pin = "locked"
            m_instructions = "Am Zähler ist die PIN-Freigabe erforderlich. Die Eingabe erfolgt je nach Zählermodell über die optische Taste beziehungsweise eine Lichtquelle. Bitte beachte die Anleitung deines Messstellenbetreibers."
        elif mt175.current_power_w is None:
            m_pin = "not_applicable"
            m_instructions = None
        else:
            m_pin = "unlocked"
            m_instructions = None
    elif mt175_error:
        m_conn = "error"
        m_data = "error"
        m_pin = "not_applicable"
        m_msg = "Der Smart Meter antwortet gerade nicht."
        m_quality = "Fehler"
        m_caps = []
        m_instructions = None
    else:
        m_conn = "offline"
        m_data = "unavailable"
        m_pin = "not_applicable"
        m_msg = "Kein Signal vom Smart Meter empfangen."
        m_quality = "Kein Signal"
        m_caps = []
        m_instructions = None

    m_last_seen = mt175.received_at.isoformat() if mt175 and mt175.received_at else None
    m_last_meas = mt175.received_at.isoformat() if mt175 and mt175.received_at else None
    m_last_err = datetime.now(timezone.utc).isoformat() if mt175_error else None

    m_test = test_results.get("mt175_primary")
    m_last_test = m_test.get("tested_at") if m_test and m_test.get("ok") else None

    cards.append(DeviceCardViewModel(
        device_id="mt175_primary",
        device_type="smart_meter",
        display_name="Tasmota SmartMeterReader",
        connection_status=m_conn,
        data_status=m_data,
        configuration_status="configured" if mt175_configured else "unconfigured",
        address_display=m_addr_display,
        protocol="Tasmota SML / HTTP",
        firmware=m_firmware,
        last_seen_at=m_last_seen,
        last_measurement_at=m_last_meas,
        last_successful_test_at=m_last_test,
        last_error_at=m_last_err,
        capabilities=m_caps,
        data_quality_label=m_quality,
        pin_status=m_pin,
        pin_instructions=m_instructions,
        user_message=m_msg,
        technical_error=mt175_error[:120] if mt175_error else None,
    ))

    return cards


def build_settings_vm() -> SettingsViewModel:
    from pathlib import Path

    from energyradar import config
    from energyradar.ui import settings as ui_settings
    from energyradar.services import data_source as ds

    raw_dict = ui_settings.load_raw_dict()
    # Do not expose the removed Living Sky preference to current clients.
    # Keeping the on-disk value untouched makes rollback safe.
    raw_dict.pop("dynamic_bg_enabled", None)
    effective_dict = ui_settings.resolve_effective(raw_dict)

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

    storage_info = _build_storage_status(
        config.DB_PATH,
        refresh_seconds=int(effective_dict.get("refresh_seconds", 5)),
    )
    export_directory = effective_dict.get("export_directory") or str(
        Path.home() / "Documents"
    )
    system_info = {
        "app_version": config.APP_VERSION,
        "build": config.APP_BUILD,
        "database_schema_version": config.SCHEMA_VERSION,
        "recording_interval_seconds": config.STORE_INTERVAL_SECONDS,
        "database_path": str(config.DB_PATH),
        "log_path": str(config.DATA_DIR / "energyradar.log"),
        "export_directory": export_directory,
        **storage_info,
    }

    return SettingsViewModel(
        settings=raw_dict,
        effective_settings=effective_dict,
        system=system_info,
        fronius_address=fronius_addr,
        fronius_editable=fronius_editable,
        mt175_address=effective_dict.get("mt175_address", ""),
        refresh_seconds=effective_dict.get("refresh_seconds", 5),
        timezone=config.MT175_TIMEZONE,
        theme=effective_dict.get("theme", "dark"),
    )


def _build_storage_status(database_path, *, refresh_seconds: int) -> dict:
    """Read human-facing storage health without creating or mutating a database."""
    import sqlite3
    from datetime import datetime, timezone
    from pathlib import Path

    path = Path(database_path)
    result = {
        "database_healthy": False,
        "recording_active": False,
        "recording_since": None,
        "stored_samples": 0,
        "database_size_bytes": path.stat().st_size if path.exists() else 0,
        "last_recorded_sample_at": None,
    }
    if not path.is_file():
        return result

    try:
        uri = f"{path.resolve().as_uri()}?mode=ro"
        with sqlite3.connect(uri, uri=True) as con:
            result["database_healthy"] = (
                con.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            )
            table_exists = con.execute(
                """
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'energy_samples_v1'
                """
            ).fetchone()
            if table_exists is None:
                return result
            count, first, last = con.execute(
                """
                SELECT COUNT(*), MIN(received_at), MAX(received_at)
                FROM energy_samples_v1
                """
            ).fetchone()
        result["stored_samples"] = int(count)
        result["recording_since"] = first
        result["last_recorded_sample_at"] = last
        if last:
            parsed = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            age_seconds = max(
                0.0,
                (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds(),
            )
            result["recording_active"] = age_seconds <= max(
                30, refresh_seconds * 3
            )
    except (OSError, sqlite3.Error, TypeError, ValueError):
        return result
    return result
