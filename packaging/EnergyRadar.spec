# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

a = Analysis(
    ['../desktop_web.py'],
    pathex=['..'],
    binaries=[],
    datas=[
        ('../frontend/react-ui/dist', 'react-ui/dist'),
        ('../energyradar/ui/assets', 'energyradar/ui/assets'),
    ],
    hiddenimports=[
        'PySide6.QtWebEngineCore',
        'PySide6.QtWebEngineWidgets',
        'PySide6.QtWebChannel',
        'sqlite3',
        'json',
        'zipfile',
        'hashlib',
        'csv',
        'energyradar',
        'energyradar.config',
        'energyradar.ui.bridge',
        'energyradar.services.migration',
        'energyradar.services.weather.service',
        'energyradar.services.weather.providers.open_meteo',
        'energyradar.services.forecast',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='EnergyRadar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='../energyradar/ui/assets/logo.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='EnergyRadar',
)
