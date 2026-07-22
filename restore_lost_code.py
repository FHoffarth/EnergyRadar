import os
import re

# config.py
config_path = "energyradar/config.py"
with open(config_path, "r", encoding="utf-8") as f:
    config_content = f.read()

version_code = """
APP_VERSION = "0.9"
APP_STAGE = "Beta"
APP_BUILD = "2026.07.22"
"""
if "APP_VERSION =" not in config_content:
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(version_code + config_content)

# ui/settings.py
settings_path = "energyradar/ui/settings.py"
with open(settings_path, "r", encoding="utf-8") as f:
    settings_content = f.read()

if "last_backup_at: str = \"\"" not in settings_content:
    settings_content = settings_content.replace(
        "first_name: str = \"\"",
        "first_name: str = \"\"\n    last_backup_at: str = \"\"\n    last_backup_status: str = \"\"\n    last_backup_path: str = \"\"\n    last_export_at: str = \"\"\n    last_export_status: str = \"\"\n    last_export_format: str = \"\"\n    last_export_path: str = \"\""
    )
    settings_content = settings_content.replace(
        "    \"first_name\": s.first_name,",
        "    \"first_name\": s.first_name,\n        \"last_backup_at\": s.last_backup_at,\n        \"last_backup_status\": s.last_backup_status,\n        \"last_backup_path\": s.last_backup_path,\n        \"last_export_at\": s.last_export_at,\n        \"last_export_status\": s.last_export_status,\n        \"last_export_format\": s.last_export_format,\n        \"last_export_path\": s.last_export_path,"
    )
    with open(settings_path, "w", encoding="utf-8") as f:
        f.write(settings_content)

# ui/viewmodels.py
viewmodels_path = "energyradar/ui/viewmodels.py"
with open(viewmodels_path, "r", encoding="utf-8") as f:
    viewmodels_content = f.read()

if "last_backup_at: str = \"\"" not in viewmodels_content:
    viewmodels_content = viewmodels_content.replace(
        "snapshots: List[SnapshotViewModel] = field(default_factory=list)",
        "snapshots: List[SnapshotViewModel] = field(default_factory=list)\n    last_backup_at: str = \"\"\n    last_export_at: str = \"\"\n    app_version: str = \"\""
    )
    viewmodels_content = viewmodels_content.replace(
        "location: str = \"\"",
        "location: str = \"\"\n    app_version: str = \"\""
    )
    viewmodels_content = viewmodels_content.replace(
        "def build_memory_vm",
        "from energyradar import config\ndef build_memory_vm"
    )
    viewmodels_content = viewmodels_content.replace(
        "events=events,",
        "events=events,\n        last_backup_at=settings.last_backup_at if settings else \"\",\n        last_export_at=settings.last_export_at if settings else \"\",\n        app_version=f\"Version {config.APP_VERSION} {config.APP_STAGE} - Build {config.APP_BUILD}\","
    )
    viewmodels_content = viewmodels_content.replace(
        "def build_settings_vm(settings: Optional[UISettings] = None) -> SettingsViewModel:",
        "def build_settings_vm(settings: Optional[UISettings] = None) -> SettingsViewModel:\n    from energyradar import config"
    )
    viewmodels_content = viewmodels_content.replace(
        "location=settings.location if settings else \"\"",
        "location=settings.location if settings else \"\",\n        app_version=f\"Version {config.APP_VERSION} {config.APP_STAGE} - Build {config.APP_BUILD}\""
    )
    with open(viewmodels_path, "w", encoding="utf-8") as f:
        f.write(viewmodels_content)

# ui/bridge.py
bridge_path = "energyradar/ui/bridge.py"
with open(bridge_path, "r", encoding="utf-8") as f:
    bridge_content = f.read()

if "self._settings.last_export_at" not in bridge_content:
    bridge_content = bridge_content.replace(
        "from services.export import ExportManager",
        "from services.export import ExportManager\n        from datetime import datetime\n        import energyradar.ui.settings as ui_settings"
    )
    bridge_content = bridge_content.replace(
        "manager = ExportManager()\n        if format == \"csv\":\n            return manager.export_csv(targetPath, startDate, endDate)\n        elif format == \"json\":\n            return manager.export_json(targetPath, startDate, endDate)\n        elif format == \"pdf\":\n            return manager.export_pdf(targetPath, startDate, endDate)\n        return False",
        """manager = ExportManager()
        success = False
        if format == "csv":
            success = manager.export_csv(targetPath, startDate, endDate)
        elif format == "json":
            success = manager.export_json(targetPath, startDate, endDate)
        elif format == "pdf":
            success = manager.export_pdf(targetPath, startDate, endDate)
            
        if success:
            self._settings.last_export_at = datetime.now().strftime("%d.%m.%Y %H:%M")
            self._settings.last_export_status = "success"
            self._settings.last_export_format = format
            self._settings.last_export_path = targetPath
            ui_settings.save(self._settings)
            self._update_all()
            
        return success"""
    )
    bridge_content = bridge_content.replace(
        "from services.backup import BackupManager",
        "from services.backup import BackupManager\n        from datetime import datetime\n        import energyradar.ui.settings as ui_settings"
    )
    bridge_content = bridge_content.replace(
        "manager = BackupManager()\n        return manager.create_backup(targetPath)",
        """manager = BackupManager()
        success = manager.create_backup(targetPath)
        
        if success:
            self._settings.last_backup_at = datetime.now().strftime("%d.%m.%Y %H:%M")
            self._settings.last_backup_status = "success"
            self._settings.last_backup_path = targetPath
            ui_settings.save(self._settings)
            self._update_all()
            
        return success"""
    )
    with open(bridge_path, "w", encoding="utf-8") as f:
        f.write(bridge_content)
