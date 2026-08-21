"""Energy decision model — pure, testable functions behind the Heute cockpit.

Owner-approved Product Law (see ENERGY_DECISION_EXPERIENCE.md / DESIGN_CONSTITUTION.md):
- Autonomy (Autarkie) and economic value are co-equal first-viewport signals.
- Autonomy determines the daily assessment *class*; self-consumption, economic
  value and coverage only refine the explanatory sentence — they never silently
  change the class.
- Unknown stays unknown; an invalid balance is a conflict, never a clamped 0–100.

No I/O, no UI. Inputs are already-trusted, period-compatible values.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


def recommend(power: float) -> tuple[str, str]:
    """Legacy live-power hint used by app.py /api/live (kept for compatibility)."""
    if power > 1500:
        return "excellent", "☀️ Excellent solar production"
    elif power > 500:
        return "good", "🌤 Good solar production"
    elif power > 10:
        return "limited", "🌥 Limited solar production"
    else:
        return "none", "🌙 No solar production"

# Owner-approved assessment cut points (autonomy %).
EXCELLENT_MIN = 80
STRONG_MIN = 60
BALANCED_MIN = 40

# Harmless numeric tolerance for ratio clamping (fractions).
_TOL = 0.005


@dataclass(frozen=True)
class Ratio:
    value_pct: Optional[int]
    state: str            # "available" | "unavailable" | "conflict"
    reason: Optional[str]


def autarkie(house_kwh: Optional[float], import_kwh: Optional[float]) -> Ratio:
    """Autarkie = 1 − grid_import / house_consumption (share of demand met without grid)."""
    if house_kwh is None or import_kwh is None:
        return Ratio(None, "unavailable", "house_or_import_unknown")
    if house_kwh <= 0:
        return Ratio(None, "unavailable", "house_consumption_not_positive")
    raw = 1.0 - import_kwh / house_kwh
    if raw < -_TOL or raw > 1.0 + _TOL:
        # e.g. import > house → sources not comparable for this period.
        return Ratio(None, "conflict", "autarky_out_of_bounds")
    return Ratio(max(0, min(100, round(raw * 100))), "available", None)


def eigenverbrauch(generation_kwh: Optional[float], export_kwh: Optional[float]) -> Ratio:
    """Eigenverbrauch = (PV_generation − grid_export) / PV_generation (PV kept in-house)."""
    if generation_kwh is None or export_kwh is None:
        return Ratio(None, "unavailable", "generation_or_export_unknown")
    if generation_kwh <= 0:
        return Ratio(None, "unavailable", "generation_not_positive")
    self_consumed = generation_kwh - export_kwh
    if self_consumed < -_TOL * generation_kwh:
        return Ratio(None, "conflict", "export_exceeds_generation")
    raw = self_consumed / generation_kwh
    return Ratio(max(0, min(100, round(raw * 100))), "available", None)


@dataclass(frozen=True)
class Verdict:
    assessable: bool
    assessment_class: Optional[str]   # excellent | strong | balanced | grid_dependent | None
    trust: str                        # complete | partial | not_assessable
    headline: str
    sentence: str
    reason: Optional[str]


_CLASS_HEADLINE = {
    "excellent": "Ein weitgehend autarker Energietag.",
    "strong": "Ein überwiegend autarker Energietag.",
    "balanced": "Ein ausgewogener Energietag.",
    "grid_dependent": "Ein netzgeprägter Energietag.",
}


def daily_verdict(
    autarkie_pct: Optional[int],
    eigenverbrauch_pct: Optional[int],
    *,
    coverage_complete: bool,
    economic_value_available: bool,
    autarkie_reason: Optional[str] = None,
) -> Verdict:
    """Deterministic daily assessment. Autonomy sets the class; everything else
    only colours the sentence (owner Product Law)."""
    if autarkie_pct is None:
        # Distinguish a genuine period conflict from simply not-enough evidence.
        trust = "not_assessable"
        if autarkie_reason == "autarky_out_of_bounds":
            sentence = ("Der Tag ist nicht bewertbar, weil Netz- und Solardaten "
                        "für diesen Zeitraum nicht vergleichbar sind.")
        else:
            sentence = ("Der Tag kann noch nicht bewertet werden, weil der "
                        "Hausverbrauch für diesen Zeitraum nicht belastbar ist.")
        return Verdict(False, None, trust, "Noch nicht bewertbar", sentence, autarkie_reason or "autarkie_unavailable")

    if autarkie_pct >= EXCELLENT_MIN:
        cls = "excellent"
    elif autarkie_pct >= STRONG_MIN:
        cls = "strong"
    elif autarkie_pct >= BALANCED_MIN:
        cls = "balanced"
    else:
        cls = "grid_dependent"

    trust = "complete" if coverage_complete else "partial"
    headline = _CLASS_HEADLINE[cls]

    parts = [f"{autarkie_pct} % des Strombedarfs wurden ohne Netzbezug gedeckt."]
    # Self-consumption nuance: a rich solar day mostly exported rather than used.
    if eigenverbrauch_pct is not None and eigenverbrauch_pct < 40 and cls in ("excellent", "strong", "balanced"):
        parts.append("Ein großer Teil der Solarenergie wurde eingespeist statt im Haus genutzt.")
    if not economic_value_available:
        parts.append("Ein wirtschaftlicher Wert ist ohne hinterlegten Stromtarif nicht ausgewiesen.")
    if trust == "partial":
        parts.append("Die Bewertung ist vorläufig, da nicht der gesamte Zeitraum vollständig abgedeckt ist.")

    return Verdict(True, cls, trust, headline, " ".join(parts), None)


# --------------------------------------------------------------------------- #
# Status semantics (pure) — Fronius night operation & weather.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class InverterStatus:
    state: str          # live | night_standby | wake_window | offline_unexpected | error | unconfigured
    label: str
    healthy: bool       # night/standby is healthy, not a fault
    archive_available: bool


def inverter_status(
    *,
    configured: bool,
    live_fresh: bool,
    error: bool,
    now_local: datetime,
    sunrise: Optional[datetime],
    sunset: Optional[datetime],
    has_archive: bool,
    archive_stale: bool = False,
    night_clock_start: int = 22,
    night_clock_end: int = 5,
    wake_lead_minutes: int = 60,
) -> InverterStatus:
    """Never report a fault without fault evidence; expected night is not offline.

    Night is determined from reliable sunrise/sunset when available, otherwise a
    conservative local clock window (owner-approved: sun-times, else clock).
    """
    if not configured:
        return InverterStatus("unconfigured", "Wechselrichter ist noch nicht eingerichtet.", True, has_archive)
    if error:
        return InverterStatus("error", "Der Wechselrichter meldet einen Fehler.", False, has_archive)
    if live_fresh:
        return InverterStatus("live", "Der Wechselrichter liefert aktuelle Daten.", True, has_archive)

    # No live reading — is this expected night?
    if sunrise is not None and sunset is not None:
        is_night = now_local < sunrise or now_local >= sunset
        near_wake = sunrise is not None and 0 <= (sunrise - now_local).total_seconds() <= wake_lead_minutes * 60
    else:
        hour = now_local.hour
        is_night = hour >= night_clock_start or hour < night_clock_end
        near_wake = hour == (night_clock_end - 1) % 24

    archive_suffix = " · Archiv verfügbar" if has_archive else ""
    if near_wake:
        return InverterStatus("wake_window", f"Wiederaufnahme gegen Sonnenaufgang erwartet{archive_suffix}", True, has_archive)
    if is_night:
        return InverterStatus("night_standby", f"Nachtbetrieb · Live-Daten pausieren{archive_suffix}", True, has_archive)
    # Daytime, configured, no live data, no fault evidence → genuinely unexpected.
    return InverterStatus("offline_unexpected", "Kein Signal vom Wechselrichter empfangen.", False, has_archive)


@dataclass(frozen=True)
class WeatherStatus:
    state: str          # unconfigured | reachable_not_loaded | loaded | stale | unreachable | loading
    label: str


def weather_status(
    *,
    location_configured: bool,
    provider_reachable: bool,
    loaded: bool,
    fresh: bool,
    last_update_local: Optional[str] = None,
    loading: bool = False,
) -> WeatherStatus:
    """Separate location / reachability / loaded / freshness — never conflate them."""
    if not location_configured:
        return WeatherStatus("unconfigured", "Kein Standort hinterlegt.")
    if loading:
        return WeatherStatus("loading", "Wetterdaten werden geladen …")
    if not provider_reachable:
        return WeatherStatus("unreachable", "Wetterdaten derzeit nicht verfügbar.")
    if not loaded:
        return WeatherStatus("reachable_not_loaded", "Wetterdienst erreichbar · Wetterdaten noch nicht geladen")
    when = f" um {last_update_local} Uhr" if last_update_local else ""
    if fresh:
        return WeatherStatus("loaded", f"Wetterdaten aktualisiert{when}")
    return WeatherStatus("stale", f"Wetterdaten zuletzt{when} aktualisiert")
