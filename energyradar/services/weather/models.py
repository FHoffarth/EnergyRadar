"""Datenmodelle für den Weather Service."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
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
    precipitation_probability_percent: Optional[float] = None


@dataclass
class DailyWeatherPoint:
    date: str
    condition: str = "unknown"
    weather_code: Optional[int] = None
    temperature_min_c: Optional[float] = None
    temperature_max_c: Optional[float] = None
    precipitation_probability_percent: Optional[float] = None
    sunrise: Optional[str] = None
    sunset: Optional[str] = None


@dataclass
class CurrentWeather:
    condition: str = "unknown"
    weather_code: Optional[int] = None
    cloud_cover_percent: Optional[float] = None
    temperature_c: Optional[float] = None
    feels_like_c: Optional[float] = None
    wind_speed_kmh: Optional[float] = None
    precipitation_mm: Optional[float] = None
    precipitation_probability_percent: Optional[float] = None
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
    daily: List[DailyWeatherPoint] = field(default_factory=list)


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
    issued_at: Optional[str] = None
    location: Optional[ResolvedLocation] = None
    sun: Optional[SunData] = None
    current: Optional[CurrentWeather] = None
    hourly: List[HourlyWeatherPoint] = field(default_factory=list)
    daily: List[DailyWeatherPoint] = field(default_factory=list)
    quality: Optional[WeatherQuality] = None
    warnings: List[WeatherWarning] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        # Open-Meteo does not expose a separate model-run timestamp. The
        # provider fetch instant is the honest issuance boundary we possess.
        result["issued_at"] = self.issued_at or self.fetched_at
        if self.fetched_at and isinstance(result.get("quality"), dict):
            try:
                fetched = datetime.fromisoformat(self.fetched_at.replace("Z", "+00:00"))
                if fetched.tzinfo is None:
                    fetched = fetched.replace(tzinfo=timezone.utc)
                age = max(0, int((datetime.now(timezone.utc) - fetched.astimezone(timezone.utc)).total_seconds()))
                result["quality"]["age_seconds"] = age
                result["quality"]["freshness"] = "fresh" if age <= 1200 else "stale" if age <= 21600 else "expired"
            except (TypeError, ValueError):
                pass
        return result
