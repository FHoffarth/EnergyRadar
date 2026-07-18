# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller-Spec für EnergyRadar (plattformübergreifend).

Baut auf macOS ein EnergyRadar.app, auf Windows eine EnergyRadar.exe.
Der Einstiegspunkt ist der native Wrapper energyradar/desktop.py, der den
bestehenden Flask-Server still im Hintergrund startet.

Build:  pyinstaller EnergyRadar.spec        (siehe README / Build-Skripte)
"""

import sys
from pathlib import Path

APP_NAME = "EnergyRadar"
PKG = Path("energyradar")

# --- Ressourcen und Module ------------------------------------------------- #
# templates/ und static/ liegen im Bundle neben dem Programm; desktop.py zeigt
# Flask im gepackten Zustand dorthin.
datas = [
    (str(PKG / "templates"), "templates"),
    (str(PKG / "static"), "static"),
]

# pywebview 6.x liefert einen eigenen PyInstaller-Hook. Dieser sammelt unter
# Windows webview/lib (inkl. WebView2Loader.dll) und auf allen Plattformen die
# JavaScript-Ressourcen. pythonnet und clr_loader liefern ebenfalls Hooks fuer
# Python.Runtime.dll bzw. ClrLoader.dll. Eine zweite, manuelle Vollsammlung von
# webview wuerde plattformfremde Backends einziehen und die Hook-Ergebnisse
# duplizieren.

# Module, die dynamisch (in Funktionen) importiert werden.
hiddenimports = [
    "app", "config",
    "collectors.fronius",
    "services.decision", "services.storage",
    "models.energy",
]

# --- Plattform-Icon -------------------------------------------------------- #
if sys.platform == "darwin":
    icon = "build/EnergyRadar.icns"
elif sys.platform == "win32":
    icon = "build/EnergyRadar.ico"
else:
    icon = None

block_cipher = None

a = Analysis(
    [str(PKG / "desktop.py")],
    pathex=[str(PKG)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
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
    console=False,          # kein Konsolenfenster – rein grafische App
    disable_windowed_traceback=True,
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

# macOS: aus dem COLLECT-Ergebnis ein natives .app-Bundle schnüren.
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
            # Dark Mode zulassen (nicht auf helles Aussehen festnageln).
            "NSRequiresAquaSystemAppearance": False,
            "LSApplicationCategoryType": "public.app-category.utilities",
        },
    )
