"""Datenmodelle für den Weather Service."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, List, Optional


@dataclass
class LocationCandidate:
    provider_id: str
    display_name: str
    name: str
    latitude: float
    longitude: float
    admin1: Optional[str] = None
    admin2: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    postcodes: Optional[List[str]] = None
    timezone: Optional[str] = None
    provider: str = "open_meteo"


@dataclass
class ResolvedLocation:
    provider_id: str
    display_name: str
    latitude: float
    longitude: float
    timezone: str
    country_code: Optional[str] = None
    provider: str = "open_meteo"
    original_query: str = ""
    resolved_at: str = ""


@dataclass
class SunData:
    sunrise: Optional[str] = None  # ISO Timestamp
    sunset: Optional[str] = None   # ISO Timestamp


@dataclass
class HourlyWeatherPoint:
    time: str
    condition: str = "unknown"
    weather_code: Optional[int] = None
    cloud_cover_percent: Optional[float] = None
    temperature_c: Optional[float] = None
    precipitation_mm: Optional[float] = None


@dataclass
class CurrentWeather:
    condition: str = "unknown"
    weather_code: Optional[int] = None
    cloud_cover_percent: Optional[float] = None
    temperature_c: Optional[float] = None
    precipitation_mm: Optional[float] = None
    is_day: Optional[bool] = None


@dataclass
class ProviderWeatherPayload:
    provider: str
    observed_at: str
    fetched_at: str
    timezone: str
    utc_offset_seconds: int
    sun: SunData
    current: CurrentWeather
    hourly: List[HourlyWeatherPoint] = field(default_factory=list)


@dataclass
class WeatherQuality:
    freshness: str = "unknown"  # "fresh" | "stale" | "expired" | "unknown"
    source: str = "open_meteo"
    age_seconds: Optional[int] = None


@dataclass
class WeatherWarning:
    code: str
    message: str


@dataclass
class WeatherReport:
    status: str = "disabled"  # "available" | "disabled" | "missing_location" | "unreachable" | "error"
    provider_status: str = "unknown"  # "reachable" | "unreachable" | "rate_limited" | "invalid_response" | "unknown"
    served_from_cache: bool = False
    observed_at: Optional[str] = None
    fetched_at: Optional[str] = None
    location: Optional[ResolvedLocation] = None
    sun: Optional[SunData] = None
    current: Optional[CurrentWeather] = None
    quality: Optional[WeatherQuality] = None
    warnings: List[WeatherWarning] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
