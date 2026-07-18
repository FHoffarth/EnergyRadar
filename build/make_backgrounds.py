"""Erzeugt Platzhalter-Himmel für den "Living Sky"-Hintergrund.

Ruhige, weiche Farbverläufe mit sanftem Licht – bewusst detailarm, damit sie
später 1:1 durch die endgültigen Premium-Illustrationen ersetzt werden können.
Dateinamen und Ordnerstruktur stehen bereits final.

    python build/make_backgrounds.py

Ergebnis:  energyradar/static/assets/backgrounds/<zustand>/<tageszeit>.webp
Benötigt:  pillow  (siehe requirements-build.txt)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "energyradar" / "static" / "assets" / "backgrounds"

SIZE = (1600, 1000)  # 16:10, per object-fit skaliert
QUALITY = 82


def hx(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


# Vertikale Verläufe (oben, unten) je Zustand und Tageszeit.
DAY = {
    "sunny": {
        "morning": ("#243B63", "#F1C88C"),
        "noon":    ("#2E77C9", "#CFE6FA"),
        "evening": ("#20304E", "#EDA65B"),
    },
    "partly_cloudy": {
        "morning": ("#42618C", "#E6C6A0"),
        "noon":    ("#5A93C8", "#DCE9F2"),
        "evening": ("#39485F", "#DFA378"),
    },
    "cloudy": {
        "morning": ("#6E7C8C", "#C4CBD2"),
        "noon":    ("#7E8C9A", "#D3D9DE"),
        "evening": ("#555D6B", "#B7A99B"),
    },
    "rain": {
        "morning": ("#4C565F", "#8B939B"),
        "noon":    ("#566069", "#9BA3AA"),
        "evening": ("#3E454F", "#7C8289"),
    },
    "thunderstorm": {
        "morning": ("#363B45", "#5C6470"),
        "noon":    ("#3A4049", "#606874"),
        "evening": ("#2C3038", "#4E535C"),
    },
    "snow": {
        "morning": ("#A9B6C4", "#EAF1F6"),
        "noon":    ("#B9C6D2", "#F2F6F9"),
        "evening": ("#8E9DB0", "#DDE3EA"),
    },
    "fog": {
        "morning": ("#9AA3A8", "#D9DCDD"),
        "noon":    ("#A6AEB2", "#E1E4E5"),
        "evening": ("#7E868C", "#C5C8CA"),
    },
}

NIGHT = {
    "clear_night": ("#050A18", "#16233F"),
    "cloudy_night": ("#090E18", "#1B2330"),
}

# Sanftes Licht (Position 0..1, Farbe, Stärke 0..255) je Tageszeit.
GLOW = {
    "morning": ((0.30, 0.24), "#FFE7C2", 70),
    "noon":    ((0.50, 0.10), "#FFFFFF", 55),
    "evening": ((0.52, 0.82), "#FFD79A", 80),
    "night":   ((0.50, 0.14), "#26406E", 40),
}


def gradient(top: str, bottom: str) -> Image.Image:
    w, h = SIZE
    t, b = hx(top), hx(bottom)
    base = Image.new("RGB", SIZE)
    px = base.load()
    for y in range(h):
        f = y / (h - 1)
        row = tuple(round(t[i] + (b[i] - t[i]) * f) for i in range(3))
        for x in range(w):
            px[x, y] = row
    return base


def add_glow(base: Image.Image, time: str) -> Image.Image:
    (cx, cy), color, strength = GLOW[time]
    w, h = SIZE
    overlay = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    rx, ry = w * 0.5, h * 0.55
    x, y = cx * w, cy * h
    d.ellipse([x - rx, y - ry, x + rx, y + ry], fill=hx(color) + (strength,))
    overlay = overlay.filter(ImageFilter.GaussianBlur(w * 0.16))
    out = base.convert("RGBA")
    out.alpha_composite(overlay)
    return out.convert("RGB")


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="WEBP", quality=QUALITY, method=6)


def main() -> None:
    count = 0
    for condition, times in DAY.items():
        for time, (top, bottom) in times.items():
            img = add_glow(gradient(top, bottom), time)
            save(img, OUT / condition / f"{time}.webp")
            count += 1
    for folder, (top, bottom) in NIGHT.items():
        img = add_glow(gradient(top, bottom), "night")
        save(img, OUT / folder / "night.webp")
        count += 1
    print(f"{count} Platzhalter geschrieben nach {OUT}")


if __name__ == "__main__":
    main()
