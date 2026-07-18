"""Collector für den Fronius-Wechselrichter.

Einzige Verantwortung: Daten beschaffen und als EnergyReading zurückgeben.
Keine Bewertung, keine Speicherung.
"""

import math
import random
from datetime import datetime

import requests

import config
from models.energy import EnergyReading


def read() -> EnergyReading:
    """Liest Live-Daten von der Fronius Solar API."""
    raw = requests.get(config.FRONIUS_URL, timeout=5).json()
    site = raw["Body"]["Data"]["Site"]
    return EnergyReading(
        timestamp=datetime.now(),
        power=site.get("P_PV") or 0,  # nachts liefert Fronius null
        energy_today=site.get("E_Day") or 0,
        energy_year=site.get("E_Year") or 0,
        energy_total=site.get("E_Total") or 0,
    )


def read_demo() -> EnergyReading:
    """Demo-Quelle: plausible Werte ohne Wechselrichter (ENERGYRADAR_DEMO=1)."""
    now = datetime.now()
    return EnergyReading(
        timestamp=now,
        power=_demo_power(now),
        energy_today=7640 + now.hour * 120 + now.minute * 2,
        energy_year=1_612_000,
        energy_total=1_749_000,
    )


def demo_history(now: datetime) -> list[EnergyReading]:
    """Synthetische Tageskurve bis jetzt, damit Diagramm und Peak im
    Demo-Modus sofort etwas zeigen (ein Messwert pro Minute)."""
    readings = []
    minutes = now.hour * 60 + now.minute
    for m in range(0, minutes, 1):
        ts = now.replace(hour=m // 60, minute=m % 60, second=0, microsecond=0)
        readings.append(EnergyReading(
            timestamp=ts,
            power=_demo_power(ts),
            energy_today=0,
            energy_year=1_612_000,
            energy_total=1_749_000,
        ))
    return readings


def _demo_power(ts: datetime) -> float:
    """Glockenkurve über den Tag (Sonnenverlauf) plus leichtes Rauschen."""
    hour = ts.hour + ts.minute / 60
    if hour < 6 or hour > 21.5:
        return 0
    base = 3800 * math.sin(math.pi * (hour - 6) / 15.5) ** 2
    return max(0, base + random.uniform(-200, 200))
