import json
import os
import sqlite3
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import pytest

from energyradar import config
from energyradar.services import migration, storage
from energyradar.services.exporters import backup_service


V2_SCHEMA = """
CREATE TABLE production (
    timestamp TEXT PRIMARY KEY,
    power REAL NOT NULL,
    energy_today REAL NOT NULL,
    energy_year REAL NOT NULL,
    energy_total REAL NOT NULL
);
CREATE TABLE energy_samples_v1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    pv_measured_at TEXT,
    grid_measured_at TEXT,
    pv_power_w REAL,
    grid_power_w REAL,
    pv_energy_today_wh REAL,
    grid_import_total_wh REAL,
    grid_export_total_wh REAL,
    pv_quality_status TEXT NOT NULL,
    grid_quality_status TEXT NOT NULL,
    sample_quality_status TEXT NOT NULL,
    UNIQUE(measured_at)
);
CREATE INDEX idx_energy_samples_v1_measured_at
ON energy_samples_v1(measured_at);
CREATE TABLE schema_info (version INTEGER PRIMARY KEY);
INSERT INTO schema_info(version) VALUES (2);
"""


@pytest.fixture
def database_path(tmp_path, monkeypatch):
    path = tmp_path / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", path)
    storage._MIGRATED = False
    yield path
    storage._MIGRATED = False


