"""WeatherService Hauptsteuerung.

Orchestriert Provider, Cache, Settings-Integration und Fallback-Entscheidungen.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from energyradar.ui import settings as ui_settings
from energyradar.services.weather import cache
from energyradar.services.weather.models import (
    LocationCandidate,
    ProviderWeatherPayload,
    ResolvedLocation,
    WeatherQuality,
    WeatherReport,
    WeatherWarning,
)
from energyradar.services.weather.providers.base import WeatherProvider
from energyradar.services.weather.providers.open_meteo import OpenMeteoProvider

log = logging.getLogger(__name__)


class WeatherService:
    """Zentraler Fachdienst für Standortauflösung und Wetterberichte."""

    def __init__(self, provider: Optional[WeatherProvider] = None):
        self.provider: WeatherProvider = provider or OpenMeteoProvider()

    def search_locations(self, query: str) -> List[LocationCandidate]:
        """Sucht Standortkandidaten zu einer Texteingabe."""
        return self.provider.search_locations(query)

    def get_resolved_location(self) -> Optional[ResolvedLocation]:
        """Liest den explizit bestätigten Standort aus den Settings."""
        raw = ui_settings.load_raw_dict()
        res_dict = raw.get("resolved_location")
        if isinstance(res_dict, dict) and res_dict.get("latitude") is not None and res_dict.get("longitude") is not None:
            return ResolvedLocation(
                provider_id=str(res_dict.get("provider_id", "custom")),
                display_name=str(res_dict.get("display_name", "")),
                latitude=float(res_dict["latitude"]),
                longitude=float(res_dict["longitude"]),
                timezone=str(res_dict.get("timezone", "Europe/Berlin")),
                country_code=res_dict.get("country_code"),
                provider=str(res_dict.get("provider", "open_meteo")),
                original_query=str(res_dict.get("original_query", raw.get("location_query") or "")),
                resolved_at=str(res_dict.get("resolved_at", "")),
            )

        # Fallback auf rohe latitude/longitude falls vorab manuell gesetzt
        lat = raw.get("latitude")
        lon = raw.get("longitude")
        if lat is not None and lon is not None:
            query = str(raw.get("location_query") or f"{lat}, {lon}")
            return ResolvedLocation(
                provider_id="manual",
                display_name=query,
                latitude=float(lat),
                longitude=float(lon),
                timezone="Europe/Berlin",
                provider="manual",
                original_query=query,
                resolved_at=datetime.now(timezone.utc).isoformat(),
            )

        return None

    def get_weather_report(self, force_fresh: bool = False) -> WeatherReport:
        """
        Liefert den aktuellen WeatherReport.
        Orchestriert Settings, TTL-Cache und Stale-Offline-Fallback.
        """
        raw = ui_settings.load_raw_dict()
        effective = ui_settings.resolve_effective(raw)
        weather_enabled = effective.get("weather_enabled", False)

        if not weather_enabled:
            return WeatherReport(
                status="disabled",
                provider_status="unknown",
                warnings=[WeatherWarning(code="disabled", message="Wetterdaten sind in den Einstellungen deaktiviert.")],
            )

        location = self.get_resolved_location()
        if not location:
            return WeatherReport(
                status="missing_location",
                provider_status="unknown",
                warnings=[WeatherWarning(code="missing_location", message="Bitte wähle zuerst einen bestätigten Standort aus.")],
            )

        location_key = cache.get_location_key(
            location.provider, location.latitude, location.longitude, location.timezone
        )

        # 1. Prüfe Cache, wenn kein Live-Abruf erzwungen wird
        cached_payload, freshness, age_seconds = cache.load_cached_payload(location_key)
        if not force_fresh and cached_payload is not None and freshness == "fresh":
            return WeatherReport(
                status="available",
                provider_status="reachable",
                served_from_cache=True,
                observed_at=cached_payload.observed_at,
                fetched_at=cached_payload.fetched_at,
                location=location,
                sun=cached_payload.sun,
                current=cached_payload.current,
                quality=WeatherQuality(freshness="fresh", source=cached_payload.provider, age_seconds=age_seconds),
                warnings=[],
            )

        # 2. Versuche frischen Netzwerkabruf
        try:
            payload = self.provider.fetch_weather(location)
            cache.save_cached_payload(location_key, payload)
            return WeatherReport(
                status="available",
                provider_status="reachable",
                served_from_cache=False,
                observed_at=payload.observed_at,
                fetched_at=payload.fetched_at,
                location=location,
                sun=payload.sun,
                current=payload.current,
                quality=WeatherQuality(freshness="fresh", source=payload.provider, age_seconds=0),
                warnings=[],
            )
        except Exception as exc:
            log.warning("Wetterabruf fehlgeschlagen: %s", exc)

            # 3. Fallback auf gecachte Daten (sofern Stale <= 6 Std. alt)
            if cached_payload is not None and freshness == "stale":
                return WeatherReport(
                    status="available",
                    provider_status="unreachable",
                    served_from_cache=True,
                    observed_at=cached_payload.observed_at,
                    fetched_at=cached_payload.fetched_at,
                    location=location,
                    sun=cached_payload.sun,
                    current=cached_payload.current,
                    quality=WeatherQuality(freshness="stale", source=cached_payload.provider, age_seconds=age_seconds),
                    warnings=[
                        WeatherWarning(
                            code="provider_unreachable",
                            message="Wetterdienst aktuell nicht erreichbar. Es werden die zuletzt verfügbaren Daten angezeigt."
                        )
                    ],
                )

            # 4. Kein benutzbarer Datensatz vorhanden
            return WeatherReport(
                status="unreachable",
                provider_status="unreachable",
                served_from_cache=False,
                location=location,
                quality=WeatherQuality(freshness="expired" if cached_payload else "unknown", source=location.provider, age_seconds=age_seconds),
                warnings=[
                    WeatherWarning(
                        code="provider_unreachable",
                        message=f"Wetterdienst nicht erreichbar: {str(exc)[:120]}"
                    )
                ],
            )
