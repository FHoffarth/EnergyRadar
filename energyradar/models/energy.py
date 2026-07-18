from dataclasses import dataclass
from datetime import datetime


@dataclass
class EnergyReading:
    """Ein einzelner Messwert der PV-Anlage. Alle Energiewerte in Wh, Leistung in W."""

    timestamp: datetime
    power: float
    energy_today: float
    energy_year: float
    energy_total: float
