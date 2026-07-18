# Baut EnergyRadar.exe für Windows.
#
#   powershell -ExecutionPolicy Bypass -File build_windows.ps1
#
# Ergebnis:  dist\EnergyRadar\EnergyRadar.exe
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Build-Python pruefen"
python -c "import struct, sys; assert sys.version_info[:2] == (3, 14), sys.version; assert struct.calcsize('P') == 8, '64-bit Python required'"
if ($LASTEXITCODE -ne 0) {
    throw "Der Windows-Build benoetigt 64-bit Python 3.14."
}

Write-Host "==> Abhaengigkeiten installieren"
python -m pip install -r energyradar/requirements.txt
python -m pip install -r requirements-build.txt

Write-Host "==> App-Icon (.ico) erzeugen"
python build/make_ico.py

Write-Host "==> PyInstaller"
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
if (Test-Path build/pyi) { Remove-Item -Recurse -Force build/pyi }
python -m PyInstaller `
    --noconfirm `
    --clean `
    --workpath build/pyi `
    --distpath dist `
    EnergyRadar.spec

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller ist mit Exitcode $LASTEXITCODE fehlgeschlagen."
}

# Die drei projektexternen Loader-Bausteine muessen in ihrer von den Hooks
# erwarteten Verzeichnisstruktur liegen. So scheitert der Build frueh statt
# erst beim Doppelklick auf eine unvollstaendige EXE.
$requiredBundleFiles = @(
    "dist/EnergyRadar/_internal/pythonnet/runtime/Python.Runtime.dll",
    "dist/EnergyRadar/_internal/clr_loader/ffi/dlls/amd64/ClrLoader.dll",
    "dist/EnergyRadar/_internal/webview/lib/runtimes/win-x64/native/WebView2Loader.dll"
)

foreach ($bundleFile in $requiredBundleFiles) {
    if (-not (Test-Path -LiteralPath $bundleFile -PathType Leaf)) {
        throw "Unvollstaendiges Bundle: $bundleFile fehlt."
    }
}

Write-Host ""
Write-Host "Fertig:  dist\EnergyRadar\EnergyRadar.exe"
