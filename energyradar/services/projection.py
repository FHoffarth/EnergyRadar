"""Disposable, thread-safe current-state projection.

The projection is fed by the recorder pipeline. It never polls or persists.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import threading
from typing import Any


@dataclass(frozen=True)
class SourceSnapshot:
    configured: bool = False
    reading: Any = None
    observed_at: datetime | None = None
    received_at: datetime | None = None
    health: str = "not_configured"
    error_code: str | None = None
    source_uuid: str | None = None


@dataclass(frozen=True)
class ProjectionSnapshot:
    fronius: SourceSnapshot = SourceSnapshot()
    smart_meter: SourceSnapshot = SourceSnapshot()
    weather_report: Any = None
    forecast_report: Any = None
    recording_started_at: datetime | None = None
    recording_active: bool = False
    last_anchor_at: datetime | None = None
    last_gap_ended_at: datetime | None = None


class CurrentStateProjection:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._value = ProjectionSnapshot()

    def snapshot(self) -> ProjectionSnapshot:
        with self._lock:
            return self._value

    def update_source(self, name: str, value: SourceSnapshot) -> None:
        if name not in {"fronius", "smart_meter"}:
            raise ValueError(f"unknown source projection: {name}")
        with self._lock:
            self._value = replace(self._value, **{name: value})

    def update_weather(self, report: Any) -> None:
        with self._lock:
            self._value = replace(self._value, weather_report=report)

    def update_forecast(self, report: Any) -> None:
        with self._lock:
            self._value = replace(self._value, forecast_report=report)

    def set_recording(self, *, active: bool, started_at: datetime | None = None) -> None:
        with self._lock:
            self._value = replace(
                self._value,
                recording_active=active,
                recording_started_at=started_at or self._value.recording_started_at,
            )

    def anchor_recorded(self, at: datetime) -> None:
        with self._lock:
            self._value = replace(self._value, last_anchor_at=at)

    def gap_ended(self, at: datetime) -> None:
        with self._lock:
            self._value = replace(self._value, last_gap_ended_at=at)

    def rebuild_stale(self, *, fronius: SourceSnapshot | None = None, smart_meter: SourceSnapshot | None = None) -> None:
        """Restore last-known values without claiming that they are live."""
        with self._lock:
            updates: dict[str, SourceSnapshot] = {}
            if fronius is not None:
                updates["fronius"] = replace(fronius, health="stale")
            if smart_meter is not None:
                updates["smart_meter"] = replace(smart_meter, health="stale")
            self._value = replace(self._value, **updates)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
