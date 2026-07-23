from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class QualityStatus(str, Enum):
    VALID = "valid"
    PARTIAL = "partial"
    STALE = "stale"
    LOCKED = "locked"
    OFFLINE = "offline"
    INVALID = "invalid"
    LEGACY = "legacy"
    UNKNOWN = "unknown"


@dataclass
class EnergyReading:
    """Ein einzelner Messwert der PV-Anlage. Alle Energiewerte in Wh, Leistung in W."""

    timestamp: datetime
    power: float
    energy_today: float
    energy_year: float
    energy_total: float
