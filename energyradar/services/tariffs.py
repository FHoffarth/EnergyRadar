"""Validated, additive tariff periods for Solar Economy calculations.

Validity is date based and inclusive on both ends.  Therefore a period ending
on 2026-03-31 and one starting on 2026-04-01 are adjacent, not overlapping.
Decimal values are stored as canonical text so SQLite never converts money to
binary floating point.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import sqlite3
from typing import Any

from energyradar import config
from energyradar.services import migration


TARIFF_TYPES = {"grid_work_price", "feed_in_tariff", "base_price"}
SOURCE_TYPES = {
    "user_entry", "invoice", "contract", "other",
    "grid_operator_statement", "feed_in_invoice",
    "provisional_user_assumption",
}


class TariffValidationError(ValueError):
    pass


class TariffOverlapError(TariffValidationError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _date(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise TariffValidationError(f"{field} muss ein gültiges Datum sein.") from exc


def _decimal(value: Any, field: str) -> str:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise TariffValidationError(f"{field} muss eine gültige Dezimalzahl sein.") from exc
    if not result.is_finite() or result < 0:
        raise TariffValidationError(f"{field} muss eine nicht-negative Dezimalzahl sein.")
    return format(result.normalize() if result else Decimal("0"), "f")


def validate_record(data: dict[str, Any]) -> dict[str, Any]:
    tariff_type = str(data.get("tariff_type") or "")
    if tariff_type not in TARIFF_TYPES:
        raise TariffValidationError("Unbekannter Tariftyp.")
    valid_from = _date(data.get("valid_from"), "valid_from")
    if valid_from is None:
        raise TariffValidationError("valid_from ist erforderlich.")
    valid_until = _date(data.get("valid_until"), "valid_until")
    if valid_until is not None and valid_until < valid_from:
        raise TariffValidationError("valid_until darf nicht vor valid_from liegen.")
    source_type = str(data.get("source_type") or "user_entry")
    if source_type not in SOURCE_TYPES:
        raise TariffValidationError("Unbekannte Tarifquelle.")
    provisional = data.get("provisional", False)
    if not isinstance(provisional, bool):
        raise TariffValidationError("provisional muss ein Boolean sein.")
    if source_type == "provisional_user_assumption":
        provisional = True

    value_ct = annual_eur = None
    if tariff_type == "base_price":
        annual_eur = _decimal(data.get("annual_eur"), "annual_eur")
    else:
        value_ct = _decimal(data.get("value_ct_per_kwh"), "value_ct_per_kwh")

    label = " ".join(str(data.get("label") or "").split()) or None
    if label and len(label) > 120:
        raise TariffValidationError("Die Tarifbezeichnung ist zu lang.")
    return {
        "tariff_type": tariff_type,
        "value_ct_per_kwh": value_ct,
        "annual_eur": annual_eur,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "label": label,
        "source_type": source_type,
        "provisional": provisional,
    }


def _connect() -> sqlite3.Connection:
    migration.run_migrations()
    con = sqlite3.connect(config.DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(f"PRAGMA busy_timeout = {migration.BUSY_TIMEOUT_MS}")
    return con


def _overlap(con: sqlite3.Connection, record: dict[str, Any], exclude_id: int | None = None) -> bool:
    end = record["valid_until"] or "9999-12-31"
    params: list[Any] = [record["tariff_type"], end, record["valid_from"]]
    sql = """
        SELECT 1 FROM tariff_periods
        WHERE tariff_type = ?
          AND valid_from <= ?
          AND COALESCE(valid_until, '9999-12-31') >= ?
    """
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    return con.execute(sql, params).fetchone() is not None


def _row(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["provisional"] = bool(result["provisional"])
    return result


def list_records() -> list[dict[str, Any]]:
    with _connect() as con:
        rows = con.execute(
            "SELECT * FROM tariff_periods ORDER BY tariff_type, valid_from, id"
        ).fetchall()
    return [_row(row) for row in rows]


def create_record(data: dict[str, Any]) -> dict[str, Any]:
    record = validate_record(data)
    now = _now()
    with _connect() as con:
        con.execute("BEGIN IMMEDIATE")
        if _overlap(con, record):
            raise TariffOverlapError("Der Zeitraum überschneidet sich mit einem bestehenden Tarif.")
        cursor = con.execute(
            """INSERT INTO tariff_periods
               (tariff_type, value_ct_per_kwh, annual_eur, valid_from, valid_until,
                label, source_type, provisional, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (*record.values(), now, now),
        )
        row = con.execute("SELECT * FROM tariff_periods WHERE id = ?", (cursor.lastrowid,)).fetchone()
        con.commit()
    return _row(row)


def update_record(record_id: int, data: dict[str, Any]) -> dict[str, Any]:
    record = validate_record(data)
    with _connect() as con:
        con.execute("BEGIN IMMEDIATE")
        if con.execute("SELECT 1 FROM tariff_periods WHERE id = ?", (record_id,)).fetchone() is None:
            raise TariffValidationError("Tarif wurde nicht gefunden.")
        if _overlap(con, record, record_id):
            raise TariffOverlapError("Der Zeitraum überschneidet sich mit einem bestehenden Tarif.")
        con.execute(
            """UPDATE tariff_periods SET
               tariff_type = ?, value_ct_per_kwh = ?, annual_eur = ?, valid_from = ?,
               valid_until = ?, label = ?, source_type = ?, provisional = ?, updated_at = ?
               WHERE id = ?""",
            (*record.values(), _now(), record_id),
        )
        row = con.execute("SELECT * FROM tariff_periods WHERE id = ?", (record_id,)).fetchone()
        con.commit()
    return _row(row)


def delete_record(record_id: int) -> bool:
    with _connect() as con:
        cursor = con.execute("DELETE FROM tariff_periods WHERE id = ?", (record_id,))
    return cursor.rowcount == 1


def record_at(tariff_type: str, local_date: date) -> dict[str, Any] | None:
    day = local_date.isoformat()
    with _connect() as con:
        row = con.execute(
            """SELECT * FROM tariff_periods
               WHERE tariff_type = ? AND valid_from <= ?
                 AND COALESCE(valid_until, '9999-12-31') >= ?
               ORDER BY valid_from DESC, id DESC LIMIT 1""",
            (tariff_type, day, day),
        ).fetchone()
    return _row(row) if row else None
