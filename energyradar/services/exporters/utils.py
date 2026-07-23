import os
import tempfile
import shutil
from pathlib import Path
import logging

log = logging.getLogger(__name__)

def write_atomic(final_path: str, mode: str, write_func, encoding: str = None):
    """
    Führt einen atomaren Schreibvorgang aus.
    Schreibt die Daten über `write_func(temp_file)` in eine temporäre Datei.
    Nach erfolgreichem Flush/FSync wird die temporäre Datei umbenannt.
    """
    final_path_obj = Path(final_path)
    directory = final_path_obj.parent
    directory.mkdir(parents=True, exist_ok=True)

    # Create a temporary file in the same directory to ensure atomic rename works across partitions
    fd, temp_path = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".export")
    try:
        with open(fd, mode, encoding=encoding) as f:
            write_func(f)
            f.flush()
            os.fsync(f.fileno())

        # Atomic replace
        os.replace(temp_path, final_path)
    except Exception as e:
        log.error(f"Error during atomic write to {final_path}: {e}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise
