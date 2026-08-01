"""Collector for Iskra MT631/MT175 meters via a Tasmota HTTP bridge.

Single responsibility: fetch data from the Tasmota ``Status 10`` endpoint
and return a strongly-typed :class:`~models.mt175.MT175Reading`.
No persistence, no side-effects, no integration with other providers.

Endpoint::

    GET http://<host>/cm?cmnd=Status%2010

Typical response::

    {
      "StatusSNS": {
        "Time": "2026-07-21T18:59:19",
        "MT631": {
          "ImportActive": 9798.031,
          "ExportActive": 12480.630,
          "Power": -789
        }
      }
    }
"""

from __future__ import annotations

from datetime import datetime
import math
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

from energyradar import config
from energyradar.models.mt175 import MT175Reading

# Fixed Tasmota command path and query that return the sensor status block.
_TASMOTA_PATH = "/cm?cmnd=Status%2010"
_TASMOTA_COMMAND_PATH = "/cm"
_TASMOTA_QUERY = "cmnd=Status%2010"


class MT175AddressError(ValueError):
    """The configured smart-meter address cannot become a valid endpoint."""


class SmartMeterDataError(ValueError):
    """The response is JSON data but not a supported Tasmota meter payload."""


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


def _to_float(value: object) -> float | None:
    """Return a finite float for a numeric value, otherwise ``None``.

    Handles ``None``, numeric types, and numeric strings (e.g. ``"9755.000"``
    as some Tasmota firmware variants return).  Booleans, malformed strings,
    NaN, and infinities are unavailable rather than fabricated as zero.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


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
    power_keys = ("Power", "power_L1", "power_L2", "power_L3")
    return (
        all(key in mt175 for key in power_keys)
        and _to_float(mt175.get("Power")) == 0.0
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
        contain a ``StatusSNS`` object and a nested ``MT631`` or ``MT175``
        object.  Missing, malformed, and non-finite measurements remain
        unavailable rather than degrading to fabricated zero values.

    Returns
    -------
    MT175Reading
        Fully populated reading with a timezone-aware timestamp.

    Raises
    ------
    SmartMeterDataError
        If the decoded JSON has no supported meter object.
    """
    # Capture the wall-clock moment of arrival before any field access.
    # This is the first thing we do so that received_at is as close as
    # possible to "when the payload entered this function", regardless of
    # how long subsequent parsing takes.
    zone = _local_zone()
    received_at = datetime.now(zone)

    if not isinstance(raw, dict) or not isinstance(raw.get("StatusSNS"), dict):
        raise SmartMeterDataError("No supported Tasmota smart meter found.")
    sns = raw.get("StatusSNS")
    meter_key = next(
        (key for key in ("MT631", "MT175") if key in sns),
        None,
    )
    if meter_key is None or not isinstance(sns[meter_key], dict):
        raise SmartMeterDataError("No supported Tasmota smart meter found.")
    meter = sns[meter_key]

    timestamp = _parse_timestamp(sns.get("Time"), zone)

    import_kwh = _to_float(meter.get("ImportActive"))
    export_kwh = _to_float(meter.get("ExportActive"))
    phase_l1 = _to_float(meter.get("power_L1"))
    phase_l2 = _to_float(meter.get("power_L2"))
    phase_l3 = _to_float(meter.get("power_L3"))
    raw_meter_id = meter.get("server_id")
    meter_id = str(raw_meter_id).strip() if raw_meter_id is not None else None
    meter_id = meter_id or None

    pin_locked = meter_key == "MT175" and _is_pin_locked(meter)
    current_power = None if pin_locked else _to_float(meter.get("Power"))

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
        meter_type=meter_key,
        pin_locked=pin_locked,
    )


def build_endpoint(address: str) -> str:
    """Turn a user-supplied device address into the full Tasmota endpoint URL.

    The settings UI stores whatever the user typed, which in practice is a
    bare host or IP (``192.168.178.83``), an mDNS name (``zaehler.local``),
    or a full origin (``http://192.168.178.83``).  A bare host has no URL
    scheme, and :mod:`requests` refuses such a target outright, so the scheme
    is supplied here rather than being assumed of the caller.

    Accepted input forms::

        192.168.178.83
        zaehler.local
        zaehler.local:8080
        http://192.168.178.83
        https://zaehler.local
        http://192.168.178.83/          (trailing slashes collapsed)
        http://192.168.178.83/cm?cmnd=Status%2010   (already an endpoint)

    ``http://`` is added only when no scheme is present, so a scheme is never
    duplicated.  Path separators are collapsed so the fixed command path is
    appended exactly once, and any query or fragment the user pasted is
    replaced by the canonical ``Status 10`` query.

    Raises
    ------
    MT175AddressError
        If the address is empty, has no host, carries embedded credentials,
        or uses a scheme other than http/https.
    """
    if not isinstance(address, str) or not address.strip():
        raise MT175AddressError("Enter the IP address or hostname of the meter bridge.")

    candidate = address.strip()
    if "://" not in candidate:
        # Bare host/IP — supply the scheme requests needs. lstrip("/") keeps a
        # pasted "//192.168.178.83" from becoming "http:////192.168.178.83".
        candidate = f"http://{candidate.lstrip('/')}"

    parts = urlsplit(candidate)
    scheme = parts.scheme.lower()
    if scheme not in {"http", "https"}:
        raise MT175AddressError("Only http:// and https:// addresses are supported.")
    if parts.username is not None or parts.password is not None:
        raise MT175AddressError("Credentials are not allowed in the device address.")

    hostname = parts.hostname
    if not hostname:
        raise MT175AddressError("Enter the IP address or hostname of the meter bridge.")
    try:
        port = parts.port
    except ValueError as exc:
        raise MT175AddressError("The port must be between 1 and 65535.") from exc

    host = hostname.rstrip(".").lower()
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    netloc = f"{host}:{port}" if port is not None else host

    # Collapse repeated separators and drop a command path the user already
    # supplied, so the canonical path is appended exactly once.
    segments = [segment for segment in parts.path.split("/") if segment]
    if segments and segments[-1].lower() == "cm":
        segments.pop()
    base_path = f"/{'/'.join(segments)}" if segments else ""

    return urlunsplit(
        (scheme, netloc, f"{base_path}{_TASMOTA_COMMAND_PATH}", _TASMOTA_QUERY, "")
    )


def read_url(url: str) -> MT175Reading:
    """Fetch one reading from a Tasmota device and return an :class:`~models.mt175.MT175Reading`.

    Parameters
    ----------
    url:
        Device address in any form accepted by :func:`build_endpoint` — a
        bare host or IP, an mDNS name, or a full URL.  The fixed Tasmota
        ``Status 10`` query path is appended automatically.

    Returns
    -------
    MT175Reading
        Parsed reading.  ``timestamp`` is timezone-aware when the device
        reported a valid time string, ``None`` otherwise.  ``received_at``
        is always set.

    Raises
    ------
    MT175AddressError
        If the address cannot be turned into a valid http(s) endpoint.
    requests.exceptions.RequestException
        On any network or HTTP-level failure (timeout, connection refused,
        non-2xx status, …).  The caller is responsible for handling these.
    SmartMeterDataError
        If the JSON response has no supported Tasmota meter block.
    """
    endpoint = build_endpoint(url)
    response = requests.get(endpoint, timeout=(1.5, 3.0), allow_redirects=False)
    response.raise_for_status()
    try:
        raw = response.json()
    except ValueError as exc:
        raise SmartMeterDataError("Tasmota returned malformed JSON data.") from exc
    return parse(raw)


def read_demo() -> MT175Reading:
    """Demo source for a Tasmota smart meter with plausible live grid flow."""
    import random
    from energyradar.collectors import fronius
    zone = _local_zone()
    now = datetime.now(zone)
    pv_w = fronius._demo_power(now)
    home_w = 1100.0 + random.uniform(-100, 100)
    grid_w = home_w - pv_w  # Negative = Export, Positive = Import
    return MT175Reading(
        timestamp=now,
        received_at=datetime.now(zone),
        grid_import_total_kwh=9755.0 + (now.hour * 0.4),
        grid_export_total_kwh=12399.0 + (now.hour * 1.8),
        current_power_w=grid_w,
        phase_l1_w=grid_w / 3.0,
        phase_l2_w=grid_w / 3.0,
        phase_l3_w=grid_w / 3.0,
        meter_id="DEMO-MT175-8842",
        meter_type="MT175",
        pin_locked=False,
    )
