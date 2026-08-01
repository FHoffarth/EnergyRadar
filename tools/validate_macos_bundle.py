#!/usr/bin/env python3
"""Validate a native EnergyRadar macOS bundle and write an audit report."""

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


SUPPORTED_ARCHITECTURES = {"arm64", "x86_64"}
FORBIDDEN_BUNDLE_NAMES = {
    ".env",
    "data-source.json",
    "energy.db",
    "settings.json",
    "ui-settings.json",
    "weather-cache.json",
    "window.json",
}
NATIVE_SUFFIXES = {".dylib", ".so", ".pyd"}
DEVELOPER_PATH_PATTERNS = (
    re.compile(r"[A-Za-z]:\\Users\\", re.IGNORECASE),
    re.compile(r"/Users/[^/]+/(?:Desktop|Documents|Downloads|workspace|work)/"),
    re.compile(r"/home/[^/]+/(?:workspace|work)/"),
)


class BundleValidationError(RuntimeError):
    """Raised when a packaged macOS bundle violates the release contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BundleValidationError(message)


def macos_marketing_version(app_version: str) -> str:
    """Return Apple's numeric marketing-version form of the app version."""
    return app_version.partition("-")[0]


def artifact_basename(architecture: str, short_sha: str) -> str:
    _require(architecture in SUPPORTED_ARCHITECTURES, f"Unsupported architecture: {architecture}")
    _require(re.fullmatch(r"[0-9a-f]{7,12}", short_sha) is not None, "Invalid short commit SHA.")
    return f"EnergyRadar-macOS-{architecture}-{short_sha}.zip"


def _find_named(app: Path, name: str) -> list[Path]:
    return [path for path in app.rglob(name) if path.is_file()]


