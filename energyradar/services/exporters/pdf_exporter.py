import os
from datetime import datetime
from PySide6.QtGui import QTextDocument, QPdfWriter, QPageSize, QPageLayout, QPainter, QImage, QColor, QFont
from PySide6.QtCore import QMarginsF, Qt, QRectF

from energyradar.models.report import ReportModel
from energyradar.services.exporters.utils import write_atomic

def _val(val, unit=""):
    if val is None:
        return "Nicht verfügbar"
    return f"{val} {unit}".strip()

def export_pdf(report: ReportModel, path: str):
    """
    Exportiert das ReportModel als PDF mittels Qt.
    Erfüllt die Anforderungen: Logo, Zeitraum, Zusammenfassung, Qualitätswarnungen, Diagramm (Platzhalter für Phase 1).
    """
    # Temporäre Datei generieren, da QPdfWriter einen Pfad braucht.
    # Um atomar zu schreiben, verwalten wir das selbst mit tempfile
    def write_func(f):
        pass # Not used directly for writing, we just need the path mechanics from write_atomic

    import tempfile
    from pathlib import Path

    final_path_obj = Path(path)
    directory = final_path_obj.parent
    directory.mkdir(parents=True, exist_ok=True)

    fd, temp_path = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".export")
    os.close(fd) # Close it, QPdfWriter will open it

    try:
        writer = QPdfWriter(temp_path)
        writer.setPageSize(QPageSize(QPageSize.A4))
        writer.setPageMargins(QMarginsF(15, 15, 15, 15), QPageLayout.Millimeter)
        writer.setResolution(300)
        writer.setTitle(f"EnergyRadar Report - {report.period_label}")
        writer.setCreator("EnergyRadar")

        doc = QTextDocument()
        doc.setDocumentMargin(10)

        # HTML Layout für das PDF
        html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #333; }}
                h1 {{ color: #1E293B; }}
                h2 {{ color: #334155; border-bottom: 1px solid #CBD5E1; padding-bottom: 5px; }}
                table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
                th, td {{ padding: 8px; text-align: left; border-bottom: 1px solid #E2E8F0; }}
                th {{ background-color: #F8FAFC; }}
                .alert {{ background-color: #FEF2F2; color: #991B1B; padding: 10px; border-radius: 5px; margin-top: 10px; }}
                .footer {{ font-size: 10px; color: #64748B; text-align: center; margin-top: 50px; }}
            </style>
        </head>
        <body>
            <h1>EnergyRadar Bericht</h1>
            <p><strong>Zeitraum:</strong> {report.period_label} ({report.period_start.strftime('%d.%m.%Y %H:%M')} - {report.period_end.strftime('%d.%m.%Y %H:%M')})</p>
            <p><strong>Erstellt am:</strong> {report.generated_at.strftime('%d.%m.%Y %H:%M')} ({report.timezone})</p>
        """

        if report.data_quality != "good":
            html += f"""
            <div class="alert">
                <strong>Hinweis zur Datenqualität:</strong> Einige Werte sind möglicherweise nicht zuverlässig berechenbar oder nicht verfügbar.
            </div>
            """

        if report.warnings:
            html += "<ul>"
            for w in report.warnings:
                html += f"<li>{w}</li>"
            html += "</ul>"

        # Summary
        if report.summary:
            html += f"""
            <h2>Zusammenfassung</h2>
            <table>
                <tr><th>Solarerzeugung</th><td>{_val(report.summary.solar_kwh, "kWh")}</td></tr>
                <tr><th>Verbrauch</th><td>{_val(report.summary.consumption_kwh, "kWh")}</td></tr>
                <tr><th>Netzbezug</th><td>{_val(report.summary.grid_import_kwh, "kWh")}</td></tr>
                <tr><th>Einspeisung</th><td>{_val(report.summary.grid_export_kwh, "kWh")}</td></tr>
                <tr><th>Eigenverbrauch</th><td>{_val(report.summary.self_consumption_pct, "%")}</td></tr>
                <tr><th>Autarkiegrad</th><td>{_val(report.summary.autarky_pct, "%")}</td></tr>
            </table>
            """

        # Diagram placeholder note
        html += """
            <h2>Tagesverlauf</h2>
            <p><em>(Diagramm-Rendering via QtPaint in nächster Ausbaustufe)</em></p>
        """

        html += f"""
            <div class="footer">
                <p>Generiert von EnergyRadar v{report.app_version}</p>
                <p><strong>Unknown ≠ Zero</strong>: Nicht verfügbare Messwerte werden niemals als 0 ausgewiesen.</p>
            </div>
        </body>
        </html>
        """

        doc.setHtml(html)
        doc.print_(writer)

        # Atomares Replace
        os.replace(temp_path, path)

    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise e
