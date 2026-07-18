# Baut EnergyRadar.exe für Windows.
#
#   powershell -ExecutionPolicy Bypass -File build_windows.ps1
#
# Ergebnis:  dist\EnergyRadar\EnergyRadar.exe
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Abhaengigkeiten installieren"
python -m pip install -r energyradar/requirements.txt
python -m pip install -r requirements-build.txt

Write-Host "==> App-Icon (.ico) erzeugen"
python build/make_ico.py

Write-Host "==> PyInstaller"
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
python -m PyInstaller --noconfirm EnergyRadar.spec

Write-Host ""
Write-Host "Fertig:  dist\EnergyRadar\EnergyRadar.exe"
