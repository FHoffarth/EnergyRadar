"""Erzeugt build/EnergyRadar.ico (Windows) aus dem 512px-App-Icon.

Aufruf:  python build/make_ico.py
Benötigt: pillow  (siehe requirements-build.txt)

Das macOS-Icon (.icns) wird nicht hier, sondern in build_macos.sh mit den
Bordmitteln von macOS (sips + iconutil) erzeugt.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "energyradar" / "static" / "icons" / "icon-512.png"
TARGET = ROOT / "build" / "EnergyRadar.ico"
SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    img = Image.open(SOURCE).convert("RGBA")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    img.save(TARGET, format="ICO", sizes=SIZES)
    print(f"geschrieben: {TARGET}  ({TARGET.stat().st_size} Bytes)")


if __name__ == "__main__":
    main()
