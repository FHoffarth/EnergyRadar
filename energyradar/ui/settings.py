"""UI-Einstellungen für EnergyRadar – Persistenz.

Verwaltet: Aktualisierungsintervall, Theme, MT175-Adresse.
Die Fronius-Adresse wird weiterhin über services.data_source verwaltet.

Speicherort: DATA_DIR / ui-settings.json
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULTS = {
    "refresh_seconds": 5,
    "theme": "dark",   # "dark" | "light" | "system"
    "mt175_address": "",
}


def _settings_path() -> Path:
    """Lazy import um zirkuläre Imports mit config zu vermeiden."""
    import config
    return config.USER_DATA_DIR / "ui-settings.json"


@dataclass
class UISettings:
    refresh_seconds: int = 5
    theme: str = "dark"
    mt175_address: str = ""


def load() -> UISettings:
    """Gespeicherte Einstellungen laden; bei Fehler Standardwerte."""
    path = _settings_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        refresh = int(raw.get("refresh_seconds", _DEFAULTS["refresh_seconds"]))
        refresh = max(3, min(60, refresh))
        theme = raw.get("theme", _DEFAULTS["theme"])
        if theme not in ("dark", "light", "system"):
            theme = "dark"
        mt175 = str(raw.get("mt175_address", "")).strip()
        return UISettings(refresh_seconds=refresh, theme=theme, mt175_address=mt175)
    except (OSError, ValueError, KeyError, TypeError):
        return UISettings()


def save(settings: UISettings) -> None:
    """Einstellungen atomar in JSON schreiben."""
    path = _settings_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(settings), indent=2, ensure_ascii=False),
                        encoding="utf-8")
    except OSError as exc:
        log.warning("ui-settings.json konnte nicht gespeichert werden: %s", exc)
