"""Strongly typed reading returned by the BitShake MT175 collector.

All power values are in watts (W).
All energy totals are in kilowatt-hours (kWh).
current_power_w is None when the meter has not yet been PIN-unlocked.
timestamp is None when the device did not report a parseable time string.
received_at is always set: timezone-aware wall-clock at parse time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class MT175Reading:
    """One snapshot from a BitShake MT175 smart meter via Tasmota.

    Fields
    ------
    timestamp           : Timezone-aware local datetime parsed from the Tasmota
                          ``Time`` field, or ``None`` if that field is absent
                          or not a valid ISO 8601 string.  Represents what the
                          device reported, not when the data was received.
    received_at         : Timezone-aware wall-clock datetime set at the moment
                          the payload was parsed.  Always present; use this
                          when you need a reliable "data collected at" anchor.
    grid_import_total_kwh : Total imported energy (kWh), register 1.8.0.
    grid_export_total_kwh : Total exported energy (kWh), register 2.8.0.
    current_power_w     : Current net grid power in watts, or None if the
                          meter is not yet PIN-unlocked (all phase readings
                          are zero and server_id is empty).
    phase_l1_w          : Phase L1 power in watts.
    phase_l2_w          : Phase L2 power in watts.
    phase_l3_w          : Phase L3 power in watts.
    meter_id            : Meter server-ID string; empty string when unknown.
    """

    timestamp: datetime | None
    received_at: datetime
    grid_import_total_kwh: float
    grid_export_total_kwh: float
    current_power_w: float | None
    phase_l1_w: float
    phase_l2_w: float
    phase_l3_w: float
    meter_id: str
