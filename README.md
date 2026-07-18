# ☀️ EnergyRadar

Understand your energy. EnergyRadar zeigt die aktuelle Leistung deiner
PV‑Anlage (Fronius), den heutigen Verlauf und Empfehlungen – als **native
Desktop‑Anwendung**. Ein Flask‑Server läuft dabei unsichtbar im Hintergrund;
der Nutzer sieht nur ein normales App‑Fenster. Kein Terminal, kein Browser,
keine URL.

```
Doppelklick  →  EnergyRadar öffnet sich  →  alles läuft
```

---

## Architektur in einem Absatz

Die Anwendung selbst ist unverändert: ein kleiner Flask‑Server
(`energyradar/app.py`) mit Collector, Decision‑Engine und SQLite‑Storage.
Neu ist nur der **native Wrapper** `energyradar/desktop.py`: er startet den
bestehenden Server still auf `127.0.0.1` (freier Port) und zeigt ihn in einem
nativen Fenster über [**pywebview**](https://pywebview.flowrl.com/). Kein
Electron, kein zusätzlicher Browser – pywebview nutzt die Systemkomponente
(WKWebView auf macOS, WebView2 auf Windows). Das ist die leichteste Lösung,
die die vorhandene Architektur vollständig erhält.

---

## Entwicklungsmodus

Reine Web‑Ansicht im Browser (wie bisher):

```bash
cd energyradar
pip install -r requirements.txt
ENERGYRADAR_DEMO=1 python app.py      # Demo-Daten, ohne Wechselrichter
# → http://127.0.0.1:5000
```

Natives Fenster testen (ohne Build):

```bash
cd energyradar
pip install -r requirements.txt
ENERGYRADAR_DEMO=1 python desktop.py  # öffnet das App-Fenster
```

Ohne `ENERGYRADAR_DEMO=1` verbindet sich EnergyRadar mit dem echten
Wechselrichter (`FRONIUS_URL`, siehe `config.py`).

---

## Production Build

Ergebnis ist eine eigenständige App, die per Doppelklick startet.

### Benötigte Pakete

| Zweck        | Datei                     | Pakete                     |
| ------------ | ------------------------- | -------------------------- |
| Laufzeit     | `energyradar/requirements.txt` | flask, requests, pywebview |
| Build        | `requirements-build.txt`  | pyinstaller, pillow        |

### Build macOS

Auf einem **Mac** ausführen:

```bash
./build_macos.sh
```

Installiert die Abhängigkeiten, erzeugt das Icon (`sips` + `iconutil`) und baut
mit PyInstaller. Ergebnis: `dist/EnergyRadar.app` (Doppelklick oder nach
*/Programme* ziehen).

### Build Windows

Auf **Windows** ausführen:

```powershell
powershell -ExecutionPolicy Bypass -File build_windows.ps1
```

Ergebnis: `dist/EnergyRadar/EnergyRadar.exe` (Doppelklick).

> **Kein Cross‑Compile:** Das `.app` lässt sich nur auf einem Mac bauen, die
> `.exe` nur auf Windows – PyInstaller baut nie für ein fremdes Betriebssystem.

---

## Verhalten der gepackten App

- **Start:** Zuerst erscheint ein kleiner Splash („EnergyRadar wird gestartet …“),
  während Flask still im Hintergrund hochfährt – kein leeres weißes Fenster.
  Danach öffnet sich das Hauptfenster. Kein Konsolenfenster, keine URL.
- **Fenster:** Titel „EnergyRadar“, Standardgröße 980×900, veränderbar,
  Mindestgröße 420×640. **Position und Größe** werden gemerkt.
  macOS‑Dark‑Mode wird unterstützt (die Oberfläche folgt dem System).
- **Menü:** „Über EnergyRadar“ (zeigt die Version) und „Beenden“.
- **Beenden:** ⌘Q (macOS) bzw. Alt+F4 (Windows) oder Fenster schließen stoppt
  den Server, gibt den Port frei und beendet alle Hintergrund‑Threads sauber –
  keine verwaisten Prozesse.
- **Fehlerfall:** Kann der Server nicht starten, erscheint ein freundlicher
  Hinweis im Fenster (kein Traceback):
  *„EnergyRadar konnte nicht gestartet werden. Bitte starten Sie die Anwendung
  neu.“*

### Wo liegen Daten und Logs?

In der gepackten App wird ins beschreibbare Benutzerverzeichnis geschrieben
(das Bundle selbst bleibt unangetastet):

| Plattform | Ort                                                     |
| --------- | ------------------------------------------------------- |
| macOS     | `~/Library/Application Support/EnergyRadar/`             |
| Windows   | `%LOCALAPPDATA%\EnergyRadar\`                            |

Dort liegen `database/energy.db`, `energyradar.log` und `window.json`.
Im Entwicklungsmodus bleibt alles wie bisher im Projektordner.

---

## Living Sky (atmosphärischer Hintergrund)

Hinter dem Dashboard liegt ein ruhiger Himmel-Hintergrund, der die Tages- und
Wetterstimmung andeutet. Er liegt immer **hinter** den Inhalten; die Karten
bleiben durch einen leichten Glaseffekt (Transparenz + Backdrop-Blur) dominant
und gut lesbar.

- **Bilder:** lokal, WebP, unter `energyradar/static/assets/backgrounds/`.
  Kein Download, kein externer Request.
  ```
  assets/backgrounds/
      sunny/  partly_cloudy/  cloudy/  rain/  thunderstorm/  snow/  fog/
          morning.webp  noon.webp  evening.webp
      clear_night/  cloudy_night/
          night.webp
  ```
- **BackgroundManager** (`static/background.js`): wählt über eine einfache
  Mapping-Tabelle aus **Tageszeit** (lokale Uhr) und **Wetterzustand** das
  passende Bild und blendet es per CSS-Opacity weich um (2,5 s Crossfade,
  keine JS-Animation). Bilder werden nur bei Bedarf geladen (lazy).
- **Platzhalter:** Die mitgelieferten Bilder sind bewusst schlichte
  Farbverläufe. Sie lassen sich 1:1 durch die endgültigen Premium-Himmel
  ersetzen – gleiche Ordner, gleiche Dateinamen. Neu erzeugen:
  `python build/make_backgrounds.py`.

> **Hinweis zur Wetterquelle:** EnergyRadar besitzt aktuell **keine
> Wetterdaten** (nur Fronius-PV-Werte). Deshalb steuert heute die **Tageszeit**
> den Himmel, der Wetterzustand hat den Standard `sunny`. Die Architektur ist
> vollständig: Sobald eine Wetterquelle existiert, genügt
> `window.energyRadarWeather = "rain"` (o. Ä.) – der Crossfade zum passenden
> Bild passiert automatisch.

---

## Projektstruktur (Ergänzungen dieses Sprints)

```
energyradar/
    desktop.py            ← nativer Wrapper (Start, Fenster, Shutdown)
    config.py             ← DATA_DIR: schreibbarer Ort, wenn gepackt
    static/
        background.js     ← BackgroundManager (Living Sky)
        assets/backgrounds/  ← lokale Himmel-Platzhalter (WebP)
    app.py, collectors/, services/, models/, templates/   (Backend unverändert)
EnergyRadar.spec          ← PyInstaller-Konfiguration (macOS + Windows)
build_macos.sh            ← Build → dist/EnergyRadar.app
build_windows.ps1         ← Build → dist/EnergyRadar/EnergyRadar.exe
build/make_ico.py         ← erzeugt das Windows-Icon
build/make_backgrounds.py ← erzeugt die Himmel-Platzhalter
requirements-build.txt    ← Build-Werkzeuge
```
