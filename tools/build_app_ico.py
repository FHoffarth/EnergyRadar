"""Assemble the Windows application ICO from the delivered icon rasters.

The delivered ``favicon.ico`` carries only 16/32/48, which Windows upscales for
Explorer's large-icon views, Alt-Tab and HiDPI taskbars. This packs the same
approved PNG exports into a fuller multi-size ICO. It repackages the delivered
rasters byte-for-byte -- no resampling, no new artwork.

    python tools/build_app_ico.py

Writes energyradar/ui/assets/logo.ico.
"""
from __future__ import annotations

import struct
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = PROJECT_ROOT / "frontend" / "react-ui" / "public" / "icons"
TARGET = PROJECT_ROOT / "energyradar" / "ui" / "assets" / "logo.ico"

# Every size Windows asks for, mapped to the delivered export for that size.
MEMBERS = [
    (16, "favicon-16x16.png"),
    (24, "favicon-24x24.png"),
    (32, "favicon-32x32.png"),
    (48, "favicon-48x48.png"),
    (64, "favicon-64x64.png"),
    (128, "favicon-128x128.png"),
    (256, "favicon-256x256.png"),
]


def build() -> Path:
    blobs: list[tuple[int, bytes]] = []
    for size, name in MEMBERS:
        path = SOURCE_DIR / name
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{path} is not a PNG")
        width, height = struct.unpack(">II", data[16:24])
        if (width, height) != (size, size):
            raise SystemExit(f"{path} is {width}x{height}, expected {size}x{size}")
        blobs.append((size, data))

    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = len(header) + 16 * len(blobs)
    directory = b""
    for size, data in blobs:
        # 0 in the byte-sized width/height fields means 256 in the ICO format.
        byte_size = 0 if size == 256 else size
        directory += struct.pack(
            "<BBBBHHII", byte_size, byte_size, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)

    TARGET.write_bytes(header + directory + b"".join(data for _, data in blobs))
    return TARGET


if __name__ == "__main__":
    out = build()
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(MEMBERS)} sizes)")
