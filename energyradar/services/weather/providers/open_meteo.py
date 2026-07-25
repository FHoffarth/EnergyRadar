"""Open-Meteo WeatherProvider Adapter.

Freier Wetterdienst (CC BY 4.0 Attribution erforderlich).
Liefert Geocoding, aktuelle Wetterwerte und tägliche Sonnenzeiten.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, List, Optional

from energyradar import config
from energyradar.services.weather.models import (
    CurrentWeather,
    LocationCandidate,
    ProviderWeatherPayload,
    ResolvedLocation,
    SunData,
)

log = logging.getLogger(__name__)

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
USER_AGENT = f"EnergyRadar/{config.APP_VERSION} (Desktop App; +https://github.com/FHoffarth/EnergyRadar)"
TIMEOUT_SECONDS = 10.0


def map_wmo_code(code: Optional[int]) -> str:
    """Mappt numerischen WMO-Wettercode zu normierter Condition-Zeichenkette."""
    if code is None:
        return "unknown"
    if code == 0:
        return "clear"
    if code in (1, 2):
        return "partly_cloudy"
    if code == 3:
        return "cloudy"
    if code in (45, 48):
        return "fog"
    if code in (51, 53, 55, 61, 63):
        return "rain"
    if code in (65, 80, 81, 82):
        return "heavy_rain"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (95, 96, 99):
        return "thunderstorm"
    return "unknown"


def _validate_float(val: Any, min_val: Optional[float] = None, max_val: Optional[float] = None) -> Optional[float]:
    """Validiert Zahlenwerte streng (lehnt Booleans, NaNs, Infs ab, konvertiert valide Zahlstrings)."""
    if val is None or isinstance(val, bool):
        return None
    try:
        f = float(val)
        import math
        if math.isnan(f) or math.isinf(f):
            return None
        if min_val is not None and f < min_val:
            return None
        if max_val is not None and f > max_val:
            return None
        return f
    except (ValueError, TypeError):
        return None


class OpenMeteoProvider:
    """Implementierung des WeatherProvider Protocols für Open-Meteo."""

    def search_locations(self, query: str) -> List[LocationCandidate]:
        q = query.strip()
        if not q or len(q) < 2:
            return []

        import re
        candidates: List[LocationCandidate] = []

        # 1. Prüfe, ob die Eingabe eine 5-stellige deutsche PLZ enthält (z. B. "64807" oder "64807 Dieburg")
        plz_match = re.search(r"\b(\d{5})\b", q)
        if plz_match:
            plz = plz_match.group(1)
            try:
                z_url = f"https://api.zippopotam.us/de/{plz}"
                z_req = urllib.request.Request(z_url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(z_req, timeout=TIMEOUT_SECONDS) as z_resp:
                    if z_resp.status == 200:
                        z_data = json.loads(z_resp.read().decode("utf-8"))
                        places = z_data.get("places", [])
                        if places and isinstance(places, list):
                            place = places[0]
                            p_name = str(place.get("place name", "")).strip()
                            p_state = str(place.get("state", "")).strip()
                            p_lat = _validate_float(place.get("latitude"), -90.0, 90.0)
                            p_lon = _validate_float(place.get("longitude"), -180.0, 180.0)
                            if p_name and p_lat is not None and p_lon is not None:
                                disp_name = f"{plz} {p_name}"
                                if p_state:
                                    disp_name += f", {p_state}"
                                disp_name += ", Deutschland"

                                candidates.append(LocationCandidate(
                                    provider_id=f"plz-{plz}",
                                    display_name=disp_name,
                                    name=p_name,
                                    latitude=p_lat,
                                    longitude=p_lon,
                                    admin1=p_state if p_state else None,
                                    country="Deutschland",
                                    country_code="DE",
                                    postcodes=[plz],
                                    timezone="Europe/Berlin",
                                    provider="open_meteo",
                                ))
                                # Falls die Eingabe nur aus der PLZ bestand, nutze den Ortsnamen für die Open-Meteo-Suche
                                if q == plz:
                                    q = p_name
            except Exception as exc:
                log.debug("Zippopotam PLZ Lookup für %s übersprungen: %s", plz, exc)

        params = urllib.parse.urlencode({
            "name": q,
            "count": 5,
            "language": "de",
            "format": "json"
        })
        url = f"{GEOCODING_URL}?{params}"

        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                if resp.status != 200:
                    log.warning("Open-Meteo Geocoding antwortete mit Status %s", resp.status)
                    return candidates
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            log.warning("Geocoding-Abruf fehlgeschlagen: %s", exc)
            return candidates

        results = data.get("results")
        if not isinstance(results, list):
            return candidates

        for item in results:
            if not isinstance(item, dict):
                continue

            lat = _validate_float(item.get("latitude"), -90.0, 90.0)
            lon = _validate_float(item.get("longitude"), -180.0, 180.0)
            if lat is None or lon is None:
                continue

            provider_id = str(item.get("id", ""))
            name = str(item.get("name", "")).strip()
            if not name:
                continue

            admin1 = str(item["admin1"]).strip() if item.get("admin1") else None
            admin2 = str(item["admin2"]).strip() if item.get("admin2") else None
            country = str(item["country"]).strip() if item.get("country") else None
            country_code = str(item["country_code"]).strip().upper() if item.get("country_code") else None
            tz_str = str(item["timezone"]).strip() if item.get("timezone") else "Europe/Berlin"

            postcodes_raw = item.get("postcodes")
            postcodes: Optional[List[str]] = None
            if isinstance(postcodes_raw, list):
                postcodes = [str(p).strip() for p in postcodes_raw if p]

            # Erstelle aussagekräftigen display_name
            parts = [name]
            if admin1 and admin1 != name:
                parts.append(admin1)
            if country:
                parts.append(country)
            if postcodes:
                parts.append(f"({postcodes[0]})")
            display_name = ", ".join(parts)

            candidates.append(LocationCandidate(
                provider_id=provider_id,
                display_name=display_name,
                name=name,
                latitude=lat,
                longitude=lon,
                admin1=admin1,
                admin2=admin2,
                country=country,
                country_code=country_code,
                postcodes=postcodes,
                timezone=tz_str,
                provider="open_meteo",
            ))

        return candidates

    def fetch_weather(self, location: ResolvedLocation) -> ProviderWeatherPayload:
        from energyradar.services.weather.models import HourlyWeatherPoint

        params = urllib.parse.urlencode({
            "latitude": location.latitude,
            "longitude": location.longitude,
            "current": "temperature_2m,precipitation,weather_code,cloud_cover,is_day",
            "hourly": "temperature_2m,precipitation,weather_code,cloud_cover",
            "daily": "sunrise,sunset",
            "forecast_days": 1,
            "timezone": location.timezone or "auto",
        })
        url = f"{FORECAST_URL}?{params}"

        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Open-Meteo API antwortete mit Status {resp.status}")
            raw_data = json.loads(resp.read().decode("utf-8"))

        curr_raw = raw_data.get("current", {})
        daily_raw = raw_data.get("daily", {})
        hourly_raw = raw_data.get("hourly", {})

        # Validierung der Rohwerte
        temp_c = _validate_float(curr_raw.get("temperature_2m"))
        precip_mm = _validate_float(curr_raw.get("precipitation"), min_val=0.0)
        cloud_pct = _validate_float(curr_raw.get("cloud_cover"), min_val=0.0, max_val=100.0)

        weather_code_raw = curr_raw.get("weather_code")
        wmo_code = int(weather_code_raw) if isinstance(weather_code_raw, (int, float)) and not isinstance(weather_code_raw, bool) else None
        condition = map_wmo_code(wmo_code)

        is_day_raw = curr_raw.get("is_day")
        is_day = bool(is_day_raw) if isinstance(is_day_raw, (int, float, bool)) else None

        current = CurrentWeather(
            condition=condition,
            weather_code=wmo_code,
            cloud_cover_percent=cloud_pct,
            temperature_c=temp_c,
            precipitation_mm=precip_mm,
            is_day=is_day,
        )

        # Hourly forecast parsing
        hourly_points: List[HourlyWeatherPoint] = []
        times = hourly_raw.get("time", [])
        temps = hourly_raw.get("temperature_2m", [])
        precips = hourly_raw.get("precipitation", [])
        codes = hourly_raw.get("weather_code", [])
        clouds = hourly_raw.get("cloud_cover", [])

        if isinstance(times, list):
            for idx, t_str in enumerate(times):
                if not t_str:
                    continue
                h_temp = _validate_float(temps[idx]) if idx < len(temps) else None
                h_precip = _validate_float(precips[idx], min_val=0.0) if idx < len(precips) else None
                h_cloud = _validate_float(clouds[idx], min_val=0.0, max_val=100.0) if idx < len(clouds) else None
                h_code_raw = codes[idx] if idx < len(codes) else None
                h_wmo = int(h_code_raw) if isinstance(h_code_raw, (int, float)) and not isinstance(h_code_raw, bool) else None
                h_cond = map_wmo_code(h_wmo)

                hourly_points.append(HourlyWeatherPoint(
                    time=str(t_str),
                    condition=h_cond,
                    weather_code=h_wmo,
                    cloud_cover_percent=h_cloud,
                    temperature_c=h_temp,
                    precipitation_mm=h_precip,
                ))

        # Daily Sunrise / Sunset
        sunrises = daily_raw.get("sunrise", [])
        sunsets = daily_raw.get("sunset", [])
        sunrise_iso = str(sunrises[0]) if isinstance(sunrises, list) and sunrises else None
        sunset_iso = str(sunsets[0]) if isinstance(sunsets, list) and sunsets else None

        sun = SunData(sunrise=sunrise_iso, sunset=sunset_iso)

        utc_offset = int(raw_data.get("utc_offset_seconds", 0))
        tz_resp = str(raw_data.get("timezone", location.timezone or "UTC"))
        now_iso = datetime.now(timezone.utc).isoformat()

        return ProviderWeatherPayload(
            provider="open_meteo",
            observed_at=now_iso,
            fetched_at=now_iso,
            timezone=tz_resp,
            utc_offset_seconds=utc_offset,
            sun=sun,
            current=current,
            hourly=hourly_points,
        )
