#!/usr/bin/env bash
#
# Baut EnergyRadar.app für macOS.
# Muss auf einem Mac laufen – ein .app-Bundle lässt sich nicht auf Windows/Linux
# erzeugen (PyInstaller kann nicht cross-compilen).
#
#   ./build_macos.sh
#
# Ergebnis:  dist/EnergyRadar.app
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Abhängigkeiten installieren"
python3 -m pip install -r energyradar/requirements.txt
python3 -m pip install -r requirements-build.txt

echo "==> App-Icon (.icns) erzeugen"
SRC="energyradar/static/icons/icon-512.png"
ICONSET="build/EnergyRadar.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size            "$SRC" --out "$ICONSET/icon_${size}x${size}.png"   >/dev/null
  sips -z $((size*2)) $((size*2)) "$SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/EnergyRadar.icns
echo "    -> build/EnergyRadar.icns"

echo "==> PyInstaller"
rm -rf build/EnergyRadar build/EnergyRadar.app dist
python3 -m PyInstaller --noconfirm EnergyRadar.spec

echo
echo "Fertig:  dist/EnergyRadar.app"
echo "Zum Testen:  open dist/EnergyRadar.app"
