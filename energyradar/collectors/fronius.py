"""Collector für den Fronius-Wechselrichter.

Einzige Verantwortung: Daten beschaffen und als EnergyReading zurückgeben.
Keine Bewertung, keine Speicherung.
"""

import math
import random
from datetime import datetime
from urllib.parse import urlsplit

import requests

from energyradar import config
from energyradar.models.energy import EnergyReading
from energyradar.services import data_source


def read() -> EnergyReading:
    """Liest Live-Daten von der Fronius Solar API."""
    selected = data_source.effective()
    if not selected:
        raise RuntimeError("FRONIUS_URL is not configured")
    return read_url(
        selected["url"],
        require_local=selected["source"] != "environment",
    )


def read_url(url: str, *, require_local: bool = True) -> EnergyReading:
    """Read one endpoint with redirect and SSRF protection.

    UI-managed targets must resolve only to local/private addresses. The
    environment override is an explicit trusted-operator escape hatch, but it
    still permits only HTTP(S), forbids embedded credentials and redirects.
    """
    if require_local:
        target = data_source.normalize_address(url)
        data_source.validate_resolved_target(target)
    else:
        parts = urlsplit(url)
        if (
            parts.scheme.lower() not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
        ):
            raise ValueError("Invalid FRONIUS_URL override")
        target = url

    response = requests.get(
        target,
        timeout=(1.5, 3.0),
        allow_redirects=False,
    )
    response.raise_for_status()
    raw = response.json()
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
