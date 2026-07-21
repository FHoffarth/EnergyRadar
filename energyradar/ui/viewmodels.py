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


@dataclass
class TodayViewModel:
    generated_kwh: Optional[float]    # aus Fronius energy_today
    generated_label: str
    import_total_kwh: Optional[float] # MT175 ImportActive (Gesamtzähler)
    import_total_label: str
    export_total_kwh: Optional[float] # MT175 ExportActive (Gesamtzähler)
    export_total_label: str
    history: List[dict]               # [{"time": "HH:MM", "powerW": int}]
    has_data: bool
    has_source: bool


@dataclass
class DeviceCardViewModel:
    device_id: str          # "fronius" | "mt175"
    name: str
    # "connected" | "unavailable" | "error" | "unconfigured"
    status: str
    last_seen_label: str    # "Zuletzt gesehen vor 3 Minuten" | "Noch nie"
    available_measurements: List[str]
    unavailable_measurements: List[str]
    address: str            # Adresse zur Anzeige
    has_error: bool
    error_message: str


@dataclass
class SettingsViewModel:
    fronius_address: str
    fronius_editable: bool
    mt175_address: str
    refresh_seconds: int
    timezone: str
    theme: str              # "dark" | "light" | "system"


# ------------------------------------------------------------------ #
# Hilfsfunktionen
# ------------------------------------------------------------------ #

def _fmt_power(watts: Optional[float]) -> str:
    from ui.strings_de import S
    return S.fmt_power(watts)


def _fmt_energy(kwh: Optional[float]) -> str:
    from ui.strings_de import S
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
    from ui.strings_de import S

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
        pin_locked = mt175.current_power_w is None
        mt175_age = _age_s(mt175.received_at)
        if not pin_locked and mt175_age is not None and mt175_age < stale_threshold_s:
            grid_power_w = mt175.current_power_w

    # --- Verbrauch ---
    consumption_w: Optional[float] = None
    if pv_power_w is not None and grid_power_w is not None:
        consumption_w = pv_power_w + grid_power_w
        if consumption_w < 0:
            consumption_w = 0.0   # kein negativer Verbrauch

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
    from ui.strings_de import S

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
    from ui.strings_de import S

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
        from ui.strings_de import _relative_time
        return S.freshness_stale(_relative_time(latest))

    return S.freshness_live(time_str)


# ------------------------------------------------------------------ #

def build_today_vm(*, fronius) -> TodayViewModel:
    """Heute-Viewmodel aus Fronius-Lesung und historischen Daten."""
    from ui.strings_de import S
    from services import storage

    has_source = fronius is not None

    generated_kwh: Optional[float] = None
    if fronius is not None:
        generated_kwh = round(fronius.energy_today / 1000, 2)

    history_raw = storage.history_today()
    history = [{"time": h["time"], "powerW": round(h["power"])} for h in history_raw]

    return TodayViewModel(
        generated_kwh=generated_kwh,
        generated_label=_fmt_energy(generated_kwh),
        import_total_kwh=None,
        import_total_label=S.label_unknown,
        export_total_kwh=None,
        export_total_label=S.label_unknown,
        history=history,
        has_data=len(history) > 0,
        has_source=has_source,
    )


def build_today_vm_with_mt175(*, fronius, mt175) -> TodayViewModel:
    """Heute-Viewmodel mit Netzzähler-Totals."""
    vm = build_today_vm(fronius=fronius)
    if mt175 is not None:
        vm.import_total_kwh = mt175.grid_import_total_kwh
        vm.import_total_label = _fmt_energy(mt175.grid_import_total_kwh)
        vm.export_total_kwh = mt175.grid_export_total_kwh
        vm.export_total_label = _fmt_energy(mt175.grid_export_total_kwh)
    return vm


def build_devices_vm(
    *,
    fronius,
    mt175,
    fronius_configured: bool,
    mt175_configured: bool,
    fronius_error: Optional[str],
    mt175_error: Optional[str],
) -> list[DeviceCardViewModel]:
    from ui.strings_de import S
    from services import data_source as ds

    cards = []

    # --- Fronius-Karte ---
    if fronius is not None:
        f_status = "connected"
        f_last = S.device_last_seen(fronius.timestamp) if fronius.timestamp else S.device_last_seen_never
        f_avail = [S.avail_pv_power, S.avail_energy_today, S.avail_energy_year, S.avail_energy_total]
        f_unavail: list[str] = []
        f_err = ""
    elif fronius_configured and fronius_error:
        f_status = "error"
        f_last = S.device_last_seen_never
        f_avail = []
        f_unavail = [S.avail_pv_power, S.avail_energy_today, S.avail_energy_year, S.avail_energy_total]
        f_err = fronius_error
    elif fronius_configured:
        f_status = "unavailable"
        f_last = S.device_last_seen_never
        f_avail = []
        f_unavail = [S.avail_pv_power]
        f_err = ""
    else:
        f_status = "unconfigured"
        f_last = S.device_last_seen_never
        f_avail = []
        f_unavail = []
        f_err = ""

    src = ds.effective()
    fronius_addr = (
        ds.display_address(src["url"])
        if src and src.get("source") == "saved"
        else ""
    )

    cards.append(DeviceCardViewModel(
        device_id="fronius",
        name=S.device_fronius,
        status=f_status,
        last_seen_label=f_last,
        available_measurements=f_avail,
        unavailable_measurements=f_unavail,
        address=fronius_addr,
        has_error=bool(fronius_error),
        error_message=f_err[:120] if f_err else "",
    ))

    # --- MT175-Karte ---
    if mt175 is not None:
        m_status = "connected"
        m_last = S.device_last_seen(mt175.received_at)
        m_avail = [S.avail_grid_import, S.avail_grid_export, S.avail_grid_phases]
        m_unavail: list[str] = []
        if mt175.current_power_w is None:
            m_avail_extra = []
            m_unavail = [S.unavail_pin_locked]
        else:
            m_avail = [S.avail_grid_power] + m_avail
            m_unavail = []
        m_err = ""
    elif mt175_configured and mt175_error:
        m_status = "error"
        m_last = S.device_last_seen_never
        m_avail = []
        m_unavail = [S.avail_grid_power, S.avail_grid_import, S.avail_grid_export]
        m_err = mt175_error
    elif mt175_configured:
        m_status = "unavailable"
        m_last = S.device_last_seen_never
        m_avail = []
        m_unavail = [S.avail_grid_power]
        m_err = ""
    else:
        m_status = "unconfigured"
        m_last = S.device_last_seen_never
        m_avail = []
        m_unavail = []
        m_err = ""

    cards.append(DeviceCardViewModel(
        device_id="mt175",
        name=S.device_mt175,
        status=m_status,
        last_seen_label=m_last,
        available_measurements=m_avail,
        unavailable_measurements=m_unavail,
        address="",    # wird dynamisch aus Settings befüllt
        has_error=bool(mt175_error),
        error_message=m_err[:120] if m_err else "",
    ))

    return cards


def build_settings_vm(
    *,
    fronius_address: str,
    fronius_editable: bool,
    mt175_address: str,
    refresh_seconds: int,
    timezone_str: str,
    theme: str,
) -> SettingsViewModel:
    return SettingsViewModel(
        fronius_address=fronius_address,
        fronius_editable=fronius_editable,
        mt175_address=mt175_address,
        refresh_seconds=refresh_seconds,
        timezone=timezone_str,
        theme=theme,
    )
