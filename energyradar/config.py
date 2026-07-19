import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

FRONIUS_URL = os.environ.get("FRONIUS_URL")

DEMO = os.environ.get("ENERGYRADAR_DEMO") == "1"


def _user_data_dir() -> Path:
    """Beschreibbares, benutzerspezifisches Verzeichnis fürs Betriebssystem."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "EnergyRadar"
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / "EnergyRadar"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "EnergyRadar"


# Als gepackte App (PyInstaller) liegt das Bundle schreibgeschützt vor, deshalb
# gehören Datenbank und Log in ein beschreibbares Benutzerverzeichnis. In der
# Entwicklung bleibt alles wie bisher im Projektordner.
USER_DATA_DIR = _user_data_dir()
DATA_DIR = USER_DATA_DIR if getattr(sys, "frozen", False) else BASE_DIR

# Die lokale Geräteadresse ist immer benutzerspezifisch. Sie darf auch im
# Entwicklungsmodus niemals versehentlich im Repository landen.
DATA_SOURCE_CONFIG_PATH = USER_DATA_DIR / "data-source.json"

DB_PATH = DATA_DIR / "database" / "energy.db"

# Messwerte höchstens einmal pro Minute persistieren
STORE_INTERVAL_SECONDS = 60

HOST = os.environ.get("ENERGYRADAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("ENERGYRADAR_PORT", "5000"))
DEBUG = os.environ.get("ENERGYRADAR_DEBUG") == "1"
