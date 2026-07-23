import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from energyradar import config
from energyradar.services.export import ExportManager
from energyradar.services.backup import BackupManager
from datetime import datetime

def generate_artifacts():
    out_dir = BASE_DIR / "review_artifacts" / "pre_release"
    out_dir.mkdir(parents=True, exist_ok=True)
    
    # We will export from whatever is in the DB right now (test data)
    em = ExportManager()
    bm = BackupManager()
    
    start_date = "2026-07-20T00:00:00Z"
    end_date = "2026-07-23T23:59:59Z"
    
    # Needs a QGuiApplication for PDF export
    from PySide6.QtGui import QGuiApplication
    app = QGuiApplication.instance()
    if not app:
        app = QGuiApplication(sys.argv)
    
    csv_path = out_dir / "sample_export.csv"
    json_path = out_dir / "sample_export.json"
    pdf_path = out_dir / "sample_report.pdf"
    zip_path = out_dir / "sample_backup.zip"
    
    em.export_csv(str(csv_path), start_date, end_date)
    em.export_json(str(json_path), start_date, end_date)
    em.export_pdf(str(pdf_path), start_date, end_date)
    bm.create_backup(str(zip_path))
    
    readme_path = out_dir / "README.md"
    readme_path.write_text(f"""# EnergyRadar - Vor-Release Test Artefakte

Diese Dateien wurden mit synthetischen Testdaten erzeugt, um die Funktionalität vor dem Closed-Beta-Release zu überprüfen.

## Metadaten
- **App-Version:** {config.APP_VERSION} {config.APP_STAGE} (Build {config.APP_BUILD})
- **Schema-Version:** 2
- **Erzeugungszeitpunkt:** {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}

## Prüfschritte
1. **CSV:** Öffne `sample_export.csv` in Excel/Calc. Es sollten korrekte Spaltenüberschriften vorhanden sein. Fehlende Werte (`NULL`) in der Datenbank werden als leere Felder (,,) dargestellt, nicht als 0.
2. **JSON:** Prüfe `sample_export.json` auf Validität und die Struktur (`format_version`, `generated_at`, Array von Objekten in `data`).
3. **PDF:** Öffne `sample_report.pdf`. Das Dokument enthält einen Briefkopf, die Datenqualitätsangaben sowie die verdichteten Leistungswerte über den Zeitraum.
4. **Backup:** Untersuche das `sample_backup.zip`. Es muss `storage.db`, `settings.json` und `manifest.json` enthalten. Das Manifest enthält die SHA-256 Prüfsummen.
""", encoding="utf-8")

if __name__ == "__main__":
    generate_artifacts()
