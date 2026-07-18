"""Storage.

Einzige Verantwortung: SQLite. Anlegen, Schreiben (gedrosselt), Lesen.
"""

import sqlite3
from datetime import datetime

import config
from models.energy import EnergyReading

_SCHEMA = """
CREATE TABLE IF NOT EXISTS production (
    timestamp     TEXT PRIMARY KEY,
    power         REAL NOT NULL,
    energy_today  REAL NOT NULL,
    energy_year   REAL NOT NULL,
    energy_total  REAL NOT NULL
);
"""

_TS_FORMAT = "%Y-%m-%d %H:%M:%S"


def _connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(config.DB_PATH)
    con.execute(_SCHEMA)
    return con


def save(reading: EnergyReading) -> bool:
    """Speichert einen Messwert, höchstens einmal pro STORE_INTERVAL_SECONDS.
    Gibt True zurück, wenn tatsächlich gespeichert wurde."""
    with _connect() as con:
        row = con.execute("SELECT MAX(timestamp) FROM production").fetchone()
        last = row[0]
        if last is not None:
            last_dt = datetime.strptime(last, _TS_FORMAT)
            age = (reading.timestamp - last_dt).total_seconds()
            if age < config.STORE_INTERVAL_SECONDS:
                return False
        _insert(con, reading)
    return True


def save_many(readings: list[EnergyReading]) -> None:
    with _connect() as con:
        for reading in readings:
            _insert(con, reading)


def has_data_for_today() -> bool:
    with _connect() as con:
        row = con.execute(
            "SELECT COUNT(*) FROM production "
            "WHERE date(timestamp) = date('now', 'localtime')"
        ).fetchone()
    return row[0] > 0


def peak_today() -> tuple[float, str] | None:
    """Höchste Leistung des heutigen Tages als (Watt, 'HH:MM')."""
    with _connect() as con:
        row = con.execute(
            "SELECT power, timestamp FROM production "
            "WHERE date(timestamp) = date('now', 'localtime') "
            "ORDER BY power DESC, timestamp ASC LIMIT 1"
        ).fetchone()
    if row is None:
        return None
    power, ts = row
    time_str = datetime.strptime(ts, _TS_FORMAT).strftime("%H:%M")
    return power, time_str


def history_today() -> list[dict]:
    """Leistungsverlauf des heutigen Tages, chronologisch."""
    with _connect() as con:
        rows = con.execute(
            "SELECT timestamp, power FROM production "
            "WHERE date(timestamp) = date('now', 'localtime') "
            "ORDER BY timestamp ASC"
        ).fetchall()
    return [
        {
            "time": datetime.strptime(ts, _TS_FORMAT).strftime("%H:%M"),
            "power": round(power),
        }
        for ts, power in rows
    ]


def _insert(con: sqlite3.Connection, reading: EnergyReading) -> None:
    con.execute(
        "INSERT OR REPLACE INTO production "
        "(timestamp, power, energy_today, energy_year, energy_total) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            reading.timestamp.strftime(_TS_FORMAT),
            reading.power,
            reading.energy_today,
            reading.energy_year,
            reading.energy_total,
        ),
    )
