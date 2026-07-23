"""Collector for the BitShake MT175 smart meter via Tasmota HTTP bridge.

Single responsibility: fetch data from the Tasmota ``Status 10`` endpoint
and return a strongly-typed :class:`~models.mt175.MT175Reading`.
No persistence, no side-effects, no integration with other providers.

Endpoint::

    GET http://<host>/cm?cmnd=Status%2010

Typical response::

    {
      "StatusSNS": {
        "Time": "2026-07-21T18:59:19",
        "MT175": {
          "ImportActive": 9755.000,
          "ExportActive": 12399.000,
          "Power": 0,
          "power_L1": 0,
          "power_L2": 0,
          "power_L3": 0,
          "server_id": ""
        }
      }
    }
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

from energyradar import config
from energyradar.models.mt175 import MT175Reading

# Fixed Tasmota query that returns the sensor status block.
_TASMOTA_PATH = "/cm?cmnd=Status%2010"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _local_zone() -> ZoneInfo:
    """Return the configured local timezone, falling back to Europe/Berlin.

    Reads :data:`config.MT175_TIMEZONE` on every call so that tests can
    patch the config module without stale cached values.
    """
    tz_name = getattr(config, "MT175_TIMEZONE", "Europe/Berlin") or "Europe/Berlin"
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError):
        return ZoneInfo("Europe/Berlin")


def _to_float(value: object, default: float = 0.0) -> float:
    """Coerce *value* to :class:`float`, returning *default* on failure.

    Handles ``None``, numeric types, and numeric strings (e.g. ``"9755.000"``
    as some Tasmota firmware variants return).  Malformed strings are treated
    as *default* rather than raising.
    """
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_timestamp(raw_time: str | None, zone: ZoneInfo) -> datetime | None:
    """Parse a Tasmota local-time string into a timezone-aware :class:`datetime`.

    Tasmota returns a naïve ISO 8601 string in device-local time
    (e.g. ``"2026-07-21T18:59:19"``).  *zone* is attached so callers
    receive an aware datetime.

    Returns ``None`` if the field is absent, ``None``, or not a valid
    ISO 8601 string.  The caller must decide how to handle a missing
    device timestamp rather than receiving a silently substituted value.
    """
    if not raw_time:
        return None
    try:
        naive = datetime.fromisoformat(str(raw_time))
        # Attach the configured zone to the naïve device timestamp.
        # NOTE: This cannot fully disambiguate DST-fallback timestamps.
        # During the clock-back hour (e.g. 02:30 when Europe/Berlin reverts
        # from CEST to CET) the same wall-clock time occurs twice with
        # different UTC offsets.  Tasmota does not supply a UTC offset, so
        # replace() silently picks the first (pre-fallback) interpretation.
        return naive.replace(tzinfo=zone)
    except (ValueError, TypeError):
        return None


def _is_pin_locked(mt175: dict) -> bool:
    """Return ``True`` when the MT175 appears not yet PIN-unlocked.

    A meter that has not been unlocked reports all power channels as zero
    **and** an empty ``server_id``.  In that state the readings are
    meaningless rather than a genuine measurement of zero watts, so the
    caller should expose ``current_power_w = None`` instead of ``0``.

    All five conditions must hold simultaneously:

    * ``Power   == 0``
    * ``power_L1 == 0``
    * ``power_L2 == 0``
    * ``power_L3 == 0``
    * ``server_id`` is empty / absent
    """
    return (
        _to_float(mt175.get("Power")) == 0.0
        and _to_float(mt175.get("power_L1")) == 0.0
        and _to_float(mt175.get("power_L2")) == 0.0
        and _to_float(mt175.get("power_L3")) == 0.0
        and not str(mt175.get("server_id", "") or "").strip()
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse(raw: dict) -> MT175Reading:
    """Parse a decoded Tasmota ``Status 10`` JSON dict into an :class:`~models.mt175.MT175Reading`.

    Parameters
    ----------
    raw:
        The JSON object decoded from the Tasmota HTTP response.  Must
        contain the top-level ``StatusSNS`` key and a nested ``MT175``
        sub-object.  All individual meter fields within ``MT175`` are
        optional and degrade to safe defaults when absent or ``None``.

    Returns
    -------
    MT175Reading
        Fully populated reading with a timezone-aware timestamp.

    Raises
    ------
    KeyError
        If ``StatusSNS`` or the nested ``MT175`` block is missing.
        This signals a corrupt or unexpected Tasmota response and should
        be handled by the caller.
    """
    # Capture the wall-clock moment of arrival before any field access.
    # This is the first thing we do so that received_at is as close as
    # possible to "when the payload entered this function", regardless of
    # how long subsequent parsing takes.
    zone = _local_zone()
    received_at = datetime.now(zone)

    sns = raw["StatusSNS"]
    mt175 = sns["MT175"]

    timestamp = _parse_timestamp(sns.get("Time"), zone)

    import_kwh = _to_float(mt175.get("ImportActive"))
    export_kwh = _to_float(mt175.get("ExportActive"))
    phase_l1 = _to_float(mt175.get("power_L1"))
    phase_l2 = _to_float(mt175.get("power_L2"))
    phase_l3 = _to_float(mt175.get("power_L3"))
    meter_id = str(mt175.get("server_id", "") or "")

    current_power: float | None = (
        None if _is_pin_locked(mt175) else _to_float(mt175.get("Power"))
    )

    return MT175Reading(
        timestamp=timestamp,
        received_at=received_at,
        grid_import_total_kwh=import_kwh,
        grid_export_total_kwh=export_kwh,
        current_power_w=current_power,
        phase_l1_w=phase_l1,
        phase_l2_w=phase_l2,
        phase_l3_w=phase_l3,
        meter_id=meter_id,
    )


def read_url(url: str) -> MT175Reading:
    """Fetch one reading from a Tasmota device and return an :class:`~models.mt175.MT175Reading`.

    Parameters
    ----------
    url:
        Base device URL, e.g. ``"http://tasmota.local"`` or
        ``"http://192.168.1.25"``.  A trailing slash is stripped and the
        fixed Tasmota ``Status 10`` query path is appended automatically.

    Returns
    -------
    MT175Reading
        Parsed reading.  ``timestamp`` is timezone-aware when the device
        reported a valid time string, ``None`` otherwise.  ``received_at``
        is always set.

    Raises
    ------
    requests.exceptions.RequestException
        On any network or HTTP-level failure (timeout, connection refused,
        non-2xx status, …).  The caller is responsible for handling these.
    KeyError
        If the HTTP response JSON does not contain the expected structure.
    """
    endpoint = url.rstrip("/") + _TASMOTA_PATH
    response = requests.get(endpoint, timeout=(1.5, 3.0), allow_redirects=False)
    response.raise_for_status()
    return parse(response.json())


def read_demo() -> MT175Reading:
    """Demo-Quelle für ISKRA MT175 Smart Meter mit plausiblem Live-Netzfluss."""
    import random
    from energyradar.collectors import fronius
    now = datetime.now(_local_zone())
    pv_w = fronius._demo_power(now)
    home_w = 1100.0 + random.uniform(-100, 100)
    grid_w = home_w - pv_w  # Negative = Export, Positive = Import
    return MT175Reading(
        timestamp=now,
        received_at=datetime.now(timezone.utc),
        grid_import_total_kwh=9755.0 + (now.hour * 0.4),
        grid_export_total_kwh=12399.0 + (now.hour * 1.8),
        current_power_w=grid_w,
        phase_l1_w=grid_w / 3.0,
        phase_l2_w=grid_w / 3.0,
        phase_l3_w=grid_w / 3.0,
        meter_id="DEMO-MT175-8842",
    )
