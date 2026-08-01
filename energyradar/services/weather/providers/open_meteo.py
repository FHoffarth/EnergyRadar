"""Open-Meteo WeatherProvider Adapter.

Freier Wetterdienst (CC BY 4.0 Attribution erforderlich).
Liefert Geocoding, aktuelle Wetterwerte und tägliche Sonnenzeiten.
"""
from __future__ import annotations

import json
import logging
import math
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
        from energyradar.services.weather.models import DailyWeatherPoint, HourlyWeatherPoint

        params = urllib.parse.urlencode({
            "latitude": location.latitude,
            "longitude": location.longitude,
            "current": "temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,is_day,wind_speed_10m",
            "hourly": "temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
            "forecast_days": 7,
            "timezone": location.timezone or "auto",
            "wind_speed_unit": "kmh",
        })
        url = f"{FORECAST_URL}?{params}"

        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Open-Meteo API antwortete mit Status {resp.status}")
            raw_data = json.loads(resp.read().decode("utf-8"))

        if not isinstance(raw_data, dict):
            raise RuntimeError("Open-Meteo lieferte kein JSON-Objekt.")
        current_data = raw_data.get("current", {})
        daily_data = raw_data.get("daily", {})
        hourly_data = raw_data.get("hourly", {})
        curr_raw = current_data if isinstance(current_data, dict) else {}
        daily_raw = daily_data if isinstance(daily_data, dict) else {}
        hourly_raw = hourly_data if isinstance(hourly_data, dict) else {}

        # Validierung der Rohwerte
        temp_c = _validate_float(curr_raw.get("temperature_2m"))
        feels_like_c = _validate_float(curr_raw.get("apparent_temperature"))
        wind_speed_kmh = _validate_float(curr_raw.get("wind_speed_10m"), min_val=0.0)
        precip_mm = _validate_float(curr_raw.get("precipitation"), min_val=0.0)
        cloud_pct = _validate_float(curr_raw.get("cloud_cover"), min_val=0.0, max_val=100.0)

        weather_code_raw = curr_raw.get("weather_code")
        wmo_code = (
            int(weather_code_raw)
            if isinstance(weather_code_raw, (int, float))
            and not isinstance(weather_code_raw, bool)
            and math.isfinite(weather_code_raw)
            else None
        )
        condition = map_wmo_code(wmo_code)

        is_day_raw = curr_raw.get("is_day")
        is_day = (
            is_day_raw
            if isinstance(is_day_raw, bool)
            else bool(is_day_raw)
            if isinstance(is_day_raw, (int, float)) and is_day_raw in (0, 1)
            else None
        )

        current = CurrentWeather(
            condition=condition,
            weather_code=wmo_code,
            cloud_cover_percent=cloud_pct,
            temperature_c=temp_c,
            feels_like_c=feels_like_c,
            wind_speed_kmh=wind_speed_kmh,
            precipitation_mm=precip_mm,
            is_day=is_day,
        )

        # Hourly forecast parsing
        hourly_points: List[HourlyWeatherPoint] = []
        times = hourly_raw.get("time", []) if isinstance(hourly_raw.get("time", []), list) else []
        temps = hourly_raw.get("temperature_2m", []) if isinstance(hourly_raw.get("temperature_2m", []), list) else []
        precips = hourly_raw.get("precipitation", []) if isinstance(hourly_raw.get("precipitation", []), list) else []
        precip_probabilities = hourly_raw.get("precipitation_probability", []) if isinstance(hourly_raw.get("precipitation_probability", []), list) else []
        codes = hourly_raw.get("weather_code", []) if isinstance(hourly_raw.get("weather_code", []), list) else []
        clouds = hourly_raw.get("cloud_cover", []) if isinstance(hourly_raw.get("cloud_cover", []), list) else []

        if isinstance(times, list):
            for idx, t_str in enumerate(times):
                if not t_str:
                    continue
                h_temp = _validate_float(temps[idx]) if idx < len(temps) else None
                h_precip = _validate_float(precips[idx], min_val=0.0) if idx < len(precips) else None
                h_precip_probability = (
                    _validate_float(precip_probabilities[idx], min_val=0.0, max_val=100.0)
                    if idx < len(precip_probabilities)
                    else None
                )
                h_cloud = _validate_float(clouds[idx], min_val=0.0, max_val=100.0) if idx < len(clouds) else None
                h_code_raw = codes[idx] if idx < len(codes) else None
                h_wmo = (
                    int(h_code_raw)
                    if isinstance(h_code_raw, (int, float))
                    and not isinstance(h_code_raw, bool)
                    and math.isfinite(h_code_raw)
                    else None
                )
                h_cond = map_wmo_code(h_wmo)

                hourly_points.append(HourlyWeatherPoint(
                    time=str(t_str),
                    condition=h_cond,
                    weather_code=h_wmo,
                    cloud_cover_percent=h_cloud,
                    temperature_c=h_temp,
                    precipitation_mm=h_precip,
                    precipitation_probability_percent=h_precip_probability,
                ))

        # Open-Meteo exposes precipitation probability on the hourly series.
        # Attach the matching current-hour value when possible so the UI can
        # present it without inventing a probability from precipitation amount.
        current_time = curr_raw.get("time")
        if current_time:
            current_hour = next((point for point in hourly_points if point.time == str(current_time)), None)
            if current_hour is not None:
                current.precipitation_probability_percent = (
                    current_hour.precipitation_probability_percent
                )
            hourly_points = [
                point for point in hourly_points if point.time >= str(current_time)
            ]

        # Daily Sunrise / Sunset
        sunrises = daily_raw.get("sunrise", [])
        sunsets = daily_raw.get("sunset", [])

        def _next_sun_event(values: Any) -> Optional[str]:
            if not isinstance(values, list):
                return None
            candidates = [str(value) for value in values if value]
            if current_time:
                candidates = [
                    value for value in candidates if value >= str(current_time)
                ]
            return candidates[0] if candidates else None

        sunrise_iso = _next_sun_event(sunrises)
        sunset_iso = _next_sun_event(sunsets)

        sun = SunData(sunrise=sunrise_iso, sunset=sunset_iso)

        daily_points: List[DailyWeatherPoint] = []
        dates = daily_raw.get("time", []) if isinstance(daily_raw.get("time", []), list) else []
        daily_codes = daily_raw.get("weather_code", []) if isinstance(daily_raw.get("weather_code", []), list) else []
        daily_mins = daily_raw.get("temperature_2m_min", []) if isinstance(daily_raw.get("temperature_2m_min", []), list) else []
        daily_maxes = daily_raw.get("temperature_2m_max", []) if isinstance(daily_raw.get("temperature_2m_max", []), list) else []
        daily_precip = daily_raw.get("precipitation_probability_max", []) if isinstance(daily_raw.get("precipitation_probability_max", []), list) else []
        for idx, date_value in enumerate(dates):
            if not date_value:
                continue
            code_value = daily_codes[idx] if idx < len(daily_codes) else None
            code = (
                int(code_value)
                if isinstance(code_value, (int, float))
                and not isinstance(code_value, bool)
                and math.isfinite(code_value)
                else None
            )
            daily_points.append(DailyWeatherPoint(
                date=str(date_value),
                condition=map_wmo_code(code),
                weather_code=code,
                temperature_min_c=_validate_float(daily_mins[idx]) if idx < len(daily_mins) else None,
                temperature_max_c=_validate_float(daily_maxes[idx]) if idx < len(daily_maxes) else None,
                precipitation_probability_percent=(
                    _validate_float(daily_precip[idx], min_val=0.0, max_val=100.0)
                    if idx < len(daily_precip) else None
                ),
                sunrise=str(sunrises[idx]) if isinstance(sunrises, list) and idx < len(sunrises) and sunrises[idx] else None,
                sunset=str(sunsets[idx]) if isinstance(sunsets, list) and idx < len(sunsets) and sunsets[idx] else None,
            ))

        utc_offset_raw = raw_data.get("utc_offset_seconds", 0)
        utc_offset = (
            int(utc_offset_raw)
            if isinstance(utc_offset_raw, (int, float))
            and not isinstance(utc_offset_raw, bool)
            and math.isfinite(utc_offset_raw)
            else 0
        )
        timezone_raw = raw_data.get("timezone")
        tz_resp = (
            timezone_raw.strip()
            if isinstance(timezone_raw, str) and timezone_raw.strip()
            else location.timezone or "UTC"
        )
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
            daily=daily_points,
        )
