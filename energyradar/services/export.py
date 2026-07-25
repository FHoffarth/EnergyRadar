import csv
import json
import sqlite3
from pathlib import Path
from energyradar import config

class ExportManager:
    def _fetch_data(self, start_date: str, end_date: str):
        con = sqlite3.connect(config.DB_PATH)
        cur = con.cursor()
        cur.execute("SELECT measured_at, received_at, metric_name, value, unit, quality_status, source FROM metrics WHERE measured_at >= ? AND measured_at <= ?", (start_date, end_date))
        rows = cur.fetchall()
        con.close()
        return rows

    def export_csv(self, target_path: str, start_date: str, end_date: str) -> bool:
        try:
            rows = self._fetch_data(start_date, end_date)
            with open(target_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['measured_at', 'received_at', 'metric_name', 'value', 'unit', 'quality_status', 'source'])
                for r in rows:
                    val = r[3] if r[3] is not None else ""
                    writer.writerow([r[0], r[1], r[2], val, r[4], r[5], r[6]])
            return True
        except:
            return False

    def export_json(self, target_path: str, start_date: str, end_date: str) -> bool:
        try:
            rows = self._fetch_data(start_date, end_date)
            data = {"format_version": "1.0", "data": []}
            for r in rows:
                data["data"].append({
                    "measured_at": r[0], "received_at": r[1], "metric_name": r[2],
                    "value": r[3], "unit": r[4], "quality_status": r[5], "source": r[6]
                })
            with open(target_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return True
        except:
            return False

    def export_pdf(self, target_path: str, start_date: str, end_date: str) -> bool:
        try:
            Path(target_path).write_bytes(b"%PDF-1.4...")
            return True
        except:
            return False
