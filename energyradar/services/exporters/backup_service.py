import os
import sqlite3
import tempfile
import zipfile
import hashlib
import json
import contextlib
from datetime import datetime, timezone
from pathlib import Path
import logging

from energyradar import config

log = logging.getLogger(__name__)

def hash_file(filepath: str) -> str:
    """Berechnet den SHA-256 Hash einer Datei."""
    sha256 = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

def create_backup_zip(final_zip_path: str):
    """
    Erstellt ein konsistentes Backup-ZIP.
    1. Temp Dir
    2. Konsistentes sqlite3 Backup
    3. Integrity Check
    4. Kopieren von settings.json
    5. Manifest erstellen (Hashes)
    6. Atomares ZIP-Erstellen.
    """
    final_path_obj = Path(final_zip_path)
    directory = final_path_obj.parent
    directory.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db_path = os.path.join(tmpdir, "energy.db")

        # 1. Konsistentes Backup der aktiven DB
        try:
            with contextlib.closing(sqlite3.connect(config.DB_PATH)) as src, \
                 contextlib.closing(sqlite3.connect(tmp_db_path)) as dst:
                src.backup(dst)
        except Exception as e:
            log.error(f"Backup failed: {e}")
            raise RuntimeError("Konnte Datenbank nicht sichern.") from e

        # 2. Integrity Check auf der Sicherung
        with contextlib.closing(sqlite3.connect(tmp_db_path)) as dst:
            result = dst.execute("PRAGMA integrity_check").fetchone()[0]
            if result.lower() != "ok":
                raise RuntimeError(f"Datenbank-Sicherung ist korrupt: {result}")

            # Hole Schema Version
            try:
                schema_version = dst.execute("PRAGMA user_version").fetchone()[0]
            except:
                schema_version = 0

        manifest = {
            "backup_format_version": "1.0",
            "app_version": config.APP_VERSION,
            "database_schema_version": schema_version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_database": "energyradar",
            "integrity_check_result": result,
            "files": {}
        }

        db_hash = hash_file(tmp_db_path)
        manifest["files"]["energy.db"] = {
            "size_bytes": os.path.getsize(tmp_db_path),
            "sha256": db_hash
        }

        # 3. Settings kopieren
        files_to_zip = [("energy.db", tmp_db_path)]
        ui_settings_path = config.USER_DATA_DIR / "ui-settings.json"
        if os.path.exists(ui_settings_path):
            tmp_settings_path = os.path.join(tmpdir, "ui-settings.json")
            import shutil
            shutil.copy2(ui_settings_path, tmp_settings_path)
            set_hash = hash_file(tmp_settings_path)
            manifest["files"]["ui-settings.json"] = {
                "size_bytes": os.path.getsize(tmp_settings_path),
                "sha256": set_hash
            }
            files_to_zip.append(("ui-settings.json", tmp_settings_path))

        # 4. Manifest speichern
        tmp_manifest_path = os.path.join(tmpdir, "manifest.json")
        with open(tmp_manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        files_to_zip.append(("manifest.json", tmp_manifest_path))

        # 5. Atomar zippen (in ein Tempfile am finalen Pfad, dann umbenennen)
        fd, tmp_zip_path = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".zip")
        os.close(fd)

        try:
            with zipfile.ZipFile(tmp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for arcname, fpath in files_to_zip:
                    zf.write(fpath, arcname=arcname)

            # Replace
            os.replace(tmp_zip_path, final_zip_path)
        except Exception as e:
            if os.path.exists(tmp_zip_path):
                os.remove(tmp_zip_path)
            raise e
