import sqlite3
import json
import zipfile
import hashlib
from pathlib import Path
from datetime import datetime
from energyradar import config

class BackupManager:
    def create_backup(self, target_path: str) -> bool:
        try:
            target = Path(target_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            
            db_path = config.DB_PATH
            settings_path = config.USER_DATA_DIR / "settings.json"
            
            manifest = {
                "version": 1,
                "created_at": datetime.now().isoformat(),
                "files": {}
            }
            
            with zipfile.ZipFile(target, 'w') as zf:
                if db_path.exists():
                    zf.write(db_path, "storage.db")
                    hasher = hashlib.sha256()
                    hasher.update(db_path.read_bytes())
                    manifest["files"]["storage.db"] = hasher.hexdigest()
                    
                if settings_path.exists():
                    zf.write(settings_path, "settings.json")
                    hasher = hashlib.sha256()
                    hasher.update(settings_path.read_bytes())
                    manifest["files"]["settings.json"] = hasher.hexdigest()
                    
                zf.writestr("manifest.json", json.dumps(manifest))
            return True
        except Exception as e:
            return False

    def restore_backup(self, source_path: str) -> bool:
        return False
