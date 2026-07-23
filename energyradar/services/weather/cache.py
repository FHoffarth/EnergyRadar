"""Atomarer, versionierter Cache für Weather Service."""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Tuple

from energyradar.services.weather.models import CurrentWeather, ProviderWeatherPayload, SunData

log = logging.getLogger(__name__)

CACHE_LOCK = threading.Lock()
CACHE_SCHEMA_VERSION = 1

FRESH_TTL_SECONDS = 1200        # 20 Minuten
STALE_MAX_AGE_SECONDS = 21600   # 6 Stunden


def _cache_path() -> Path:
    from energyradar import config
    return config.USER_DATA_DIR / "weather-cache.json"


def get_location_key(provider: str, latitude: float, longitude: float, tz: str) -> str:
    """Generiert einen stabilen Cache-Schlüssel basierend auf gerundeten Koordinaten."""
    lat_r = round(latitude, 3)
    lon_r = round(longitude, 3)
    return f"{provider}_lat_{lat_r}_lon_{lon_r}_tz_{tz}"


def load_cached_payload(location_key: str) -> Tuple[Optional[ProviderWeatherPayload], str, Optional[int]]:
    """
    Lädt das gecachte ProviderWeatherPayload.
    Rückgabe: (payload, freshness, age_seconds)
    freshness: "fresh" | "stale" | "expired" | "unknown"
    """
    path = _cache_path()
    if not path.exists():
        return None, "unknown", None

    with CACHE_LOCK:
        try:
            content = path.read_text(encoding="utf-8")
            if not content.strip():
                return None, "unknown", None
            data = json.loads(content)
        except Exception as exc:
            log.warning("Wetter-Cache ist korrupt: %s", exc)
            return None, "unknown", None

    if data.get("cache_schema_version") != CACHE_SCHEMA_VERSION:
        return None, "unknown", None

    if data.get("location_key") != location_key:
        return None, "unknown", None

    payload_dict = data.get("payload")
    fetched_at_str = data.get("fetched_at")
    if not isinstance(payload_dict, dict) or not fetched_at_str:
        return None, "unknown", None

    try:
        fetched_dt = datetime.fromisoformat(fetched_at_str)
        now_dt = datetime.now(timezone.utc)
        age = int((now_dt - fetched_dt).total_seconds())
        if age < 0:
            age = 0
    except Exception:
        return None, "unknown", None

    if age <= FRESH_TTL_SECONDS:
        freshness = "fresh"
    elif age <= STALE_MAX_AGE_SECONDS:
        freshness = "stale"
    else:
        freshness = "expired"

    try:
        sun_dict = payload_dict.get("sun", {})
        curr_dict = payload_dict.get("current", {})
        sun = SunData(sunrise=sun_dict.get("sunrise"), sunset=sun_dict.get("sunset"))
        current = CurrentWeather(
            condition=curr_dict.get("condition", "unknown"),
            weather_code=curr_dict.get("weather_code"),
            cloud_cover_percent=curr_dict.get("cloud_cover_percent"),
            temperature_c=curr_dict.get("temperature_c"),
            precipitation_mm=curr_dict.get("precipitation_mm"),
            is_day=curr_dict.get("is_day"),
        )
        payload = ProviderWeatherPayload(
            provider=payload_dict.get("provider", "open_meteo"),
            observed_at=payload_dict.get("observed_at", fetched_at_str),
            fetched_at=fetched_at_str,
            timezone=payload_dict.get("timezone", "UTC"),
            utc_offset_seconds=payload_dict.get("utc_offset_seconds", 0),
            sun=sun,
            current=current,
        )
        return payload, freshness, age
    except Exception as exc:
        log.warning("Gecachtes WeatherPayload konnte nicht deserialisiert werden: %s", exc)
        return None, "unknown", None


def save_cached_payload(location_key: str, payload: ProviderWeatherPayload) -> None:
    """Speichert ProviderWeatherPayload atomar im Cache."""
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    cache_data = {
        "cache_schema_version": CACHE_SCHEMA_VERSION,
        "provider": payload.provider,
        "location_key": location_key,
        "fetched_at": payload.fetched_at,
        "payload": asdict(payload),
    }

    with CACHE_LOCK:
        temp_fd, temp_path = tempfile.mkstemp(
            dir=path.parent, prefix=".tmp_wcache_", suffix=".json"
        )
        try:
            with open(temp_fd, "w", encoding="utf-8") as f:
                json.dump(cache_data, f, indent=2, ensure_ascii=False, allow_nan=False)
                f.flush()
                os.fsync(f.fileno())

            os.replace(temp_path, path)
            log.info("Wetter-Cache atomar gespeichert (%s).", location_key)
        except Exception as exc:
            log.error("Fehler beim Speichern des Wetter-Caches: %s", exc)
            if os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass


def clear_cache() -> None:
    """Löscht den lokalen Wetter-Cache."""
    path = _cache_path()
    with CACHE_LOCK:
        if path.exists():
            try:
                os.remove(path)
                log.info("Wetter-Cache gelöscht.")
            except Exception as exc:
                log.warning("Konnte Wetter-Cache nicht löschen: %s", exc)
