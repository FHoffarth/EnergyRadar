"""WeatherProvider Protocol Interface."""
from __future__ import annotations

from typing import List, Protocol, runtime_checkable
from energyradar.services.weather.models import LocationCandidate, ProviderWeatherPayload, ResolvedLocation


@runtime_checkable
class WeatherProvider(Protocol):
    """Schnittstelle für externe Wetterdienst-Adapter."""

    def search_locations(self, query: str) -> List[LocationCandidate]:
        """Sucht Standortkandidaten zu einer Texteingabe."""
        ...

    def fetch_weather(self, location: ResolvedLocation) -> ProviderWeatherPayload:
        """Ruft frische Roh-Wetterdaten für den bestätigten Standort ab."""
        ...
