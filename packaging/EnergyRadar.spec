# -*- mode: python ; coding: utf-8 -*-
"""Canonical PyInstaller specification for the EnergyRadar desktop app."""

import os
import sys
from pathlib import Path


APP_NAME = "EnergyRadar"
MACOS_MARKETING_VERSION = os.environ.get("ENERGYRADAR_MACOS_VERSION", "0.5.0")
MACOS_BUILD_VERSION = os.environ.get("ENERGYRADAR_MACOS_BUILD", "1")
PROJECT_ROOT = Path(SPECPATH).resolve().parent
ENTRY_POINT = PROJECT_ROOT / "desktop_web.py"
REACT_DIST = PROJECT_ROOT / "frontend" / "react-ui" / "dist"
UI_ASSETS = PROJECT_ROOT / "energyradar" / "ui" / "assets"

if sys.platform == "win32":
    executable_icon = str(UI_ASSETS / "logo.ico")
    bundle_icon = None
elif sys.platform == "darwin":
    executable_icon = None
    # PyInstaller converts the source PNG to ICNS through Pillow.
    bundle_icon = str(PROJECT_ROOT / "energyradar" / "static" / "icons" / "icon-512.png")
else:
    executable_icon = None
    bundle_icon = None

a = Analysis(
    [str(ENTRY_POINT)],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=[
        (str(REACT_DIST), "react-ui/dist"),
        (str(UI_ASSETS), "energyradar/ui/assets"),
    ],
    hiddenimports=[
        "PySide6.QtWebEngineCore",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebChannel",
        "sqlite3",
        "json",
        "zipfile",
        "hashlib",
        "csv",
        "energyradar",
        "energyradar.config",
        "energyradar.ui.bridge",
        "energyradar.services.migration",
        "energyradar.services.weather.service",
        "energyradar.services.weather.providers.open_meteo",
        "energyradar.services.forecast",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=executable_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=APP_NAME,
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon=bundle_icon,
        bundle_identifier="com.energyradar.app",
        info_plist={
            "CFBundleName": APP_NAME,
            "CFBundleDisplayName": APP_NAME,
            "CFBundleShortVersionString": MACOS_MARKETING_VERSION,
            "CFBundleVersion": MACOS_BUILD_VERSION,
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
            "LSApplicationCategoryType": "public.app-category.utilities",
        },
    )
