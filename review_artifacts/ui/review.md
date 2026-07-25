# Visueller Self-Audit und Fehlerzustände

Hier ist der angeforderte detaillierte visuelle Review. Alle referenzierten Screenshots befinden sich lokal im Repository in diesem Ordner (`review_artifacts/ui/`) und können von dir im Dateisystem geöffnet werden.

## Git Status & Branches
Aktueller Branch: `main` (commit: `359fcb6 feat: ship native QML desktop builds`)

**Geänderte QML-Dateien seit Freigabe:**
- `energyradar/ui/qml/main.qml`
- `energyradar/ui/qml/NowScreen.qml`
- `energyradar/ui/qml/TodayScreen.qml`
- `energyradar/ui/qml/DevicesScreen.qml`
- `energyradar/ui/qml/SettingsScreen.qml`
- `energyradar/ui/qml/components/ValueCard.qml`
- Neu hinzugefügt: `energyradar/ui/qml/MemoryScreen.qml`

## Self-Audit pro Screen

### 1. Jetzt (`NowScreen`)
**Bilder:** `now_dark.png`, `now_light.png`
- **Was entspricht der Vorlage:** Radar-Kreis, drei Energiepfade (Solar, Haus, Netz), typografische Hierarchie ("Deine Solaranlage versorgt gerade dein Zuhause"), kompakte Statuszeile.
- **Bewusste Abweichungen:** Die Begrüßung ist in Akzentfarbe gehalten statt rein weiß/schwarz. 
- **Fehler/Offline-Zustände (`now_error.png`):** Das Verdikt schaltet auf "System offline", der Hintergrund des Verdikts wird neutral (grau), das Wetter-Element fehlt (NULL/Fehler-Toleranz).
- **Kleinste Fenstergröße (`now_small.png`):** Das Layout verkleinert den Radar-Bereich.

### 2. Heute (`TodayScreen`)
**Bilder:** `today_dark.png`, `today_light.png`
- **Was entspricht der Vorlage:** 4-Card-Grid (Erzeugung, Verbrauch, Import, Export) mit korrekten Abständen und runden Ecken, strikte Typografie für Zahlen.
- **Placeholder:** Der Graph-Bereich unten ist explizit als Placeholder ("Noch keine Messwerte" + einfacher Kasten) belassen.
- **Light Mode Notes:** Ich habe auf deinen Hinweis hin **keine Material-Shadows** hinzugefügt. Das Design bleibt flach, sauber und nutzt lediglich feine Randlinien (`theme.borderLine`), was sehr hochwertig wirkt.

### 3. Geräte (`DevicesScreen`)
**Bilder:** `devices_dark.png`, `devices_light.png`
- **Was entspricht der Vorlage:** Card-Layout, klare Indikatoren für Verbindungsstatus.
- **Lange Texte / Offline-Zustände (`devices_error.png`):** Simuliert mit "Sehr langer Zählername der umbrechen muss MT175 ISKRA" sowie einem harten Fehlerstatus. Text bricht korrekt um. Der Fehlertext "Verbindung fehlgeschlagen..." nutzt einen dezenten rötlichen Hintergrundblock.

### 4. Daten & Gedächtnis (`MemoryScreen`)
**Bilder:** `memory_dark.png`, `memory_light.png`
- **Neu umgesetzt:** Dieser Screen war im ursprünglichen Figma evtl. nicht detailliert; orientiert sich an der Card-Sprache. 
- **Sichtbare Scrollbereiche:** Die History-Listen sind in ScrollViews. Bei vielen Elementen scrollt man die gesamte View.

### 5. Einstellungen (`SettingsScreen`)
**Bilder:** `settings_dark.png`, `settings_light.png`
- **Was entspricht der Vorlage:** Klares Listenlayout, Trennung in "Persönliche Ansprache" und "Geräte".
- **Funktional aber visuell unfertig:** Die TextFields haben extrem harte schwarze (`#111111`) Hintergründe im Dark Mode. Das entspricht nicht einem weichen Google UI.
- **System-Theme-Wechsel:** Der neue Dropdown-Schalter ("Erscheinungsbild") ist eingebaut und funktional.

---
Bitte prüfe die Bilder in diesem Verzeichnis. Die Entwicklung ist vollständig pausiert (kein Backup, kein Export).