def validate_structure(
    app: Path,
    project_root: Path,
    expected_architecture: str,
    expected_source_commit: str | None = None,
) -> dict[str, Path | str]:
    """Validate resources, metadata, local-data exclusions, and defaults."""
    _require(expected_architecture in SUPPORTED_ARCHITECTURES, "Unsupported architecture contract.")
    _require(app.is_dir(), f"Application bundle is missing: {app}")

    executable = app / "Contents" / "MacOS" / "EnergyRadar"
    info_plist = app / "Contents" / "Info.plist"
    resources = app / "Contents" / "Resources"
    react_dist = resources / "react-ui" / "dist"
    react_index = react_dist / "index.html"
    build_info_path = resources / "BUILDINFO.json"

    _require(executable.is_file(), f"Main executable is missing: {executable}")
    _require(os.access(executable, os.X_OK), f"Main executable is not executable: {executable}")
    _require(info_plist.is_file(), f"Info.plist is missing: {info_plist}")
    _require(build_info_path.is_file(), f"BUILDINFO.json is missing: {build_info_path}")
    _require(react_index.is_file(), f"React entry point is missing: {react_index}")
    _require(any(react_dist.glob("assets/*.js")), "Compiled React JavaScript is missing.")
    _require(_find_named(app, "QtWebEngineProcess"), "QtWebEngineProcess is missing.")
    _require(_find_named(app, "libqcocoa.dylib"), "Qt Cocoa platform plugin is missing.")
    _require(_find_named(app, "qtwebengine_resources.pak"), "QtWebEngine resources are missing.")
    _require(
        any(path.name == "Python" and "Python.framework" in path.parts for path in app.rglob("Python")),
        "Bundled Python framework executable is missing.",
    )

    with info_plist.open("rb") as handle:
        plist = plistlib.load(handle)
    expected_bundle_version = macos_marketing_version(config.APP_VERSION)
    _require(plist.get("CFBundleExecutable") == "EnergyRadar", "Info.plist executable is incorrect.")
    _require(plist.get("CFBundleIdentifier") == "com.energyradar.app", "Bundle identifier is incorrect.")
    _require(
        plist.get("CFBundleShortVersionString") == expected_bundle_version,
        "Info.plist version does not match the authoritative application version.",
    )
    _require(plist.get("CFBundleVersion") == config.APP_BUILD, "Info.plist build version is inconsistent.")
    icon_name = plist.get("CFBundleIconFile")
    _require(bool(icon_name), "Info.plist does not declare a bundle icon.")
    icon_path = resources / str(icon_name)
    if not icon_path.suffix:
        icon_path = icon_path.with_suffix(".icns")
    _require(icon_path.is_file(), f"Declared bundle icon is missing: {icon_path}")

    build_info = json.loads(build_info_path.read_text(encoding="utf-8"))
    _require(build_info.get("app_version") == config.APP_VERSION, "BUILDINFO app version is inconsistent.")
    _require(build_info.get("bundle_version") == expected_bundle_version, "BUILDINFO bundle version is inconsistent.")
    _require(build_info.get("build_version") == config.APP_BUILD, "BUILDINFO build version is inconsistent.")
    _require(build_info.get("architecture") == expected_architecture, "BUILDINFO architecture is inconsistent.")
    source_commit = str(build_info.get("source_commit", ""))
    _require(re.fullmatch(r"[0-9a-f]{40}", source_commit) is not None, "BUILDINFO source commit is invalid.")
    if expected_source_commit:
        _require(source_commit == expected_source_commit, "BUILDINFO source commit does not match the workflow commit.")

    forbidden: list[Path] = []
    broken_symlinks: list[Path] = []
    developer_paths: list[str] = []
    for path in app.rglob("*"):
        if path.is_symlink() and not path.exists():
            broken_symlinks.append(path.relative_to(app))
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if lowered in FORBIDDEN_BUNDLE_NAMES or lowered.endswith((".db", ".sqlite", ".sqlite3")) or lowered.startswith(".env."):
            forbidden.append(path.relative_to(app))
        if path.stat().st_size <= 5_000_000:
            text = path.read_text(encoding="utf-8", errors="ignore")
            for pattern in DEVELOPER_PATH_PATTERNS:
                if pattern.search(text):
                    developer_paths.append(str(path.relative_to(app)))
                    break
    _require(not forbidden, "Private configuration or local database files are bundled: " + ", ".join(map(str, forbidden)))
    _require(not broken_symlinks, "Broken symlinks are bundled: " + ", ".join(map(str, broken_symlinks)))
    _require(not developer_paths, "Developer-local paths are bundled in: " + ", ".join(developer_paths))

    setup_wizard = project_root / "frontend" / "react-ui" / "src" / "components" / "SetupWizardModal.tsx"
    source = setup_wizard.read_text(encoding="utf-8")
    _require(re.search(r"const\s+\[host,\s*setHost\]\s*=\s*useState\(\s*(['\"])\1\s*\)", source) is not None, "The setup wizard Fronius host default is not empty.")
    _require(re.search(r"placeholder\s*=\s*(['\"])fronius\.local\1", source) is not None, "fronius.local is not present only as help text.")
    _require(re.search(r"useState\(\s*(['\"])fronius\.local\1\s*\)", source) is None, "fronius.local is configured as a value.")

    return {
        "app": app,
        "executable": executable,
        "info_plist": info_plist,
        "build_info": build_info_path,
        "bundle_icon": icon_path,
        "react_index": react_index,
        "source_commit": source_commit,
        "bundle_version": expected_bundle_version,
    }


def macho_architectures(path: Path) -> set[str] | None:
    description = subprocess.run(["file", "-b", str(path)], check=True, capture_output=True, text=True).stdout
    if "Mach-O" not in description:
        return None
    output = subprocess.run(["lipo", "-archs", str(path)], check=True, capture_output=True, text=True).stdout
    return set(output.split())


def _native_candidates(app: Path) -> list[Path]:
    return [
        path for path in app.rglob("*")
        if path.is_file() and (path.suffix.lower() in NATIVE_SUFFIXES or os.access(path, os.X_OK))
    ]


