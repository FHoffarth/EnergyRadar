# Compatibility wrapper for the canonical EnergyRadar build.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

python -c "import struct, sys; assert sys.version_info[:2] == (3, 14), sys.version; assert struct.calcsize('P') == 8, '64-bit Python required'"
if ($LASTEXITCODE -ne 0) {
    throw "The Windows build requires 64-bit Python 3.14."
}

python tools/build.py
if ($LASTEXITCODE -ne 0) {
    throw "The canonical EnergyRadar build failed with exit code $LASTEXITCODE."
}
