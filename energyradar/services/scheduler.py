"""Monotonic, bounded task scheduler used by the backend recorder."""
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
import heapq
import logging
import threading
import time
from typing import Callable

log = logging.getLogger(__name__)


class SystemClock:
    monotonic = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)


@dataclass(order=True)
class _Task:
    due: float
    order: int
    name: str = field(compare=False)
    cadence: float = field(compare=False)
    callback: Callable[[], None] = field(compare=False)
    max_backoff: float = field(compare=False)
    failures: int = field(default=0, compare=False)
    running: bool = field(default=False, compare=False)


class BackendScheduler:
    """One scheduler thread with a bounded worker pool and no overlapping task."""

    def __init__(self, *, clock: object | None = None, workers: int = 3) -> None:
        self.clock = clock or SystemClock()
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="energyradar-io")
        self._heap: list[_Task] = []
        self._tasks: dict[str, _Task] = {}
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._order = 0

    def add_task(self, name: str, cadence: float, callback: Callable[[], None], *, immediate: bool = True, max_backoff: float | None = None) -> None:
        if cadence <= 0:
            raise ValueError("cadence must be positive")
        with self._lock:
            if name in self._tasks:
                raise ValueError(f"task already exists: {name}")
            self._order += 1
            task = _Task(
                due=self.clock.monotonic() if immediate else self.clock.monotonic() + cadence,
                order=self._order,
                name=name,
                cadence=cadence,
                callback=callback,
                max_backoff=max_backoff or cadence * 12,
            )
            self._tasks[name] = task
            heapq.heappush(self._heap, task)
        self._wake.set()

    def start(self) -> bool:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="energyradar-scheduler", daemon=True)
            self._thread.start()
            return True

    def trigger(self, name: str) -> None:
        with self._lock:
            task = self._tasks[name]
            task.due = min(task.due, self.clock.monotonic())
            heapq.heapify(self._heap)
        self._wake.set()

    def run_due_once(self) -> int:
        """Submit all due tasks; exposed for deterministic clock tests."""
        submitted = 0
        now = self.clock.monotonic()
        with self._lock:
            while self._heap and self._heap[0].due <= now:
                task = heapq.heappop(self._heap)
                if task.running:
                    task.due = now + task.cadence
                    heapq.heappush(self._heap, task)
                    continue
                task.running = True
                future = self._executor.submit(task.callback)
                future.add_done_callback(lambda value, current=task: self._completed(current, value))
                submitted += 1
        return submitted

    def _completed(self, task: _Task, future: Future[None]) -> None:
        now = self.clock.monotonic()
        error = future.exception()
        with self._lock:
            task.running = False
            if error is None:
                task.failures = 0
                delay = task.cadence
            else:
                task.failures += 1
                delay = min(task.max_backoff, task.cadence * (2 ** min(task.failures, 6)))
                log.warning("Scheduled task %s failed; retry in %.1fs: %s", task.name, delay, error)
            task.due = now + delay
            heapq.heappush(self._heap, task)
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.run_due_once()
            with self._lock:
                wait = max(0.01, self._heap[0].due - self.clock.monotonic()) if self._heap else 1.0
            self._wake.wait(min(wait, 1.0))
            self._wake.clear()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        self._executor.shutdown(wait=True, cancel_futures=True)

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
