"""Solar Forecast Engine für EnergyRadar (Sprint 5D).

Generiert ehrliche, datengestützte Solarprognosen in Watt-Leistungsbereichen ("Verdict before numbers").
"""
from __future__ import annotations

import logging
import math
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, List, Optional, Tuple

from energyradar import config
from energyradar.ui import settings as ui_settings
from energyradar.services.weather.service import WeatherService
from energyradar.services.weather.models import WeatherReport

log = logging.getLogger(__name__)


@dataclass
class SolarForecastInterval:
    start_time: str
    end_time: str
    expected_min_w: Optional[float]
    expected_max_w: Optional[float]
    trend: str  # "rising" | "steady" | "falling" | "unknown"
    cloud_cover_percent: Optional[float]


@dataclass
class ForecastConfidence:
    level: str  # "high" | "medium" | "low" | "uncertain"
    score: float
    reasons: List[str]


@dataclass
class SolarForecastReport:
    status: str  # "available" | "disabled" | "uncertain" | "no_data"
    headline: str
    confidence: ForecastConfidence
    peak_window_start: Optional[str]
    peak_window_end: Optional[str]
    installed_kwp: Optional[float]
    intervals: List[SolarForecastInterval]
    generated_at: str
    valid_until: Optional[str]
    data_basis: List[str]
    warnings: List[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _parse_iso_ts(ts_str: Optional[str]) -> Optional[datetime]:
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def get_historical_days_count() -> Tuple[int, float]:
    """Prüft SQLite-Datenbank auf Anzahl verwendbarer historischer Tage mit ausreichender Coverage."""
    if not config.DB_PATH.exists():
        return 0, 0.0

    try:
        with sqlite3.connect(config.DB_PATH) as con:
            res = con.execute(
                "SELECT COUNT(DISTINCT strftime('%Y-%m-%d', measured_at)) FROM energy_samples_v1 WHERE pv_power_w IS NOT NULL"
            ).fetchone()
            days_count = res[0] if res else 0

            res_total = con.execute("SELECT COUNT(*) FROM energy_samples_v1 WHERE pv_power_w IS NOT NULL").fetchone()
            total_samples = res_total[0] if res_total else 0
            coverage = min(1.0, total_samples / max(1, days_count * 288))
            return days_count, coverage
    except Exception as exc:
        log.warning("Fehler beim Prüfen der historischen Datenbasis: %s", exc)
        return 0, 0.0


class SolarForecastEngine:
    """Service zur Berechnung von Solar-Ertragsprognosen."""

    def __init__(self, weather_service: Optional[WeatherService] = None):
        self.weather_service = weather_service or WeatherService()

    def generate_forecast(self, now_dt: Optional[datetime] = None) -> SolarForecastReport:
        if now_dt is None:
            now_dt = datetime.now(timezone.utc)

        raw_settings = ui_settings.load_raw_dict()
        kwp = raw_settings.get("pv_installed_kwp")
        if kwp is not None and (isinstance(kwp, bool) or not isinstance(kwp, (int, float)) or math.isnan(kwp) or math.isinf(kwp) or kwp <= 0):
            kwp = None

        weather_report: WeatherReport = self.weather_service.get_weather_report(force_fresh=False)

        data_basis: List[str] = ["Daylight production profile"]
        warnings: List[str] = []
        reasons: List[str] = []

        if kwp:
            data_basis.append(f"Anlagen-Nennleistung: {kwp:.1f} kWp")
        else:
            warnings.append("Keine Anlagen-Nennleistung (kWp) in den Einstellungen angegeben.")

        # Weather Status validation
        if weather_report.status == "disabled":
            return SolarForecastReport(
                status="disabled",
                headline="Solarprognose deaktiviert.",
                confidence=ForecastConfidence(level="uncertain", score=0.0, reasons=["Wetterdaten deaktiviert."]),
                peak_window_start=None,
                peak_window_end=None,
                installed_kwp=kwp,
                intervals=[],
                generated_at=now_dt.isoformat(),
                valid_until=None,
                data_basis=[],
                warnings=["Wetterdaten sind in den Einstellungen deaktiviert."],
            )

        if weather_report.status in ("missing_location", "unreachable", "error"):
            return SolarForecastReport(
                status="uncertain",
                headline="Prognose unsicher: Standort oder Wetterdaten fehlen.",
                confidence=ForecastConfidence(level="uncertain", score=0.1, reasons=["Wetterdaten nicht verfügbar."]),
                peak_window_start=None,
                peak_window_end=None,
                installed_kwp=kwp,
                intervals=[],
                generated_at=now_dt.isoformat(),
                valid_until=None,
                data_basis=data_basis,
                warnings=[w.message for w in weather_report.warnings],
            )

        # Sun Timestamps
        sunrise_dt = _parse_iso_ts(weather_report.sun.sunrise) if weather_report.sun else None
        sunset_dt = _parse_iso_ts(weather_report.sun.sunset) if weather_report.sun else None

        if not sunrise_dt or not sunset_dt or sunset_dt <= sunrise_dt:
            return SolarForecastReport(
                status="uncertain",
                headline="Prognose derzeit unsicher: Sonnenzeiten ungültig.",
                confidence=ForecastConfidence(level="uncertain", score=0.2, reasons=["Fehlende oder ungültige Sonnenzeiten."]),
                peak_window_start=None,
                peak_window_end=None,
                installed_kwp=kwp,
                intervals=[],
                generated_at=now_dt.isoformat(),
                valid_until=None,
                data_basis=data_basis,
                warnings=["Sonnenzeiten konnten nicht ermittelt werden."],
            )

        data_basis.append(f"Sonnenzeiten: {sunrise_dt.strftime('%H:%M')} - {sunset_dt.strftime('%H:%M')}")

        # Check historical data
        hist_days, hist_coverage = get_historical_days_count()
        if hist_days >= 14 and hist_coverage >= 0.9:
            data_basis.append(f"Historie: {hist_days} Tage mit ausreichender Datenqualität")
        elif hist_days > 0:
            data_basis.append(f"Historie: {hist_days} Tage (partiell)")

        # Confidence Determination
        freshness = weather_report.quality.freshness if weather_report.quality else "unknown"
        if freshness == "fresh":
            data_basis.append("Stündliche Wetterprognose: Frische Daten")
            if kwp and hist_days >= 14 and hist_coverage >= 0.9:
                conf_level = "high"
                conf_score = 0.9
                reasons.append("Frische Wetterprognose und vollständige Historie vorhanden.")
            elif kwp:
                conf_level = "medium"
                conf_score = 0.7
                reasons.append("Frische Wetterdaten und Anlagenleistung vorhanden.")
            else:
                conf_level = "low"
                conf_score = 0.4
                reasons.append("Wetterdaten frisch, aber Nennleistung (kWp) fehlt.")
        elif freshness == "stale":
            conf_level = "low"
            conf_score = 0.3
            reasons.append("Wetterdaten sind veraltet (stale fallback).")
            warnings.append("Wetterdaten veraltet.")
        else:
            conf_level = "uncertain"
            conf_score = 0.1
            reasons.append("Wetterdaten abgelaufen oder unbekannt.")
            warnings.append("Keine verlässliche Wetterprognose.")

        # Generate Intervals (1-hour blocks for today)
        intervals: List[SolarForecastInterval] = []
        max_power_w = (kwp * 1000.0) if kwp else 3000.0  # Reference max power

        daylight_duration_s = (sunset_dt - sunrise_dt).total_seconds()
        solar_noon_s = sunrise_dt.timestamp() + daylight_duration_s / 2.0

        peak_val = 0.0
        peak_start: Optional[str] = None
        peak_end: Optional[str] = None

        # Build intervals for 12 hours around daylight
        for h in range(6, 22):
            st = now_dt.replace(hour=h, minute=0, second=0, microsecond=0)
            et = st.replace(hour=h, minute=59, second=59)

            mid_ts = st.timestamp() + 1800.0

            # Nighttime check
            if mid_ts < sunrise_dt.timestamp() or mid_ts > sunset_dt.timestamp():
                intervals.append(SolarForecastInterval(
                    start_time=st.isoformat(),
                    end_time=et.isoformat(),
                    expected_min_w=0.0,
                    expected_max_w=0.0,
                    trend="steady",
                    cloud_cover_percent=None,
                ))
                continue

            # Theoretical daylight ratio (sine wave approximation)
            dist_from_noon = abs(mid_ts - solar_noon_s) / (daylight_duration_s / 2.0)
            daylight_ratio = max(0.0, math.cos(dist_from_noon * (math.pi / 2.0)))

            # Cloud cover attenuation
            cloud_pct = weather_report.current.cloud_cover_percent if weather_report.current else None
            attenuation = 1.0 - (0.65 * (cloud_pct / 100.0)) if cloud_pct is not None else 0.7

            exp_max = max_power_w * daylight_ratio * attenuation
            exp_min = exp_max * 0.65

            # Trend calculation
            if mid_ts < solar_noon_s - 3600.0:
                trend = "rising"
            elif mid_ts > solar_noon_s + 3600.0:
                trend = "falling"
            else:
                trend = "steady"

            if exp_max > peak_val:
                peak_val = exp_max
                peak_start = st.isoformat()
                peak_end = et.isoformat()

            intervals.append(SolarForecastInterval(
                start_time=st.isoformat(),
                end_time=et.isoformat(),
                expected_min_w=round(exp_min, 1),
                expected_max_w=round(exp_max, 1),
                trend=trend,
                cloud_cover_percent=cloud_pct,
            ))

        # Rule-based German Headline ("Verdict before numbers")
        if conf_level == "uncertain":
            headline = "Prognose derzeit unsicher wegen unvollständiger Eingangsdaten."
        elif now_dt.timestamp() > sunset_dt.timestamp():
            headline = "Nachts findet keine Solarerzeugung statt. Ertrag steigt morgen früh wieder."
        elif peak_val > 500.0:
            headline = "Die Solarleistung dürfte am frühen Nachmittag ihren Höchstwert erreichen."
        else:
            headline = "Geringer Ertrag aufgrund hoher Bewölkung erwartet."

        return SolarForecastReport(
            status="available" if conf_level != "uncertain" else "uncertain",
            headline=headline,
            confidence=ForecastConfidence(level=conf_level, score=conf_score, reasons=reasons),
            peak_window_start=peak_start,
            peak_window_end=peak_end,
            installed_kwp=kwp,
            intervals=intervals,
            generated_at=now_dt.isoformat(),
            valid_until=sunset_dt.isoformat() if sunset_dt else None,
            data_basis=data_basis,
            warnings=warnings,
        )
