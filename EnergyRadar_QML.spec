# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

APP_NAME = "EnergyRadar"
PKG = Path("energyradar")

datas = [
    (str(PKG / "ui" / "qml"), "energyradar/ui/qml"),
    (str(PKG / "static"), "energyradar/static"),
]

hiddenimports = [
    "PySide6.QtQuick",
    "PySide6.QtQuickControls2",
    "PySide6.QtQml",
    "energyradar.config",
    "energyradar.collectors.fronius",
    "energyradar.collectors.mt175",
    "energyradar.services.data_source",
    "energyradar.services.storage",
    "energyradar.services.decision",
    "energyradar.models.energy",
    "energyradar.models.mt175",
    "energyradar.ui.strings_de",
    "energyradar.ui.settings",
    "energyradar.ui.viewmodels",
    "energyradar.ui.bridge",
]

binaries = []

if sys.platform == "win32":
    python_stable_abi = Path(sys.base_prefix) / "python3.dll"
    if python_stable_abi.is_file():
        binaries.append((str(python_stable_abi), "."))

if sys.platform == "darwin":
    icon = "build/EnergyRadar.icns"
elif sys.platform == "win32":
    icon = "build/EnergyRadar.ico"
else:
    icon = None

block_cipher = None

a = Analysis(
    ["desktop_qml.py"],
    pathex=[str(Path(".").resolve())],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "flask", "werkzeug", "webview"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

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
    icon=icon,
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
        icon=icon,
        bundle_identifier="com.energyradar.app",
        info_plist={
            "CFBundleName": APP_NAME,
            "CFBundleDisplayName": APP_NAME,
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
        },
    )
