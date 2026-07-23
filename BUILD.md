# EnergyRadar Build Instructions

Diese Dokumentation beschreibt den Build-Prozess für die Windows Beta-Version von EnergyRadar.

## Voraussetzungen
1. **Python 3.14 x64** mit den Abhängigkeiten aus `energyradar/requirements.txt`.
2. **Node.js** und die durch `frontend/react-ui/package-lock.json` gesperrten Pakete.
3. **PyInstaller** aus `requirements-build.txt`.
4. **Inno Setup 6** für den optionalen Installer. Unter Windows z. B. über Winget:
   `winget install --id JRSoftware.InnoSetup -e`

## Build-Schritte

1. **Abhängigkeiten installieren und Frontend prüfen**
   ```powershell
   python -m pip install -r energyradar/requirements.txt
   python -m pip install -r requirements-build.txt
   Push-Location frontend/react-ui
   npm.cmd ci
   npm.cmd run lint
   npm.cmd run build
   Pop-Location
   ```

2. **Portable Version erstellen (PyInstaller)**
   Führe folgendes Skript im Root-Verzeichnis aus:
   ```powershell
   python tools/build.py
   ```
   Dieses Skript leert die Ordner `build` und `dist` und führt PyInstaller mit `packaging/EnergyRadar.spec` aus.
   Das Ergebnis ist `dist/EnergyRadar/` mit Python-Runtime, PySide6/QtWebEngine und dem gebauten React-Frontend.

3. **Installer erstellen (Inno Setup)**
   Kompiliere das Setup-Skript `installer/EnergyRadar.iss`:
   ```powershell
   & "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer\EnergyRadar.iss
   ```
   oder falls systemweit installiert:
   ```powershell
   & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\EnergyRadar.iss
   ```
   Das Ergebnis liegt im Ordner `release/` als `EnergyRadar-0.9-Beta-Setup.exe`.

## Hinweise zu Pfaden
- Das React-Produktionsbundle und die App-Icons werden über den `datas`-Parameter in der `.spec`-Datei eingebunden.
- Einstiegspunkt des Desktop-Builds ist `desktop_web.py`.
- Die UI läuft lokal in QtWebEngine; Python und React kommunizieren über QWebChannel.
- Nutzerdaten (Datenbank, Settings) werden *niemals* in das Installationsverzeichnis (`%ProgramFiles%`) geschrieben.
  Sobald die App als PyInstaller-Bundle läuft (`sys.frozen`), schreibt sie nach `%LOCALAPPDATA%\EnergyRadar`.
