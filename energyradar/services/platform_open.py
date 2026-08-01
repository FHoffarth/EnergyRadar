"""Open files, folders, URLs, and Finder/Explorer selections safely."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


def _run(command: list[str]) -> None:
    """Run a platform opener without invoking a command shell."""
    subprocess.run(command, check=True)


def open_path(path: str | os.PathLike[str]) -> None:
    """Open an existing file or directory with the platform default app."""
    target = Path(path)
    if not target.exists():
        raise FileNotFoundError(f"Path does not exist: {target}")

    if sys.platform == "win32":
        os.startfile(str(target))
    elif sys.platform == "darwin":
        _run(["open", str(target)])
    else:
        _run(["xdg-open", str(target)])


def reveal_path(path: str | os.PathLike[str]) -> None:
    """Reveal an existing path in the native file manager where supported."""
    target = Path(path)
    if not target.exists():
        raise FileNotFoundError(f"Path does not exist: {target}")
    absolute = target.resolve()

    if sys.platform == "win32":
        _run(["explorer", "/select,", str(absolute)])
    elif sys.platform == "darwin":
        _run(["open", "-R", str(absolute)])
    else:
        _run(["xdg-open", str(absolute.parent)])


def open_url(url: str) -> None:
    """Open a URL with the platform default handler."""
    if sys.platform == "win32":
        os.startfile(url)
    elif sys.platform == "darwin":
        _run(["open", url])
    else:
        _run(["xdg-open", url])
