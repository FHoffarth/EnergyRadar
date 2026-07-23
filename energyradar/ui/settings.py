"""UI-Einstellungen für EnergyRadar – Persistenz.

Verwaltet Einstellungen als reine, ungefilterte Nutzerentscheidungen.
Systeminformationen und Laufzeit-Defaults werden zur Laufzeit aufgelöst und NIEMALS
zurück in ui-settings.json geschrieben.
"""
from __future__ import annotations

import json
import logging
import math
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

_SETTINGS_LOCK = threading.RLock()

DEFAULTS: dict[str, Any] = {
    "refresh_seconds": 5,
    "theme": "dark",             # "dark" | "light" | "system"
    "dynamic_bg_enabled": True,
    "motion_mode": "full",        # "full" | "reduced" | "none"
    "text_size": "normal",        # "normal" | "large"
    "number_format": "de-DE",     # "de-DE" | "en-US"
    "location_mode": "none",      # "manual" | "none"
    "location_query": None,
    "latitude": None,
    "longitude": None,
    "weather_enabled": False,
    "export_directory": None,
    "fronius_address": "",
    "mt175_address": "",
    "pv_installed_kwp": None,
}


def _settings_path() -> Path:
    """Lazy Import um zirkuläre Imports mit config zu vermeiden."""
    from energyradar import config
    return config.USER_DATA_DIR / "ui-settings.json"


@dataclass
class UISettings:
    refresh_seconds: Optional[int] = None
    theme: Optional[str] = None
    dynamic_bg_enabled: Optional[bool] = None
    motion_mode: Optional[str] = None
    text_size: Optional[str] = None
    number_format: Optional[str] = None
    location_mode: Optional[str] = None
    location_query: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    weather_enabled: Optional[bool] = None
    export_directory: Optional[str] = None
    fronius_address: Optional[str] = None
    mt175_address: Optional[str] = None
    pv_installed_kwp: Optional[float] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UISettings:
        known_fields = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in data.items() if k in known_fields}
        return cls(**filtered)


def load_raw_dict() -> dict[str, Any]:
    """Lädt das rohe JSON aus ui-settings.json ohne Defaults anzuwenden."""
    path = _settings_path()
    if not path.exists():
        return {}

    with _SETTINGS_LOCK:
        try:
            content = path.read_text(encoding="utf-8")
            if not content.strip():
                return {}
            data = json.loads(content)
            if not isinstance(data, dict):
                raise ValueError("Settings Root muss ein JSON-Objekt sein.")
            return data
        except (json.JSONDecodeError, ValueError) as exc:
            log.warning("ui-settings.json ist korrupt: %s", exc)
            try:
                timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                corrupt_path = path.parent / f"ui-settings.corrupt-{timestamp_str}.json"
                os.replace(path, corrupt_path)
                log.info("Korrupte ui-settings.json nach %s verschoben", corrupt_path)
            except Exception as e:
                log.error("Konnte korrupte Settings-Datei nicht verschieben: %s", e)
            return {}
        except Exception as exc:
            log.warning("ui-settings.json konnte nicht gelesen werden: %s", exc)
            return {}


def load() -> UISettings:
    """Lädt die rohen Nutzerentscheidungen als UISettings Dataclass."""
    return UISettings.from_dict(load_raw_dict())


def resolve_effective(raw_dict: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Löst effektive Einstellungen auf (Rohwerte + Laufzeit-Defaults)."""
    if raw_dict is None:
        raw_dict = load_raw_dict()

    effective = dict(DEFAULTS)
    for k, v in raw_dict.items():
        if k in DEFAULTS and v is not None:
            effective[k] = v
    return effective


def validate_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """Validiert Einstellungs-Updates vor dem Speichern."""
    validated: dict[str, Any] = {}

    for k, v in patch.items():
        if v is None:
            validated[k] = None
            continue

        if k == "refresh_seconds":
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError("refresh_seconds muss eine Zahl sein.")
            validated[k] = max(3, min(60, int(v)))

        elif k == "theme":
            if str(v) not in {"dark", "light", "system"}:
                raise ValueError("Ungültiges Theme.")
            validated[k] = str(v)

        elif k == "dynamic_bg_enabled" or k == "weather_enabled":
            if not isinstance(v, bool):
                raise ValueError(f"{k} muss ein Boolean sein.")
            validated[k] = v

        elif k == "motion_mode":
            if str(v) not in {"full", "reduced", "none"}:
                raise ValueError("Ungültiger motion_mode.")
            validated[k] = str(v)

        elif k == "text_size":
            if str(v) not in {"normal", "large"}:
                raise ValueError("Ungültiges text_size.")
            validated[k] = str(v)

        elif k == "number_format":
            if str(v) not in {"de-DE", "en-US"}:
                raise ValueError("Ungültiges number_format.")
            validated[k] = str(v)

        elif k == "location_mode":
            if str(v) not in {"manual", "none"}:
                raise ValueError("Ungültiger location_mode.")
            validated[k] = str(v)

        elif k in {"latitude", "longitude"}:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
                raise ValueError(f"{k} muss eine gültige Zahl sein.")
            val = float(v)
            if k == "latitude" and not (-90.0 <= val <= 90.0):
                raise ValueError("Latitude muss zwischen -90 und +90 liegen.")
            if k == "longitude" and not (-180.0 <= val <= 180.0):
                raise ValueError("Longitude muss zwischen -180 und +180 liegen.")
            validated[k] = val

        elif k == "pv_installed_kwp":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
                raise ValueError("pv_installed_kwp muss eine gültige Zahl sein.")
            val = float(v)
            if not (0.0 < val <= 1000.0):
                raise ValueError("pv_installed_kwp muss zwischen 0 und 1000 kWp liegen.")
            validated[k] = val

        elif k in {"location_query", "export_directory", "mt175_address", "fronius_address"}:
            val_str = str(v).strip()
            validated[k] = val_str if val_str else None

        else:
            # Unbekannte / künftige Felder unverändert durchreichen
            validated[k] = v

    return validated


def save_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """
    Aktualisiert Einstellungen atomar über Patch-Semantik.
    1. Vorhandenes JSON laden
    2. Validieren
    3. Übermittelte Felder anpassen (erhält unbekannte Felder!)
    4. Atomar speichern (.tmp -> fsync -> replace)
    """
    validated_patch = validate_patch(patch)
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    with _SETTINGS_LOCK:
        current_data = load_raw_dict()
        current_data.update(validated_patch)

        temporary = path.with_suffix(".tmp_settings.json")
        try:
            temporary.write_text(
                json.dumps(current_data, indent=2, ensure_ascii=False, allow_nan=False),
                encoding="utf-8"
            )

            for attempt in range(10):
                try:
                    os.replace(temporary, path)
                    break
                except OSError:
                    if attempt == 9:
                        raise
                    import time
                    time.sleep(0.05)
            log.info("ui-settings.json atomar aktualisiert.")
        except Exception as exc:
            log.error("Fehler beim atomaren Speichern der Settings: %s", exc)
            if temporary.exists():
                try:
                    temporary.unlink()
                except OSError:
                    pass
            raise

    return current_data
