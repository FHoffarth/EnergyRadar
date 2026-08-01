"""Pure Decimal calculations for evidence-bounded Solar Economy estimates."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable


_COVERAGE_RANK = {"complete": 0, "partial": 1, "sparse": 2, "unavailable": 3}
_NOISE_KWH = Decimal("0.000001")


def decimal_text(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return result if result.is_finite() else None


def coverage_state(ratio: Any) -> str:
    value = decimal_text(ratio)
    if value is None or value <= 0:
        return "unavailable"
    if value >= Decimal("0.90"):
        return "complete"
    if value >= Decimal("0.50"):
        return "partial"
    return "sparse"


def _worst(states: Iterable[str]) -> str:
    return max(states, key=lambda state: _COVERAGE_RANK.get(state, 3))


def _money(value: Decimal | None, *, status: str, formula: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "value_eur": format(value, "f") if value is not None else None,
        "coverage_state": status,
        "formula": formula,
        "reason": reason,
    }


def _tariff_for_period(records: list[dict[str, Any]], tariff_type: str, start_day: str, end_day: str) -> dict[str, Any] | None:
    matches = [
        record for record in records
        if record.get("tariff_type") == tariff_type
        and str(record.get("valid_from")) <= start_day
        and str(record.get("valid_until") or "9999-12-31") >= end_day
    ]
    return matches[0] if len(matches) == 1 else None


def _tariff_meta(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "id": record.get("id"),
        "tariff_type": record.get("tariff_type"),
        "value_ct_per_kwh": record.get("value_ct_per_kwh"),
        "annual_eur": record.get("annual_eur"),
        "valid_from": record.get("valid_from"),
        "valid_until": record.get("valid_until"),
        "label": record.get("label"),
        "source_type": record.get("source_type"),
        "provisional": bool(record.get("provisional")),
    }


def _energy_compatibility_reason(
    solar: dict[str, Any],
    solar_value: Decimal | None,
    exported: dict[str, Any],
    export_value: Decimal | None,
) -> str | None:
    """Return the precise reason why PV minus export cannot be calculated."""
    usable_states = {"complete", "partial"}
    if solar_value is None or solar_value < 0 or solar.get("coverage_state") not in usable_states:
        return "solar_energy_unavailable_or_sparse"
    if export_value is None or export_value < 0 or exported.get("coverage_state") not in usable_states:
        return "grid_export_energy_unavailable_or_sparse"
    if not solar.get("period_key") or solar.get("period_key") != exported.get("period_key"):
        return "energy_period_mismatch"
    if not solar.get("source") or solar.get("source") != exported.get("source"):
        return "energy_source_mismatch"
    if not solar.get("provenance") or solar.get("provenance") != exported.get("provenance"):
        return "energy_provenance_mismatch"
    return None


def calculate_period(
    basis: dict[str, Any],
    tariff_records: list[dict[str, Any]],
    *,
    calculated_at: datetime | None = None,
) -> dict[str, Any]:
    """Calculate only values supported by compatible energy and tariff evidence.

    ``basis`` contains ``period`` and the energy keys ``solar_generation``,
    ``grid_import`` and ``grid_export``. Each energy entry exposes a decimal
    ``value_kwh``, source and coverage state. Sparse evidence is deliberately
    withheld rather than extrapolated.
    """
    period = basis.get("period") or {}
    start_day = str(period.get("local_date_from") or "")
    end_day = str(period.get("local_date_to") or start_day)
    calculated = calculated_at or datetime.now(timezone.utc)
    if calculated.tzinfo is None:
        calculated = calculated.replace(tzinfo=timezone.utc)

    grid_tariff = _tariff_for_period(tariff_records, "grid_work_price", start_day, end_day)
    feed_tariff = _tariff_for_period(tariff_records, "feed_in_tariff", start_day, end_day)
    base_tariff = _tariff_for_period(tariff_records, "base_price", start_day, end_day)

    solar = basis.get("solar_generation") or {}
    imported = basis.get("grid_import") or {}
    exported = basis.get("grid_export") or {}
    solar_value = decimal_text(solar.get("value_kwh"))
    import_value = decimal_text(imported.get("value_kwh"))
    export_value = decimal_text(exported.get("value_kwh"))

    def usable(entry: dict[str, Any], value: Decimal | None) -> bool:
        return value is not None and value >= 0 and entry.get("coverage_state") in {"complete", "partial"}

    import_status = str(imported.get("coverage_state") or "unavailable")
    export_status = str(exported.get("coverage_state") or "unavailable")
    solar_status = str(solar.get("coverage_state") or "unavailable")

    import_cost = None
    import_reason = None
    if not usable(imported, import_value):
        import_reason = "energy_unavailable_or_sparse"
    elif grid_tariff is None:
        import_reason = "grid_tariff_missing_or_boundary"
    else:
        import_cost = import_value * Decimal(str(grid_tariff["value_ct_per_kwh"])) / Decimal("100")

    feed_value = None
    feed_reason = None
    if not usable(exported, export_value):
        feed_reason = "energy_unavailable_or_sparse"
    elif feed_tariff is None:
        feed_reason = "feed_in_tariff_missing_or_boundary"
    else:
        feed_value = export_value * Decimal(str(feed_tariff["value_ct_per_kwh"])) / Decimal("100")

    compatibility_reason = _energy_compatibility_reason(
        solar, solar_value, exported, export_value
    )
    self_consumption = None
    self_reason = compatibility_reason
    if compatibility_reason is None:
        candidate = solar_value - export_value
        if candidate < 0 and abs(candidate) <= _NOISE_KWH:
            candidate = Decimal("0")
        if candidate < 0:
            self_reason = "pv_lower_than_export"
        else:
            self_consumption = candidate
    self_status = _worst([solar_status, export_status])
    avoided = None
    avoided_reason = self_reason
    if self_consumption is not None:
        if grid_tariff is None:
            avoided_reason = "grid_tariff_missing_or_boundary"
        elif self_status in {"complete", "partial"}:
            avoided = self_consumption * Decimal(str(grid_tariff["value_ct_per_kwh"])) / Decimal("100")
            avoided_reason = None

    total_status = _worst([self_status, export_status])
    total = avoided + feed_value if avoided is not None and feed_value is not None else None
    total_reason = None if total is not None else avoided_reason or feed_reason or "required_component_unavailable"
    net = feed_value - import_cost + avoided if None not in (feed_value, import_cost, avoided) else None
    net_reason = None if net is not None else import_reason or total_reason or "required_component_unavailable"
    provisional = bool((feed_tariff or {}).get("provisional") or (grid_tariff or {}).get("provisional"))

    return {
        "period": period,
        "calculated_at": calculated.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "coverage_state": total_status if total is not None else "unavailable",
        "reason": total_reason,
        "provisional": provisional,
        "energy_basis": {
            "solar_generation": solar,
            "grid_import": imported,
            "grid_export": exported,
            "direct_self_consumption": {
                "value_kwh": format(self_consumption, "f") if self_consumption is not None else None,
                "source": "calculated_compatible_energy" if self_consumption is not None else "unavailable",
                "coverage_state": self_status,
                "formula": "pv_generation_kwh - grid_export_kwh",
                "reason": self_reason,
            },
        },
        "tariffs": {
            "grid_work_price": _tariff_meta(grid_tariff),
            "feed_in_tariff": _tariff_meta(feed_tariff),
            "base_price": _tariff_meta(base_tariff),
        },
        "results": {
            "grid_import_cost": _money(import_cost, status=import_status, formula="grid_import_kwh × grid_work_price_eur_per_kwh", reason=import_reason),
            "feed_in_remuneration": _money(feed_value, status=export_status, formula="grid_export_kwh × feed_in_tariff_eur_per_kwh", reason=feed_reason),
            "avoided_grid_cost": _money(avoided, status=self_status, formula="direct_self_consumption_kwh × grid_work_price_eur_per_kwh", reason=avoided_reason),
            "solar_economic_value": _money(total, status=total_status, formula="avoided_grid_cost + feed_in_remuneration", reason=total_reason),
            "net_variable_energy_position": _money(net, status=_worst([import_status, total_status]), formula="feed_in_remuneration - grid_import_cost + avoided_grid_cost", reason=net_reason),
        },
        "exclusions": ["base_price_not_avoidable"],
    }
