# ☀️ EnergyRadar

Understand your energy. EnergyRadar zeigt die aktuelle Leistung deiner
PV‑Anlage (Fronius), den heutigen Verlauf und Empfehlungen – als **native
Desktop‑Anwendung**. Ein Flask‑Server läuft dabei unsichtbar im Hintergrund;
der Nutzer sieht nur ein normales App‑Fenster. Kein Terminal, kein Browser,
keine URL.

## ⬇ Downloads

| Plattform | Download | Status |
| --------- | -------- | ------ |
| Windows x64 | [EnergyRadar-Windows-x64.zip](https://github.com/FHoffarth/EnergyRadar/releases/latest/download/EnergyRadar-Windows-x64.zip) | verifiziert |
| macOS Intel | [EnergyRadar-macOS-Intel.zip](https://github.com/FHoffarth/EnergyRadar/releases/latest/download/EnergyRadar-macOS-Intel.zip) | verifiziert |

[Prüfsummen (SHA-256)](https://github.com/FHoffarth/EnergyRadar/releases/latest/download/SHA256SUMS.txt) · [Alle Releases](https://github.com/FHoffarth/EnergyRadar/releases)

Ein nativer Apple-Silicon-Build wird erst angeboten, wenn er separat getestet
und verifiziert wurde. Die Intel-App kann auf Apple Silicon über Rosetta 2
ausgeführt werden.

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

EnergyRadar benötigt Python 3.10 oder neuer und wurde in diesem Audit mit
Python 3.14.6 validiert. Die verfügbaren Umgebungsvariablen sind mit sicheren
Platzhaltern in [`.env.example`](.env.example) dokumentiert; `.env`-Dateien
werden nicht automatisch geladen.

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

Für den Live-Modus muss `FRONIUS_URL` explizit auf den lokalen Fronius-Endpunkt
gesetzt werden. Ohne Demo-Modus und ohne `FRONIUS_URL` zeigt EnergyRadar den
Offline-Zustand, ohne einen Netzwerkaufruf zu versuchen.

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

### Automatischer Build (GitHub Actions)

Bei jedem Push auf `main` und für jeden `v*`-Tag baut [`.github/workflows/build.yml`](.github/workflows/build.yml)
EnergyRadar parallel auf `windows-latest` und `macos-15-intel` (über die obigen
Build‑Skripte) und lädt die Ergebnisse als Artefakte hoch:

- **EnergyRadar-windows** – der lauffähige Ordner mit `EnergyRadar.exe`
- **EnergyRadar-macos** – die gepackte `EnergyRadar.app` (x86_64; läuft nativ
  auf Intel-Macs und per Rosetta 2 auf Apple Silicon)

> **Warum `macos-15-intel`?** PyInstaller baut immer für die Architektur des Runners.
> `macos-latest` ist Apple Silicon (arm64) und erzeugt eine App, die auf
> Intel-Macs nicht startet. Der Intel-Runner `macos-15-intel` erzeugt eine x86_64-App,
> die auf beiden Architekturen läuft. Der Build-Log enthält einen Diagnose-Schritt
> (`file`, `lipo`, `otool`, `codesign`, `spctl`, `plutil`) zur Kontrolle.

Herunterladbar im jeweiligen Workflow‑Lauf unter *Actions → Artifacts*. Keine
Secrets nötig. Manuell startbar über *Run workflow*. Bei einem `v*`-Tag erzeugt
die Pipeline zusätzlich einen GitHub Release mit den stabil benannten Windows-
und macOS-ZIP-Dateien sowie `SHA256SUMS.txt`.

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

Haushaltsmesswerte, lokale Gerätekonfiguration, Logs, Bytecode und virtuelle
Umgebungen sind von Git ausgeschlossen und dürfen nicht committed werden.

---

## Living Sky (zustandsbasierte Atmosphäre)

Hinter dem Workspace liegt eine rein CSS-basierte Himmelsebene. Sie verwendet
keine Bilder, Videos, Wetterdaten oder dauerhafte JavaScript-Render-Schleife.
Die Inhalte bleiben durch Scrim und Glaseffekt visuell dominant.

- **Tageszeit und PV-Leistung:** Die zentrale Energy-State-Schicht liefert
  fertige Sky-Tokens für Phase, Helligkeit, Sättigung und Glow.
- **Living-Sky-Consumer:** `static/background.js` enthält keine Schwellenwerte
  und interpretiert keine Rohdaten. Er wendet nur die State-Tokens an.
- **Bewegung:** Zwei große Gradient-Layer driften ausschließlich über
  compositor-freundliche Transforms mit 140 bzw. 180 Sekunden Laufzeit.
- **Barrierefreiheit:** `prefers-reduced-motion` deaktiviert Drift und
  Übergänge vollständig.

EnergyRadar besitzt aktuell keine Wetter- oder Netzbezugsdaten. Niedrige
PV-Leistung wird deshalb nicht als Netzbezug interpretiert; der zentrale State
führt diese Information ausdrücklich als `unknown`.

## Energy Intelligence Layer

`static/energy-state.js` ist die einzige Präsentationsschicht zwischen
Rohtelemetrie und UI. Sie publiziert unveränderliche Snapshots mit:

- `phase`, `production`, `trend`, `connection` und `source`
- einem faktenbasierten `assessment`
- zentralen `appearance`-Tokens für Living Sky, Accent und Chart
- einem zentralen `motion`-Profil einschließlich Reduced Motion

`app.js` reicht API-Werte über `updateTelemetry(...)` hinein. Living Sky,
Energy Presence, Verbindungsstatus, Farbakzente und Animationen abonnieren
denselben State und enthalten keine eigenen Leistungsschwellen. Aussagen über
Wetter, zukünftige Peaks, Batterien oder Geräte werden ohne entsprechende
Datenquelle nicht erzeugt.

---

## Projektstruktur (Ergänzungen dieses Sprints)

```
energyradar/
    desktop.py            ← nativer Wrapper (Start, Fenster, Shutdown)
    config.py             ← DATA_DIR: schreibbarer Ort, wenn gepackt
    static/
        energy-state.js   ← zentrale Präsentations- und Zustandslogik
        background.js     ← Living-Sky-Consumer des Energy State
    app.py, collectors/, services/, models/, templates/   (Backend unverändert)
EnergyRadar.spec          ← PyInstaller-Konfiguration (macOS + Windows)
build_macos.sh            ← Build → dist/EnergyRadar.app
build_windows.ps1         ← Build → dist/EnergyRadar/EnergyRadar.exe
build/make_ico.py         ← erzeugt das Windows-Icon
requirements-build.txt    ← Build-Werkzeuge
```