def _audit_linkage(path: Path) -> list[str]:
    findings: list[str] = []
    linked = subprocess.run(["otool", "-L", str(path)], check=True, capture_output=True, text=True).stdout
    load_commands = subprocess.run(["otool", "-l", str(path)], check=True, capture_output=True, text=True).stdout
    for output in (linked, load_commands):
        for pattern in DEVELOPER_PATH_PATTERNS:
            if pattern.search(output):
                findings.append(f"developer path in Mach-O metadata: {pattern.pattern}")
    return findings


def validate_architectures(
    app: Path,
    expected_architecture: str,
    arch_reader: Callable[[Path], set[str] | None] = macho_architectures,
    audit_linkage: bool = True,
) -> list[tuple[Path, set[str]]]:
    """Require the requested native architecture in every bundled Mach-O."""
    _require(expected_architecture in SUPPORTED_ARCHITECTURES, "Unsupported architecture contract.")
    executable = app / "Contents" / "MacOS" / "EnergyRadar"
    main_architectures = arch_reader(executable)
    _require(
        main_architectures == {expected_architecture},
        f"Main executable must be native {expected_architecture} only; found: {sorted(main_architectures or set())}",
    )

    audited: list[tuple[Path, set[str]]] = []
    incompatible: list[str] = []
    linkage_findings: list[str] = []
    for path in _native_candidates(app):
        architectures = arch_reader(path)
        if architectures is None:
            continue
        audited.append((path, architectures))
        if expected_architecture not in architectures:
            incompatible.append(f"{path.relative_to(app)} ({', '.join(sorted(architectures))})")
        if audit_linkage:
            linkage_findings.extend(
                f"{path.relative_to(app)}: {finding}" for finding in _audit_linkage(path)
            )
    _require(audited, "No Mach-O files were found in the application bundle.")
    _require(not incompatible, f"Native files without {expected_architecture} support are bundled: " + "; ".join(incompatible))
    _require(not linkage_findings, "Unsafe Mach-O linkage metadata: " + "; ".join(linkage_findings))
    return audited


def signing_state(app: Path) -> str:
    result = subprocess.run(["codesign", "-dv", "--verbose=4", str(app)], capture_output=True, text=True)
    details = result.stderr + result.stdout
    if result.returncode != 0:
        return "unsigned"
    if "Authority=Developer ID Application:" in details:
        return "Developer ID signed"
    return "ad-hoc signed"


def write_report(
    destination: Path,
    paths: dict[str, Path | str],
    architecture: str,
    audited: list[tuple[Path, set[str]]],
    signing: str,
) -> None:
    app = Path(paths["app"])
    lines = [
        "format=energyradar-macos-architecture-audit-v1",
        f"source_commit={paths['source_commit']}",
        f"application_version={config.APP_VERSION}",
        f"bundle_version={paths['bundle_version']}",
        f"architecture={architecture}",
        f"main_executable_architecture={architecture}",
        f"macho_file_count={len(audited)}",
        f"signing_state={signing}",
        "notarized=false",
        "stapled=false",
        "broken_symlinks=0",
        "private_configuration_files=0",
        "developer_local_paths=0",
        "",
        "path\tarchitectures",
    ]
    lines.extend(
        f"{path.relative_to(app)}\t{','.join(sorted(architectures))}"
        for path, architectures in audited
    )
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    parser.add_argument("--arch", required=True, choices=sorted(SUPPORTED_ARCHITECTURES))
    parser.add_argument("--project-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--expected-source-commit")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    paths = validate_structure(
        args.app.resolve(),
        args.project_root.resolve(),
        args.arch,
        expected_source_commit=args.expected_source_commit or os.environ.get("GITHUB_SHA"),
    )
    audited = validate_architectures(Path(paths["app"]), args.arch)
    signing = signing_state(Path(paths["app"]))
    write_report(args.report.resolve(), paths, args.arch, audited, signing)
    print(f"Validated application: {paths['app']}")
    print(f"Main executable architecture: {args.arch}")
    print(f"Mach-O files checked: {len(audited)}")
    print(f"Signing state: {signing}")
    print(f"Audit report: {args.report.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