def _create_v2(path: Path, *, with_samples: bool = True) -> None:
    with sqlite3.connect(path) as con:
        con.executescript(V2_SCHEMA)
        if with_samples:
            con.executemany(
                """
                INSERT INTO energy_samples_v1 (
                    measured_at, received_at, pv_measured_at, grid_measured_at,
                    pv_power_w, grid_power_w, pv_energy_today_wh,
                    grid_import_total_wh, grid_export_total_wh,
                    pv_quality_status, grid_quality_status, sample_quality_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "2026-07-31 10:00:00",
                        "2026-07-31 10:00:01",
                        "2026-07-31 12:00:00",
                        "2026-07-31 10:00:01",
                        1100.0,
                        -789.0,
                        2500.0,
                        9798031.0,
                        12480630.0,
                        "valid",
                        "valid",
                        "valid",
                    ),
                    (
                        "2026-07-31 10:00:10",
                        "2026-07-31 10:00:11",
                        "2026-07-31 12:00:10",
                        "2026-07-31 10:00:11",
                        0.0,
                        0.0,
                        2500.0,
                        9798031.0,
                        12480630.0,
                        "valid",
                        "valid",
                        "valid",
                    ),
                ],
            )


def _tables(path: Path) -> set[str]:
    with sqlite3.connect(path) as con:
        return {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
            if not row[0].startswith("sqlite_")
        }


def _phase0_shapes(path: Path) -> dict[str, list[tuple]]:
    names = {
        "schema_migrations",
        "application_metadata",
        "device_sources",
        "source_state",
        "backfill_runs",
        "raw_samples",
    }
    with sqlite3.connect(path) as con:
        return {
            name: [tuple(row[1:6]) for row in con.execute(f'PRAGMA table_info("{name}")')]
            for name in names
        }


def _migration_backups(path: Path) -> list[Path]:
    return sorted(path.parent.glob(f"{path.stem}.pre-v*-to-v*.db.bak"))


def test_fresh_database_creation_has_complete_versioned_schema(database_path):
    migration.run_migrations()

    assert {
        "production",
        "energy_samples_v1",
        "schema_info",
        "schema_migrations",
        "application_metadata",
        "device_sources",
        "source_state",
        "backfill_runs",
        "raw_samples",
    }.issubset(_tables(database_path))

    with sqlite3.connect(database_path) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == config.SCHEMA_VERSION
        assert con.execute("SELECT version FROM schema_info").fetchone()[0] == config.SCHEMA_VERSION
        assert [row[0] for row in con.execute("SELECT version FROM schema_migrations ORDER BY version")] == [1, 2, 3]
        database_uuid = json.loads(
            con.execute(
                "SELECT value_json FROM application_metadata WHERE key = 'database_uuid'"
            ).fetchone()[0]
        )
        assert database_uuid
        assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_upgrade_from_v2_is_additive_and_preserves_live_samples(database_path):
    _create_v2(database_path)
    with sqlite3.connect(database_path) as con:
        before = con.execute(
            "SELECT * FROM energy_samples_v1 ORDER BY id"
        ).fetchall()

    migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        after = con.execute(
            "SELECT * FROM energy_samples_v1 ORDER BY id"
        ).fetchall()
        assert after == before
        assert con.execute("PRAGMA user_version").fetchone()[0] == 3

        raw = con.execute(
            """
            SELECT provider, pv_power_w, grid_power_w,
                   grid_import_total_kwh, grid_export_total_kwh,
                   pv_energy_today_kwh
            FROM raw_samples JOIN device_sources USING(source_id)
            ORDER BY sample_id
            """
        ).fetchall()
        assert raw == [
            ("fronius", 1100.0, None, None, None, 2.5),
            ("tasmota", None, -789.0, 9798.031, 12480.63, None),
            ("fronius", 0.0, None, None, None, 2.5),
            ("tasmota", None, 0.0, 9798.031, 12480.63, None),
        ]

    backups = _migration_backups(database_path)
    assert len(backups) == 1
    backup_path = backups[0]
    with sqlite3.connect(backup_path) as backup:
        assert backup.execute("SELECT version FROM schema_info").fetchone()[0] == 2
        assert backup.execute("SELECT * FROM energy_samples_v1 ORDER BY id").fetchall() == before


def test_fresh_and_upgraded_databases_have_identical_phase0_shapes(
    tmp_path, monkeypatch
):
    fresh = tmp_path / "fresh.db"
    upgraded = tmp_path / "upgraded.db"

    monkeypatch.setattr(config, "DB_PATH", fresh)
    migration.run_migrations()
    _create_v2(upgraded, with_samples=False)
    monkeypatch.setattr(config, "DB_PATH", upgraded)
    migration.run_migrations()

    assert _phase0_shapes(fresh) == _phase0_shapes(upgraded)


def test_upgrade_accepts_known_schema_info_shape_with_audit_columns(database_path):
    _create_v2(database_path)
    with sqlite3.connect(database_path) as con:
        con.execute("DROP TABLE schema_info")
        con.execute(
            """
            CREATE TABLE schema_info (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                version INTEGER NOT NULL,
                applied_at TEXT NOT NULL
            )
            """
        )
        con.execute(
            "INSERT INTO schema_info VALUES (1, 2, '2026-07-30T10:00:00Z')"
        )

    migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        row = con.execute(
            "SELECT id, version, applied_at FROM schema_info"
        ).fetchone()
        assert row[0:2] == (1, config.SCHEMA_VERSION)
        assert row[2].endswith("Z")
        assert con.execute("SELECT COUNT(*) FROM energy_samples_v1").fetchone()[0] == 2


def test_migrations_apply_exactly_once_and_repeated_startup_is_idempotent(database_path):
    _create_v2(database_path)
    migration.run_migrations()
    with sqlite3.connect(database_path) as con:
        first_ledger = con.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        first_raw_count = con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0]

    migration.run_migrations()
    with sqlite3.connect(database_path) as con:
        assert con.execute(
            "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        ).fetchall() == first_ledger
        assert con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0] == first_raw_count


def test_failed_migration_rolls_back_only_its_transaction(
    database_path, monkeypatch
):
    _create_v2(database_path)

    def fail_after_ddl(con):
        con.execute("CREATE TABLE must_rollback (id INTEGER PRIMARY KEY)")
        raise RuntimeError("deterministic migration failure")

    failing = migration.Migration(
        3,
        "energy-memory-schema-foundation",
        "test-failure",
        fail_after_ddl,
    )
    monkeypatch.setattr(
        migration,
        "MIGRATIONS",
        (migration.MIGRATIONS[0], migration.MIGRATIONS[1], failing),
    )

    with pytest.raises(RuntimeError, match="deterministic migration failure"):
        migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 0
        assert con.execute("SELECT version FROM schema_info").fetchone()[0] == 2
        assert con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='must_rollback'"
        ).fetchone() is None
        assert con.execute("SELECT COUNT(*) FROM energy_samples_v1").fetchone()[0] == 2


def test_unsupported_newer_schema_fails_before_mutation_or_backup(database_path):
    with sqlite3.connect(database_path) as con:
        con.execute("CREATE TABLE sentinel(value TEXT)")
        con.execute("INSERT INTO sentinel VALUES ('unchanged')")
        con.execute(f"PRAGMA user_version = {config.SCHEMA_VERSION + 1}")

    with pytest.raises(migration.UnsupportedSchemaVersion, match="newer than supported"):
        migration.run_migrations()

    assert _migration_backups(database_path) == []
    with sqlite3.connect(database_path) as con:
        assert con.execute("SELECT value FROM sentinel").fetchone()[0] == "unchanged"


def test_corrupt_migration_metadata_has_clear_failure(database_path):
    migration.run_migrations()
    with sqlite3.connect(database_path) as con:
        con.execute(
            "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 3"
        )

    with pytest.raises(migration.MigrationMetadataError, match="version 3"):
        migration.run_migrations()


def test_corrupt_legacy_metadata_has_clear_failure(database_path):
    with sqlite3.connect(database_path) as con:
        con.execute("CREATE TABLE schema_info(version INTEGER PRIMARY KEY)")
        con.executemany("INSERT INTO schema_info VALUES (?)", [(1,), (2,)])

    with pytest.raises(migration.MigrationMetadataError, match="exactly one"):
        migration.run_migrations()


def test_conflicting_phase0_table_shape_rolls_back_with_clear_error(database_path):
    _create_v2(database_path, with_samples=False)
    with sqlite3.connect(database_path) as con:
        con.execute("CREATE TABLE device_sources(unrelated TEXT)")

    with pytest.raises(migration.MigrationMetadataError, match="device_sources"):
        migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        assert con.execute("SELECT version FROM schema_info").fetchone()[0] == 2
        assert con.execute("PRAGMA user_version").fetchone()[0] == 0
        assert con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_samples'"
        ).fetchone() is None


def test_backup_manifest_uses_authoritative_schema_version(
    database_path, tmp_path, monkeypatch
):
    migration.run_migrations()
    monkeypatch.setattr(config, "USER_DATA_DIR", tmp_path)
    output = tmp_path / "backup.zip"

    backup_service.create_backup_zip(str(output))

    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["database_schema_version"] == config.SCHEMA_VERSION


def test_storage_connections_enable_foreign_keys_consistently(database_path):
    con = storage._connect()
    try:
        assert con.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            con.execute(
                """
                INSERT INTO source_state (
                    source_id, state_kind, state_value,
                    effective_at_utc, received_at_utc
                ) VALUES (99999, 'availability', 'offline',
                          '2026-07-31T10:00:00Z', '2026-07-31T10:00:00Z')
                """
            )
    finally:
        con.close()


def test_today_storage_rows_remain_readable_after_restart(database_path):
    _create_v2(database_path)
    migration.run_migrations()
    storage._MIGRATED = False

    first = storage.get_samples_since(
        datetime(2026, 7, 31, 9, 59, 0)
    )
    storage._MIGRATED = False
    second = storage.get_samples_since(
        datetime(2026, 7, 31, 9, 59, 0)
    )

    assert second == first
    assert [row["grid_power_w"] for row in second] == [-789.0, 0.0]


def test_backup_names_are_collision_safe_and_do_not_overwrite(
    database_path, monkeypatch
):
    database_path.touch()
    monkeypatch.setattr(migration, "_backup_stamp", lambda: "20260731T120000000000Z")

    first = migration._next_backup_path(database_path, 2, 3)
    first.write_text("preserve me", encoding="utf-8")
    second = migration._next_backup_path(database_path, 2, 3)

    assert first.name == "energy.pre-v2-to-v3-20260731T120000000000Z.db.bak"
    assert second.name == "energy.pre-v2-to-v3-20260731T120000000000Z-1.db.bak"
    assert first.read_text(encoding="utf-8") == "preserve me"


def test_backup_failure_prevents_migration(database_path, monkeypatch):
    _create_v2(database_path)

    def fail_backup(*_args, **_kwargs):
        raise OSError("backup destination unavailable")

    monkeypatch.setattr(migration, "_create_consistent_backup", fail_backup)
    with pytest.raises(OSError, match="backup destination unavailable"):
        migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 0
        assert con.execute("SELECT version FROM schema_info").fetchone()[0] == 2
        sample_count = con.execute(
            "SELECT COUNT(*) FROM energy_samples_v1"
        ).fetchone()[0]
        assert sample_count == 2
        assert not migration._table_exists(con, "raw_samples")


def test_failed_migration_leaves_valid_pre_migration_backup(
    database_path, monkeypatch
):
    _create_v2(database_path)

    def fail_after_write(con):
        con.execute("CREATE TABLE interrupted_write(value TEXT)")
        con.execute("INSERT INTO interrupted_write VALUES ('not committed')")
        raise RuntimeError("simulated interruption")

    failing = migration.Migration(3, "interrupted", "test", fail_after_write)
    monkeypatch.setattr(
        migration,
        "MIGRATIONS",
        (migration.MIGRATIONS[0], migration.MIGRATIONS[1], failing),
    )

    with pytest.raises(RuntimeError, match="simulated interruption"):
        migration.run_migrations()

    backups = _migration_backups(database_path)
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert backup.execute("SELECT version FROM schema_info").fetchone()[0] == 2
        sample_count = backup.execute(
            "SELECT COUNT(*) FROM energy_samples_v1"
        ).fetchone()[0]
        assert sample_count == 2


def test_concurrent_startup_applies_pending_migration_once(database_path):
    _create_v2(database_path)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: migration.run_migrations(), range(2)))

    assert results == [None, None]
    with sqlite3.connect(database_path) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 3
        assert con.execute(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 3"
        ).fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0] == 4
    assert len(_migration_backups(database_path)) == 1


def test_realistic_existing_rows_preserve_signed_zero_null_and_duplicates(
    database_path
):
    _create_v2(database_path, with_samples=False)
    rows = [
        (
            f"2026-07-31 10:{index // 60:02d}:{index % 60:02d}",
            f"2026-07-31 10:{index // 60:02d}:{index % 60:02d}",
            None,
            None,
            1000.0 if index != 3 else None,
            [3557.0, -789.0, 0.0, None, 3557.0][index],
            2500.0 if index != 3 else None,
            9798031.0 if index != 3 else None,
            12480630.0 if index != 3 else None,
            "valid" if index != 3 else "unavailable",
            "valid" if index != 3 else "unavailable",
            "valid" if index != 3 else "partial",
        )
        for index in range(5)
    ]
    with sqlite3.connect(database_path) as con:
        con.execute("CREATE TABLE user_metadata(key TEXT PRIMARY KEY, value TEXT)")
        con.execute("INSERT INTO user_metadata VALUES ('installation', 'existing')")
        con.executemany(
            """
            INSERT INTO energy_samples_v1 (
                measured_at, received_at, pv_measured_at, grid_measured_at,
                pv_power_w, grid_power_w, pv_energy_today_wh,
                grid_import_total_wh, grid_export_total_wh,
                pv_quality_status, grid_quality_status, sample_quality_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        before = con.execute("SELECT * FROM energy_samples_v1 ORDER BY id").fetchall()

    migration.run_migrations()
    migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        after = con.execute(
            "SELECT * FROM energy_samples_v1 ORDER BY id"
        ).fetchall()
        assert after == before
        assert con.execute(
            "SELECT value FROM user_metadata WHERE key = 'installation'"
        ).fetchone()[0] == "existing"
        grid_values = [
            row[0]
            for row in con.execute(
                """
                SELECT grid_power_w FROM raw_samples
                JOIN device_sources USING(source_id)
                WHERE provider = 'tasmota' ORDER BY sample_id
                """
            )
        ]
        assert grid_values == [3557.0, -789.0, 0.0, 3557.0]
        assert con.execute(
            "SELECT COUNT(*) FROM raw_samples WHERE dedupe_key LIKE '%:4'"
        ).fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM device_sources").fetchone()[0] == 2


def test_large_existing_database_migrates_without_loss_or_duplicates(database_path):
    _create_v2(database_path, with_samples=False)
    count = 1_000
    with sqlite3.connect(database_path) as con:
        con.executemany(
            """
            INSERT INTO energy_samples_v1 (
                measured_at, received_at, pv_power_w, grid_power_w,
                pv_energy_today_wh, grid_import_total_wh, grid_export_total_wh,
                pv_quality_status, grid_quality_status, sample_quality_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'valid', 'valid', 'valid')
            """,
            (
                (
                    f"2026-07-31 12:{index // 60:02d}:{index % 60:02d}",
                    f"2026-07-31 12:{index // 60:02d}:{index % 60:02d}",
                    float(index),
                    float((index % 21) - 10),
                    2500.0,
                    9798031.0,
                    12480630.0,
                )
                for index in range(count)
            ),
        )

    migration.run_migrations()
    migration.run_migrations()

    with sqlite3.connect(database_path) as con:
        legacy_count = con.execute(
            "SELECT COUNT(*) FROM energy_samples_v1"
        ).fetchone()[0]
        raw_count = con.execute("SELECT COUNT(*) FROM raw_samples").fetchone()[0]
        grid_range = con.execute(
            "SELECT MIN(grid_power_w), MAX(grid_power_w) FROM raw_samples"
        ).fetchone()
        assert legacy_count == count
        assert raw_count == count * 2
        assert grid_range == (-10.0, 10.0)


@pytest.mark.skipif(os.name != "nt", reason="Windows packaged-path behavior")
def test_packaged_windows_data_path_supports_spaces_and_non_ascii(
    tmp_path, monkeypatch
):
    local_app_data = tmp_path / "Benutzer Änne" / "Local App Data"
    monkeypatch.setenv("LOCALAPPDATA", str(local_app_data))
    monkeypatch.setattr(config.sys, "frozen", True, raising=False)

    user_data_dir = config._user_data_dir()
    database = user_data_dir / "database" / "energy.db"
    monkeypatch.setattr(config, "DB_PATH", database)
    migration.run_migrations()

    assert user_data_dir == local_app_data / "EnergyRadar"
    assert database.exists()
    assert not database.is_relative_to(config.BASE_DIR)
    with sqlite3.connect(database) as con:
        assert con.execute("PRAGMA user_version").fetchone()[0] == 3
