"""Fronius local-archive ingestion: parsing, chunking, idempotency, provenance.

Fixture payloads mirror the real device structure (Solar API v1). One optional
test hits the real device and is skipped when it is unreachable, so CI never
depends on hardware.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import sqlite3
import urllib.request

import pytest

from energyradar import config
from energyradar.collectors import fronius_archive as fa
from energyradar.services import archive_ingest, migration, storage


# --------------------------------------------------------------------------- #
# Synthetic payloads shaped exactly like the observed device responses.
# --------------------------------------------------------------------------- #
def _payload(start_iso: str, energy: dict[str, float], power: dict[str, float], span: int = 300, code: int = 0):
    return {
        "Head": {"Status": {"Code": code, "Reason": "" if code == 0 else "restricted"}, "Timestamp": start_iso},
        "Body": {"Data": {"inverter/1": {
            "Start": start_iso, "End": start_iso,
            "Data": {
                "EnergyReal_WAC_Sum_Produced": {"Unit": "Wh", "Values": energy},
                "PowerReal_PAC_Sum": {"Unit": "W", "Values": power},
                "TimeSpanInSec": {"Unit": "sec", "Values": {k: span for k in energy}},
            },
        }}},
    }


SUMMER = _payload("2026-08-03T00:00:00+02:00", {"19800": 12.0, "20100": 15.5}, {"19800": 144.0, "20100": 186.0})
WINTER = _payload("2026-02-04T00:00:00+01:00", {"36000": 8.0}, {"36000": 96.0})


# --------------------------- chunking --------------------------------------- #
def test_chunks_respect_16_day_window():
    chunks = fa.daterange_chunks(date(2026, 7, 5), date(2026, 8, 3))
    assert len(chunks) == 2
    for s, e in chunks:
        assert (e - s).days < fa.MAX_QUERY_DAYS
    # gap-free, no overlap
    assert chunks[0][1].toordinal() + 1 == chunks[1][0].toordinal()
    assert chunks[0][0] == date(2026, 7, 5) and chunks[-1][1] == date(2026, 8, 3)


def test_single_day_is_one_chunk():
    assert fa.daterange_chunks(date(2026, 8, 3), date(2026, 8, 3)) == [(date(2026, 8, 3), date(2026, 8, 3))]


def test_reversed_range_rejected():
    with pytest.raises(ValueError):
        fa.daterange_chunks(date(2026, 8, 3), date(2026, 8, 1))


# --------------------------- parsing / timezone ----------------------------- #
def test_parse_maps_second_offset_to_utc_summer():
    points = fa.parse_archive(SUMMER)
    energy = [p for p in points if p.channel == "EnergyReal_WAC_Sum_Produced"]
    # 19800s = 05:30 local (+02:00) -> 03:30Z
    first = min(energy, key=lambda p: p.observed_at_utc)
    assert first.observed_at_utc == "2026-08-03T03:30:00Z"
    assert first.measurement_kind == "interval_total"
    assert first.unit == "Wh"
    assert first.interval_seconds == 300
    assert first.value == Decimal("12.0")


def test_parse_handles_winter_offset_dst():
    points = fa.parse_archive(WINTER)
    # 36000s = 10:00 local (+01:00) -> 09:00Z
    assert points[0].observed_at_utc == "2026-02-04T09:00:00Z"


def test_power_channel_is_interval_average_not_total():
    points = fa.parse_archive(SUMMER)
    power = [p for p in points if p.channel == "PowerReal_PAC_Sum"]
    assert power and all(p.measurement_kind == "interval_average" for p in power)


def test_missing_values_are_never_invented():
    payload = _payload("2026-08-03T00:00:00+02:00", {"19800": 12.0, "20100": None}, {"19800": 144.0})
    energy = [p for p in fa.parse_archive(payload) if p.channel == "EnergyReal_WAC_Sum_Produced"]
    assert len(energy) == 1  # the None sample is dropped, not filled


def test_restricted_window_raises():
    with pytest.raises(fa.ArchiveRangeRestricted):
        fa.parse_archive(_payload("2026-08-03T00:00:00+02:00", {}, {}, code=255))


def test_empty_data_yields_no_points():
    empty = {"Head": {"Status": {"Code": 0}}, "Body": {"Data": {}}}
    assert fa.parse_archive(empty) == []


# --------------------------- fetch retry ------------------------------------ #
def test_fetch_retries_then_succeeds():
    calls = {"n": 0}

    def flaky(url, timeout):
        calls["n"] += 1
        if calls["n"] < 2:
            raise urllib.error.URLError("boom")
        return b'{"Head":{"Status":{"Code":0}},"Body":{"Data":{}}}'

    out = fa.fetch_archive("http://device", date(2026, 8, 3), date(2026, 8, 3), opener=flaky, backoff=0)
    assert calls["n"] == 2 and out["Head"]["Status"]["Code"] == 0


def test_fetch_rejects_oversized_window():
    with pytest.raises(fa.ArchiveRangeRestricted):
        fa.fetch_archive("http://device", date(2026, 7, 1), date(2026, 8, 1), opener=lambda u, t: b"{}")


# --------------------------- ingestion -------------------------------------- #
@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(storage, "_MIGRATED", False)
    migration.run_migrations()
    return path


def _fixture_fetcher(payload):
    return lambda base_url, start, end, channels=(): payload


def test_ingest_persists_points_with_provenance(db):
    res = archive_ingest.ingest_range("http://device", date(2026, 8, 3), date(2026, 8, 3),
                                      fetcher=_fixture_fetcher(SUMMER), database_path=db)
    assert res.status == "complete"
    assert res.points_ingested == 4  # 2 energy + 2 power
    con = sqlite3.connect(db)
    rows = con.execute("SELECT provenance, measurement_kind, count(*) FROM provider_archive_points GROUP BY provenance, measurement_kind").fetchall()
    kinds = {(r[0], r[1]): r[2] for r in rows}
    assert kinds[("fronius_local_archive", "interval_total")] == 2
    assert kinds[("fronius_local_archive", "interval_average")] == 2
    con.close()


def test_ingest_is_idempotent(db):
    a = archive_ingest.ingest_range("http://device", date(2026, 8, 3), date(2026, 8, 3),
                                    fetcher=_fixture_fetcher(SUMMER), database_path=db)
    b = archive_ingest.ingest_range("http://device", date(2026, 8, 3), date(2026, 8, 3),
                                    fetcher=_fixture_fetcher(SUMMER), database_path=db)
    assert a.points_ingested == 4
    # Second run short-circuits the already-complete import (same import row) and
    # inserts no new rows — the store still holds exactly the 4 original points.
    assert b.import_id == a.import_id
    con = sqlite3.connect(db)
    assert con.execute("SELECT count(*) FROM provider_archive_points").fetchone()[0] == 4
    assert con.execute("SELECT count(*) FROM provider_archive_imports").fetchone()[0] == 1
    con.close()


def test_ingest_never_touches_recorder_truth(db):
    archive_ingest.ingest_range("http://device", date(2026, 8, 3), date(2026, 8, 3),
                                fetcher=_fixture_fetcher(SUMMER), database_path=db)
    con = sqlite3.connect(db)
    assert con.execute("SELECT count(*) FROM energy_samples_v1").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM counter_anchors").fetchone()[0] == 0
    con.close()


def test_ingest_empty_archive_is_no_data_not_error(db):
    empty = {"Head": {"Status": {"Code": 0}}, "Body": {"Data": {}}}
    res = archive_ingest.ingest_range("http://device", date(2025, 1, 1), date(2025, 1, 1),
                                      fetcher=_fixture_fetcher(empty), database_path=db)
    assert res.status == "no_archive_data"
    assert res.points_ingested == 0


def test_ingest_restricted_window_reported(db):
    def restricted(base_url, start, end, channels=()):
        return _payload("2026-08-03T00:00:00+02:00", {}, {}, code=255)
    res = archive_ingest.ingest_range("http://device", date(2026, 8, 3), date(2026, 8, 3),
                                      fetcher=restricted, database_path=db)
    assert res.status == "source_unsupported"


# --------------------------- real device (optional) ------------------------- #
def _device_base() -> str | None:
    try:
        from energyradar.services import data_source
        eff = data_source.effective()
        if not eff or not eff.get("url"):
            return None
        from urllib.parse import urlsplit
        parts = urlsplit(eff["url"])
        return f"{parts.scheme}://{parts.netloc}"
    except Exception:
        return None


@pytest.mark.skipif(_device_base() is None, reason="no Fronius device configured")
def test_real_device_archive_sum_matches_e_day():
    base = _device_base()
    try:
        raw = urllib.request.urlopen(base + "/solar_api/GetAPIVersion.cgi", timeout=3).read()
    except Exception:
        pytest.skip("Fronius device unreachable")
    today = date.today()
    payload = fa.fetch_archive(base, today, today, channels=("EnergyReal_WAC_Sum_Produced", "TimeSpanInSec"))
    points = [p for p in fa.parse_archive(payload) if p.channel == "EnergyReal_WAC_Sum_Produced"]
    archive_sum = sum(p.value for p in points)
    import json
    cid = urllib.request.urlopen(
        base + "/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=1&DataCollection=CommonInverterData",
        timeout=3).read()
    e_day = Decimal(str(json.loads(cid)["Body"]["Data"]["DAY_ENERGY"]["Value"]))
    # Archive interval-energy sum reconciles with the provider E_Day summary.
    assert abs(archive_sum - e_day) <= max(Decimal("5"), e_day * Decimal("0.02"))
