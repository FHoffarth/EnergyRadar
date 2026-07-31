"""Strongly typed reading returned by the Tasmota smart-meter collector.

All power values are in watts (W).
All energy totals are in kilowatt-hours (kWh).
``current_power_w`` preserves the meter's sign: positive means grid import,
negative means grid export, and zero is a valid balanced reading.  It is
``None`` only when live power is unavailable (or a legacy MT175 is PIN-locked).
timestamp is None when the device did not report a parseable time string.
received_at is always set: timezone-aware wall-clock at parse time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class MT175Reading:
    """One snapshot from a supported Iskra smart meter via Tasmota.

    The compatibility name is retained for callers that already import
    ``MT175Reading``; readings may originate from either MT175 or MT631.

    Fields
    ------
    timestamp           : Timezone-aware local datetime parsed from the Tasmota
                          ``Time`` field, or ``None`` if that field is absent
                          or not a valid ISO 8601 string.  Represents what the
                          device reported, not when the data was received.
    received_at         : Timezone-aware wall-clock datetime set at the moment
                          the payload was parsed.  Always present; use this
                          when you need a reliable "data collected at" anchor.
    grid_import_total_kwh : Total imported energy (kWh), or ``None``.
    grid_export_total_kwh : Total exported energy (kWh), or ``None``.
    current_power_w     : Signed net grid power (positive import, negative
                          export), or ``None`` when unavailable.
    phase_l1_w          : Phase L1 power in watts, or ``None`` if unsupported.
    phase_l2_w          : Phase L2 power in watts, or ``None`` if unsupported.
    phase_l3_w          : Phase L3 power in watts, or ``None`` if unsupported.
    meter_id            : Meter server-ID, or ``None`` if unsupported.
    meter_type          : Tasmota sensor block name (``MT631`` or ``MT175``).
    pin_locked          : Legacy MT175 PIN-lock heuristic result.  ``None``
                          is retained for old callers that supplied no state.
    """

    timestamp: datetime | None
    received_at: datetime
    grid_import_total_kwh: float | None
    grid_export_total_kwh: float | None
    current_power_w: float | None
    phase_l1_w: float | None
    phase_l2_w: float | None
    phase_l3_w: float | None
    meter_id: str | None
    meter_type: str = "MT175"
    pin_locked: bool | None = None
