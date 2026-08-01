#!/usr/bin/env python3
"""Validate the architecture and release contract of EnergyRadar.app."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
from energyradar import config


ARM64_ARCHIVE_NAME = "EnergyRadar-macOS-arm64.zip"
ARM64_CHECKSUM_NAME = f"{ARM64_ARCHIVE_NAME}.sha256"
FORBIDDEN_BUNDLE_NAMES = {
    ".env",
    "data-source.json",
    "energy.db",
    "ui-settings.json",
    "weather-cache.json",
}
NATIVE_SUFFIXES = {".dylib", ".so", ".pyd"}


class BundleValidationError(RuntimeError):
    """Raised when a packaged macOS bundle violates the release contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BundleValidationError(message)


def macos_marketing_version(app_version: str) -> str:
    """Return Apple's numeric marketing-version form of the app version."""
    return app_version.partition("-")[0]


def validate_structure(app: Path, project_root: Path) -> dict[str, Path]:
    """Validate required files, local-data exclusions, and UI defaults."""
    _require(app.is_dir(), f"Application bundle is missing: {app}")

    executable = app / "Contents" / "MacOS" / "EnergyRadar"
    info_plist = app / "Contents" / "Info.plist"
    react_dist = app / "Contents" / "Resources" / "react-ui" / "dist"
    react_index = react_dist / "index.html"
    build_info_path = app / "Contents" / "Resources" / "BUILDINFO.json"

    _require(executable.is_file(), f"Main executable is missing: {executable}")
    _require(os.access(executable, os.X_OK), f"Main executable is not executable: {executable}")
    _require(info_plist.is_file(), f"Info.plist is missing: {info_plist}")
    _require(build_info_path.is_file(), f"BUILDINFO.json is missing: {build_info_path}")
    _require(react_index.is_file(), f"React entry point is missing: {react_index}")
    _require(
        any(react_dist.glob("assets/*.js")),
        f"Compiled React JavaScript is missing below: {react_dist}",
    )
    _require(
        any(path.name == "QtWebEngineProcess" for path in app.rglob("QtWebEngineProcess")),
        "QtWebEngineProcess is missing from the application bundle.",
    )

    with info_plist.open("rb") as handle:
        plist = plistlib.load(handle)
    expected_bundle_version = macos_marketing_version(config.APP_VERSION)
    _require(
        plist.get("CFBundleShortVersionString") == expected_bundle_version,
        "Info.plist version does not match the authoritative application version.",
    )
    icon_name = plist.get("CFBundleIconFile")
    _require(bool(icon_name), "Info.plist does not declare a bundle icon.")
    icon_path = app / "Contents" / "Resources" / str(icon_name)
    if not icon_path.suffix:
        icon_path = icon_path.with_suffix(".icns")
    _require(icon_path.is_file(), f"Declared bundle icon is missing: {icon_path}")

    build_info = json.loads(build_info_path.read_text(encoding="utf-8"))
    _require(
        build_info.get("app_version") == config.APP_VERSION,
        "BUILDINFO app version does not match the authoritative application version.",
    )
    _require(
        build_info.get("bundle_version") == expected_bundle_version,
        "BUILDINFO bundle version does not match Info.plist.",
    )
    _require(
        build_info.get("architecture") == "arm64",
        "BUILDINFO architecture is not arm64.",
    )
    _require(
        re.fullmatch(r"[0-9a-f]{40}", str(build_info.get("source_commit", ""))) is not None,
        "BUILDINFO source commit is missing or invalid.",
    )
    expected_source_commit = os.environ.get("GITHUB_SHA")
    if expected_source_commit:
        _require(
            build_info.get("source_commit") == expected_source_commit,
            "BUILDINFO source commit does not match the workflow commit.",
        )

    forbidden: list[Path] = []
    for path in app.rglob("*"):
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if (
            lowered in FORBIDDEN_BUNDLE_NAMES
            or lowered.endswith((".db", ".sqlite", ".sqlite3"))
            or lowered.startswith(".env.")
        ):
            forbidden.append(path.relative_to(app))
    _require(
        not forbidden,
        "Private configuration or local database files are bundled: "
        + ", ".join(map(str, forbidden)),
    )

    setup_wizard = (
        project_root
        / "frontend"
        / "react-ui"
        / "src"
        / "components"
        / "SetupWizardModal.tsx"
    )
    _require(setup_wizard.is_file(), f"Setup wizard source is missing: {setup_wizard}")
    source = setup_wizard.read_text(encoding="utf-8")
    _require(
        re.search(
            r"const\s+\[host,\s*setHost\]\s*=\s*useState\(\s*(['\"])\1\s*\)",
            source,
        )
        is not None,
        "The setup wizard Fronius host default is not empty.",
    )
    _require(
        re.search(r"placeholder\s*=\s*(['\"])fronius\.local\1", source) is not None,
        "fronius.local is not present as setup help text.",
    )
    _require(
        re.search(r"useState\(\s*(['\"])fronius\.local\1\s*\)", source) is None,
        "fronius.local is configured as a value instead of placeholder/help text.",
    )

    compiled_ui = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in react_dist.rglob("*")
        if path.is_file() and path.suffix.lower() in {".html", ".js"}
    )
    _require(
        "fronius.local" in compiled_ui,
        "The compiled frontend does not contain the expected fronius.local help text.",
    )

    return {
        "app": app,
        "executable": executable,
        "info_plist": info_plist,
        "build_info": build_info_path,
        "bundle_icon": icon_path,
        "react_index": react_index,
    }


def macho_architectures(path: Path) -> set[str] | None:
    """Return Mach-O architectures for a file, or None for non-Mach-O files."""
    description = subprocess.run(
        ["file", "-b", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if "Mach-O" not in description:
        return None
    output = subprocess.run(
        ["lipo", "-archs", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return set(output.split())


def _native_candidates(app: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in app.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in NATIVE_SUFFIXES or os.access(path, os.X_OK):
            candidates.append(path)
    return candidates


def validate_architectures(
    app: Path,
    arch_reader: Callable[[Path], set[str] | None] = macho_architectures,
) -> list[tuple[Path, set[str]]]:
    """Require an arm64-only entry point and arm64-compatible native payloads."""
    executable = app / "Contents" / "MacOS" / "EnergyRadar"
    main_architectures = arch_reader(executable)
    _require(
        main_architectures == {"arm64"},
        "Main executable must be native arm64 only; found: "
        + repr(sorted(main_architectures or set())),
    )

    audited: list[tuple[Path, set[str]]] = []
    incompatible: list[str] = []
    for path in _native_candidates(app):
        architectures = arch_reader(path)
        if architectures is None:
            continue
        audited.append((path, architectures))
        if "arm64" not in architectures:
            incompatible.append(
                f"{path.relative_to(app)} ({', '.join(sorted(architectures))})"
            )

    _require(audited, "No Mach-O files were found in the application bundle.")
    _require(
        not incompatible,
        "Native files without arm64 support are bundled: " + "; ".join(incompatible),
    )
    return audited


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument(
        "--project-root",
        type=Path,
        default=PROJECT_ROOT,
    )
    args = parser.parse_args()

    paths = validate_structure(args.app.resolve(), args.project_root.resolve())
    audited = validate_architectures(paths["app"])
    print(f"Validated application: {paths['app']}")
    print("Main executable architecture: arm64")
    print(f"Mach-O files checked for arm64 compatibility: {len(audited)}")
    print(f"Expected archive: {ARM64_ARCHIVE_NAME}")
    print(f"Expected checksum: {ARM64_CHECKSUM_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
