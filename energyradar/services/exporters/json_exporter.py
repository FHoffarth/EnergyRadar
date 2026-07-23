import json
from energyradar.models.report import ReportModel
from energyradar.services.exporters.utils import write_atomic

def export_json(report: ReportModel, path: str):
    """
    Exportiert das ReportModel als JSON-Datei.
    Berücksichtigt: UTF-8, null für unbekannte Werte (durch to_dict() und json.dumps garantiert).
    """
    def write_func(f):
        data = report.to_dict()
        json.dump(data, f, ensure_ascii=False, indent=2)

    write_atomic(path, 'w', write_func, encoding='utf-8')
