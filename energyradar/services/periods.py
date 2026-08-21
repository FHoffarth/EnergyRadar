"""Authoritative counter-anchor period calculations.

Power samples are intentionally absent from this module. They describe curve
shape only and can never become factual energy totals here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import sqlite3
from typing import Any
from zoneinfo import ZoneInfo

from energyradar import config
from energyradar.services import migration

BATTERY_FREE_TOPOLOGY = "battery_free_single_pv"


def _utc(value: datetime | str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        raise ValueError("period timestamps must include an offset")
    return parsed.astimezone(timezone.utc)


def _text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _metric(
    value: Decimal | None,
    state: str,
    reason: str | None,
    *,
    coverage_state: str | None = None,
    period_key: str | None = None,
    source_id: int | None = None,
    epoch_id: int | None = None,
) -> dict[str, Any]:
    return {
        "value_kwh": format(value, "f") if value is not None else None,
        "state": state,
        "coverage_state": coverage_state or ("partial" if state == "partial" else "complete" if state in {"fresh", "zero"} else "unavailable"),
        "reason": reason,
        "source": "counter_anchor_delta" if value is not None else "unavailable",
        "provenance": "trusted_counter_anchors" if value is not None else None,
        "period_key": period_key,
        "source_id": source_id,
        "epoch_id": epoch_id,
        "no_extrapolation": True,
    }


def _reading(con: sqlite3.Connection, anchor_id: int, register: str) -> list[sqlite3.Row]:
    return con.execute(
        """SELECT cr.*, ds.source_uuid, ds.provider
           FROM counter_readings cr JOIN device_sources ds ON ds.source_id = cr.source_id
           WHERE cr.anchor_id = ? AND cr.register_name = ? ORDER BY cr.source_id""",
        (anchor_id, register),
    ).fetchall()


def _delta(con: sqlite3.Connection, start_id: int, end_id: int, register: str, *, partial: bool, period_key: str) -> dict[str, Any]:
    starts = _reading(con, start_id, register)
    ends = _reading(con, end_id, register)
    if not starts or not ends:
        provider = "fronius" if register == "pv_total" else "tasmota"
        failed = con.execute(
            """SELECT 1 FROM anchor_source_results asr
               JOIN device_sources ds ON ds.source_id = asr.source_id
               WHERE asr.anchor_id IN (?, ?) AND ds.provider = ? AND asr.status = 'failed'
               LIMIT 1""",
            (start_id, end_id, provider),
        ).fetchone()
        if failed:
            return _metric(None, "provider_unavailable", f"{register}_provider_unavailable")
        return _metric(None, "no_data_yet", f"{register}_anchor_missing")
    pairs = [(a, b) for a in starts for b in ends if a["source_id"] == b["source_id"]]
    if not pairs:
        return _metric(None, "incompatible_period", f"{register}_source_identity_changed")
    start, end = pairs[0]
    if start["epoch_id"] != end["epoch_id"]:
        return _metric(None, "counter_reset", f"{register}_counter_epoch_changed", source_id=int(start["source_id"]))
    value = Decimal(end["value_decimal"]) - Decimal(start["value_decimal"])
    if value < 0:
        return _metric(None, "counter_reset", f"{register}_negative_delta", source_id=int(start["source_id"]), epoch_id=int(start["epoch_id"]))
    state = "zero" if value == 0 else "partial" if partial else "fresh"
    return _metric(
        value,
        state,
        None,
        coverage_state="partial" if partial else "complete",
        period_key=period_key,
        source_id=int(start["source_id"]),
        epoch_id=int(start["epoch_id"]),
    )


# --------------------------------------------------------------------------- #
# Stored-sample-counter fallback
#
# The authoritative source remains synchronized counter anchors. When no anchor
# pair covers a period (e.g. all history predates continuous recording), we may
# still hold *real cumulative counters* in energy_samples_v1. These are genuine
# device registers, not integrated power, so an exact delta over their captured
# endpoints is a truthful — if lower-confidence — summary. It is always labelled
# `stored_sample_counter_delta` and never overrides a valid anchor value, and it
# never invents a curve or a kWh from instantaneous power.
# --------------------------------------------------------------------------- #

_SAMPLE_TS_FMT = "%Y-%m-%d %H:%M:%S"


def _sample_metric(
    value_kwh: Decimal | None,
    reason: str | None,
    *,
    period_key: str | None = None,
) -> dict[str, Any]:
    has_value = value_kwh is not None
    return {
        # normalize() drops the trailing-zero noise a Wh→kWh division leaves,
        # matching the anchor path's formatting (e.g. "12" not "12.0").
        "value_kwh": format(value_kwh.normalize(), "f") if has_value else None,
        # Sample counters are exact for their endpoints but coverage between
        # observations is unproven, so the strongest state they earn is partial.
        "state": ("zero" if value_kwh == 0 else "partial") if has_value else "unavailable",
        "coverage_state": "partial" if has_value else "unavailable",
        "reason": reason,
        "source": "stored_sample_counter_delta" if has_value else "unavailable",
        "provenance": "stored_sample_counters" if has_value else None,
        "confidence": "legacy_sample" if has_value else None,
        "period_key": period_key,
        "source_id": None,
        "epoch_id": None,
        "no_extrapolation": True,
    }


def _cumulative_delta(
    con: sqlite3.Connection, column: str, from_text: str, to_text: str, register: str
) -> dict[str, Any]:
    """Exact delta of a lifetime-cumulative Wh register over the period."""
    rows = con.execute(
        f"""SELECT measured_at, {column} FROM energy_samples_v1
            WHERE measured_at >= ? AND measured_at <= ? AND {column} IS NOT NULL
            ORDER BY measured_at""",
        (from_text, to_text),
    ).fetchall()
    if len(rows) < 2:
        return _sample_metric(None, f"{register}_sample_counter_insufficient")
    first_at, first_val = rows[0][0], Decimal(str(rows[0][1]))
    last_at, last_val = rows[-1][0], Decimal(str(rows[-1][1]))
    delta = last_val - first_val
    if delta < 0:
        # Lifetime registers never decrease; a drop means a reset/replacement.
        return _sample_metric(None, f"{register}_counter_reset_or_negative_delta")
    return _sample_metric(
        delta / Decimal(1000),
        None,
        period_key=f"sample:{first_at}|sample:{last_at}",
    )


def _pv_daily_delta(
    con: sqlite3.Connection, from_text: str, to_text: str, timezone_name: str
) -> dict[str, Any]:
    """Generation from the daily-resetting E_Day register.

    E_Day resets at local midnight, so it is summed per *local* day as the
    observed increase between that day's first and last sample. Never summed
    across a reset (that would double count) and never extrapolated over
    unobserved parts of a day.
    """
    rows = con.execute(
        """SELECT measured_at, pv_energy_today_wh FROM energy_samples_v1
           WHERE measured_at >= ? AND measured_at <= ? AND pv_energy_today_wh IS NOT NULL
           ORDER BY measured_at""",
        (from_text, to_text),
    ).fetchall()
    if len(rows) < 2:
        return _sample_metric(None, "pv_sample_counter_insufficient")
    local = ZoneInfo(timezone_name)
    by_day: dict[str, list[Decimal]] = {}
    order: dict[str, tuple[str, str]] = {}
    for measured_at, value in rows:
        moment = datetime.strptime(measured_at, _SAMPLE_TS_FMT).replace(tzinfo=timezone.utc)
        day = moment.astimezone(local).date().isoformat()
        by_day.setdefault(day, []).append(Decimal(str(value)))
        first_at = order.get(day, (measured_at, measured_at))[0]
        order[day] = (first_at, measured_at)
    total = Decimal(0)
    contributing_days = 0
    for day, values in by_day.items():
        if len(values) < 2:
            continue
        day_delta = values[-1] - values[0]
        if day_delta < 0:
            # Mid-day decrease implies a reset/anomaly; skip rather than guess.
            continue
        total += day_delta
        contributing_days += 1
    if contributing_days == 0:
        return _sample_metric(None, "pv_sample_counter_insufficient")
    first_day = min(order)
    last_day = max(order)
    return _sample_metric(
        total / Decimal(1000),
        None,
        period_key=f"sample:{order[first_day][0]}|sample:{order[last_day][1]}",
    )


def _sample_counter_fallback(
    con: sqlite3.Connection,
    requested_from: datetime,
    requested_to: datetime,
    topology: str,
    *,
    timezone_name: str,
) -> dict[str, dict[str, Any]]:
    """Best-effort truthful summary from stored sample counters.

    Returns a metric dict per register. A register with `value_kwh is None`
    contributed no usable fallback and must leave the anchor result untouched.
    """
    from_text = requested_from.astimezone(timezone.utc).strftime(_SAMPLE_TS_FMT)
    to_text = requested_to.astimezone(timezone.utc).strftime(_SAMPLE_TS_FMT)
    pv = _pv_daily_delta(con, from_text, to_text, timezone_name)
    imported = _cumulative_delta(con, "grid_import_total_wh", from_text, to_text, "grid_import")
    exported = _cumulative_delta(con, "grid_export_total_wh", from_text, to_text, "grid_export")

    house = _sample_metric(None, "house_dependency_stored_sample_counter_insufficient")
    direct = _sample_metric(None, "self_consumption_dependency_stored_sample_counter_insufficient")
    if topology == BATTERY_FREE_TOPOLOGY:
        if all(m["value_kwh"] is not None for m in (pv, imported, exported)):
            balance = Decimal(pv["value_kwh"]) + Decimal(imported["value_kwh"]) - Decimal(exported["value_kwh"])
            house = (
                _sample_metric(balance, None, period_key=pv["period_key"])
                if balance >= 0
                else _sample_metric(None, "house_consumption_negative")
            )
        if all(m["value_kwh"] is not None for m in (pv, exported)):
            direct_value = Decimal(pv["value_kwh"]) - Decimal(exported["value_kwh"])
            direct = (
                _sample_metric(direct_value, None, period_key=pv["period_key"])
                if direct_value >= 0
                else _sample_metric(None, "pv_generation_lower_than_export")
            )
    return {
        "pv_generation": pv,
        "grid_import": imported,
        "grid_export": exported,
        "house_consumption": house,
        "direct_self_consumption": direct,
    }


def calculate_period(
    from_utc: datetime | str,
    to_utc: datetime | str,
    *,
    topology: str | None = None,
    database_path=None,
    now_utc: datetime | str | None = None,
) -> dict[str, Any]:
    topology = topology or config.SITE_TOPOLOGY
    requested_from, requested_to = _utc(from_utc), _utc(to_utc)
    if requested_to <= requested_from:
        raise ValueError("period end must be after start")
    migration.run_migrations()
    con = sqlite3.connect(database_path or config.DB_PATH, timeout=migration.BUSY_TIMEOUT_MS / 1000)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(f"PRAGMA busy_timeout = {migration.BUSY_TIMEOUT_MS}")
    try:
        anchors = con.execute(
            """SELECT * FROM counter_anchors
               WHERE completed_at_utc >= ? AND completed_at_utc <= ? AND status != 'failed'
               ORDER BY sequence""",
            (_text(requested_from), _text(requested_to)),
        ).fetchall()
        base = {
            "requested_period": {"from": _text(requested_from), "to": _text(requested_to)},
            "topology": topology,
            "no_extrapolation": True,
        }
        metric_names = ("pv_generation", "grid_import", "grid_export", "house_consumption", "direct_self_consumption")
        if len(anchors) < 2:
            # No synchronized anchor pair. Before declaring "no data", check for
            # real stored counters — a truthful, lower-confidence summary from a
            # single, self-consistent source (never mixed with anchors).
            fallback = _sample_counter_fallback(
                con, requested_from, requested_to, topology, timezone_name=config.MT175_TIMEZONE
            )
            if not any(item["value_kwh"] is not None for item in fallback.values()):
                unavailable = _metric(None, "no_data_yet", "two_compatible_anchors_required")
                return {**base, "actual_period": None, "start_anchor": None, "end_anchor": None, "freshness": {"state": "no_data_yet", "last_anchor_at": None, "age_seconds": None}, "metrics": {name: dict(unavailable) for name in metric_names}, "gaps": []}
            window = con.execute(
                """SELECT MIN(measured_at), MAX(measured_at) FROM energy_samples_v1
                   WHERE measured_at >= ? AND measured_at <= ?
                     AND (pv_energy_today_wh IS NOT NULL OR grid_import_total_wh IS NOT NULL
                          OR grid_export_total_wh IS NOT NULL)""",
                (
                    requested_from.astimezone(timezone.utc).strftime(_SAMPLE_TS_FMT),
                    requested_to.astimezone(timezone.utc).strftime(_SAMPLE_TS_FMT),
                ),
            ).fetchone()

            def _window_text(value):
                if not value:
                    return None
                return _text(datetime.strptime(value, _SAMPLE_TS_FMT).replace(tzinfo=timezone.utc))

            actual = None
            if window and window[0]:
                actual = {"from": _window_text(window[0]), "to": _window_text(window[1]), "state": "partial"}
            gaps = [dict(row) for row in con.execute(
                "SELECT scope, from_utc, to_utc, reason, details_json FROM recording_gaps WHERE to_utc >= ? AND from_utc <= ? ORDER BY from_utc",
                (_text(requested_from), _text(requested_to)),
            ).fetchall()]
            return {
                **base,
                "actual_period": actual,
                "start_anchor": None,
                "end_anchor": None,
                "freshness": {"state": "stored_sample_only", "last_anchor_at": None, "age_seconds": None},
                "source_precedence": "stored_sample_counters",
                "metrics": {name: dict(fallback[name]) for name in metric_names},
                "gaps": gaps,
            }

        start, end = anchors[0], anchors[-1]
        actual_from = _utc(start["completed_at_utc"])
        actual_to = _utc(end["completed_at_utc"])
        freshness_now = _utc(now_utc) if now_utc is not None else datetime.now(timezone.utc)
        freshness_age = max(Decimal("0"), Decimal(str((freshness_now - actual_to).total_seconds())))
        freshness = {
            "state": "fresh" if freshness_age <= Decimal("180") else "stale",
            "last_anchor_at": _text(actual_to),
            "age_seconds": format(freshness_age, "f"),
        }
        partial = actual_from > requested_from or actual_to < requested_to
        period_key = f"anchor:{start['anchor_id']}|anchor:{end['anchor_id']}"
        pv = _delta(con, int(start["anchor_id"]), int(end["anchor_id"]), "pv_total", partial=partial, period_key=period_key)
        imported = _delta(con, int(start["anchor_id"]), int(end["anchor_id"]), "grid_import_total", partial=partial, period_key=period_key)
        exported = _delta(con, int(start["anchor_id"]), int(end["anchor_id"]), "grid_export_total", partial=partial, period_key=period_key)

        topology_ok = topology == BATTERY_FREE_TOPOLOGY
        dependencies = (pv, imported, exported)
        direct_dependencies = (pv, exported)
        if not topology_ok:
            house = _metric(None, "metric_unsupported", "battery_free_topology_not_confirmed")
            direct = _metric(None, "metric_unsupported", "battery_free_topology_not_confirmed")
        elif any(item["value_kwh"] is None for item in dependencies):
            reason = next(item["reason"] for item in dependencies if item["value_kwh"] is None)
            state = next(item["state"] for item in dependencies if item["value_kwh"] is None)
            house = _metric(None, state, f"house_dependency_{reason}")
        else:
            pv_value = Decimal(pv["value_kwh"])
            import_value = Decimal(imported["value_kwh"])
            export_value = Decimal(exported["value_kwh"])
            house_value = pv_value + import_value - export_value
            worst_partial = partial or any(item["state"] == "partial" for item in dependencies)
            if house_value < 0:
                house = _metric(None, "invalid_balance", "house_consumption_negative")
            else:
                house = _metric(
                    house_value,
                    "zero" if house_value == 0 else "partial" if worst_partial else "fresh",
                    None,
                    coverage_state="partial" if worst_partial else "complete",
                    period_key=period_key,
                )

        if not topology_ok:
            direct = _metric(None, "metric_unsupported", "battery_free_topology_not_confirmed")
        elif any(item["value_kwh"] is None for item in direct_dependencies):
            reason = next(item["reason"] for item in direct_dependencies if item["value_kwh"] is None)
            state = next(item["state"] for item in direct_dependencies if item["value_kwh"] is None)
            direct = _metric(None, state, f"self_consumption_dependency_{reason}")
        else:
            pv_value = Decimal(pv["value_kwh"])
            export_value = Decimal(exported["value_kwh"])
            direct_value = pv_value - export_value
            worst_partial = partial or any(item["state"] == "partial" for item in direct_dependencies)
            if direct_value < 0:
                direct = _metric(None, "invalid_balance", "pv_generation_lower_than_export")
            else:
                direct = _metric(
                    direct_value,
                    "zero" if direct_value == 0 else "partial" if worst_partial else "fresh",
                    None,
                    coverage_state="partial" if worst_partial else "complete",
                    period_key=period_key,
                )

        source_rows = con.execute(
            """SELECT asr.*, ds.source_uuid, ds.provider FROM anchor_source_results asr
               JOIN device_sources ds ON ds.source_id = asr.source_id
               WHERE asr.anchor_id IN (?, ?) ORDER BY asr.anchor_id, asr.source_id""",
            (start["anchor_id"], end["anchor_id"]),
        ).fetchall()
        gaps = [dict(row) for row in con.execute(
            "SELECT scope, from_utc, to_utc, reason, details_json FROM recording_gaps WHERE to_utc >= ? AND from_utc <= ? ORDER BY from_utc",
            (_text(requested_from), _text(requested_to)),
        ).fetchall()]
        return {
            **base,
            "actual_period": {"from": _text(actual_from), "to": _text(actual_to), "state": "partial" if partial else "fresh"},
            "freshness": freshness,
            "start_anchor": {"id": int(start["anchor_id"]), "status": start["status"], "skew_ms": start["skew_ms"], "sequence": int(start["sequence"])},
            "end_anchor": {"id": int(end["anchor_id"]), "status": end["status"], "skew_ms": end["skew_ms"], "sequence": int(end["sequence"])},
            "source_observations": [dict(row) for row in source_rows],
            "metrics": {"pv_generation": pv, "grid_import": imported, "grid_export": exported, "house_consumption": house, "direct_self_consumption": direct},
            "gaps": gaps,
        }
    finally:
        con.close()


def economy_basis(report: dict[str, Any], *, timezone_name: str) -> dict[str, Any]:
    actual = report.get("actual_period") or report["requested_period"]
    start = _utc(actual["from"])
    end = _utc(actual["to"])
    local_zone = ZoneInfo(timezone_name)
    metrics = report["metrics"]
    return {
        "period": {
            "from": actual["from"], "to": actual["to"], "timezone": timezone_name,
            "local_date_from": start.astimezone(local_zone).date().isoformat(),
            "local_date_to": end.astimezone(local_zone).date().isoformat(),
        },
        "solar_generation": metrics["pv_generation"],
        "grid_import": metrics["grid_import"],
        "grid_export": metrics["grid_export"],
        "house_consumption": metrics["house_consumption"],
    }
