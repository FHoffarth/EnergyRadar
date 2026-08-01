import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "energyradar" / "static"


def test_service_worker_precache_references_existing_assets():
    source = (STATIC / "sw.js").read_text(encoding="utf-8")
    paths = re.findall(r'"(/static/[^"?]+)(?:\?[^"\n]*)?"', source)

    assert paths, "service-worker pre-cache list unexpectedly empty"
    missing = [path for path in paths if not (ROOT / "energyradar" / path.removeprefix("/")).is_file()]
    assert missing == []
    assert "background.js" not in source
    assert "Living Sky" not in source
