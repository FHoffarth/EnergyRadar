"""Local-first data-source configuration for EnergyRadar.

Only a Fronius device on the local/private network can be configured through
the UI. ``FRONIUS_URL`` remains an explicit, trusted operator override.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
from pathlib import Path
from urllib.parse import SplitResult, urlsplit, urlunsplit

from energyradar import config


PROVIDER = "fronius"
API_PATH = "/solar_api/v1/GetPowerFlowRealtimeData.fcgi"
CONFIG_VERSION = 1
_LOCAL_HOST_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    re.IGNORECASE,
)
_PRIVATE_V4 = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)


class DataSourceError(ValueError):
    """Base class for safe, user-facing configuration failures."""


class UnsafeTargetError(DataSourceError):
    """The requested target is not an allowed local/private endpoint."""


class TargetResolutionError(DataSourceError):
    """The local hostname cannot currently be resolved safely."""


def _is_allowed_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if address.is_loopback or address.is_link_local:
        return True
    if isinstance(address, ipaddress.IPv4Address):
        return any(address in network for network in _PRIVATE_V4)
    return address.is_private


def _validate_local_hostname(hostname: str) -> None:
    value = hostname.rstrip(".").lower()
    if value == "localhost":
        return
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        if not _LOCAL_HOST_RE.fullmatch(value):
            raise UnsafeTargetError("Only local or private-network devices are allowed.")
        if "." in value and not value.endswith(".local"):
            raise UnsafeTargetError("Only local or private-network devices are allowed.")
        return
    if not _is_allowed_ip(address):
        raise UnsafeTargetError("Only local or private-network devices are allowed.")


def _normalized_netloc(parts: SplitResult) -> str:
    hostname = parts.hostname
    if not hostname:
        raise DataSourceError("Enter a local IP address or .local hostname.")
    _validate_local_hostname(hostname)
    try:
        port = parts.port
    except ValueError as exc:
        raise DataSourceError("The port must be between 1 and 65535.") from exc

    host = hostname.rstrip(".").lower()
    if ":" in host:
        host = f"[{host}]"
    return f"{host}:{port}" if port is not None else host


def normalize_address(value: str) -> str:
    """Return a canonical Fronius API URL for a safe local address."""
    if not isinstance(value, str) or not value.strip():
        raise DataSourceError("Enter a local IP address or .local hostname.")

    candidate = value.strip()
    if "://" not in candidate:
        candidate = f"http://{candidate}"
    parts = urlsplit(candidate)

    if parts.scheme.lower() not in {"http", "https"}:
        raise UnsafeTargetError("Only http:// and https:// are supported.")
    if parts.username is not None or parts.password is not None:
        raise UnsafeTargetError("Credentials are not allowed in the device address.")
    if parts.query or parts.fragment:
        raise UnsafeTargetError("Query strings and fragments are not allowed.")

    path = parts.path.rstrip("/")
    if not path:
        path = API_PATH
    elif path != API_PATH:
        raise UnsafeTargetError("Only the Fronius Solar API endpoint is allowed.")

    return urlunsplit((parts.scheme.lower(), _normalized_netloc(parts), path, "", ""))


def validate_resolved_target(url: str) -> None:
    """Resolve a user-configured hostname and reject any non-local address."""
    parts = urlsplit(url)
    hostname = parts.hostname
    if not hostname:
        raise UnsafeTargetError("The device address has no hostname.")

    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_allowed_ip(literal):
            raise UnsafeTargetError("Only local or private-network devices are allowed.")
        return

    old_timeout = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(1.0)
        addresses = {
            ipaddress.ip_address(item[4][0])
            for item in socket.getaddrinfo(
                hostname,
                parts.port or (443 if parts.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except (OSError, ValueError) as exc:
        raise TargetResolutionError("The local device could not be resolved.") from exc
    finally:
        socket.setdefaulttimeout(old_timeout)

    if not addresses or any(not _is_allowed_ip(address) for address in addresses):
        raise UnsafeTargetError("The hostname does not resolve only to local addresses.")


def _config_path() -> Path:
    return config.DATA_SOURCE_CONFIG_PATH


def load_saved() -> dict | None:
    """Load and revalidate the per-user configuration, failing closed."""
    try:
        payload = json.loads(_config_path().read_text(encoding="utf-8"))
        if payload.get("version") != CONFIG_VERSION or payload.get("provider") != PROVIDER:
            return None
        url = normalize_address(payload["url"])
    except (OSError, ValueError, TypeError, KeyError):
        return None
    return {"provider": PROVIDER, "url": url, "source": "saved"}


def save(address: str) -> dict:
    """Atomically save a validated address in the user's application data."""
    url = normalize_address(address)
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(
            {"version": CONFIG_VERSION, "provider": PROVIDER, "url": url},
            indent=2,
        ),
        encoding="utf-8",
    )
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    os.replace(temporary, path)
    return {"provider": PROVIDER, "url": url, "source": "saved"}


def remove_saved() -> bool:
    """Remove only the per-user file; an environment override is untouched."""
    try:
        _config_path().unlink()
    except FileNotFoundError:
        return False
    return True


def effective() -> dict | None:
    """Resolve environment override, saved config, ui-settings, then unconfigured state."""
    if config.FRONIUS_URL:
        return {"provider": PROVIDER, "url": config.FRONIUS_URL, "source": "environment"}
    saved = load_saved()
    if saved:
        return saved
    from energyradar.ui import settings as ui_settings
    try:
        raw_dict = ui_settings.load_raw_dict()
        if "fronius_address" in raw_dict and raw_dict["fronius_address"]:
            url = normalize_address(str(raw_dict["fronius_address"]).strip())
            return {"provider": PROVIDER, "url": url, "source": "saved"}
    except Exception:
        pass
    return None


def display_address(url: str) -> str:
    """Return the editable origin without exposing the fixed API path."""
    if not url:
        return ""
    parts = urlsplit(url if "://" in url else f"http://{url}")
    return urlunsplit((parts.scheme or "http", parts.netloc, "", "", "")).rstrip("/")


def mask_address_credentials(url: str) -> str:
    """Mask any username/password or query parameters in a display address."""
    if not url:
        return ""
    if "://" not in url:
        url = f"http://{url}"
    parts = urlsplit(url)
    hostname = parts.hostname or ""
    port_str = f":{parts.port}" if parts.port else ""
    scheme = parts.scheme or "http"
    return f"{scheme}://{hostname}{port_str}".rstrip("/")
