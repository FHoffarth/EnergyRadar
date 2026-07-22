# EnergyRadar - Vor-Release Test Artefakte

Diese Dateien wurden mit synthetischen Testdaten erzeugt, um die Funktionalität vor dem Closed-Beta-Release zu überprüfen.

## Metadaten
- **App-Version:** 0.9 Beta (Build 2026.07.22)
- **Schema-Version:** 2
- **Erzeugungszeitpunkt:** 22.07.2026 18:17:32

## Prüfschritte
1. **CSV:** Öffne `sample_export.csv` in Excel/Calc. Es sollten korrekte Spaltenüberschriften vorhanden sein. Fehlende Werte (`NULL`) in der Datenbank werden als leere Felder (,,) dargestellt, nicht als 0.
2. **JSON:** Prüfe `sample_export.json` auf Validität und die Struktur (`format_version`, `generated_at`, Array von Objekten in `data`).
3. **PDF:** Öffne `sample_report.pdf`. Das Dokument enthält einen Briefkopf, die Datenqualitätsangaben sowie die verdichteten Leistungswerte über den Zeitraum.
4. **Backup:** Untersuche das `sample_backup.zip`. Es muss `storage.db`, `settings.json` und `manifest.json` enthalten. Das Manifest enthält die SHA-256 Prüfsummen.
