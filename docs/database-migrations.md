# Database migrations

EnergyRadar owns its local SQLite schema in [`energyradar/services/migration.py`](../energyradar/services/migration.py). The configured database remains at `config.DB_PATH`: `%LOCALAPPDATA%\EnergyRadar\database\energy.db` in a packaged Windows build and `energyradar/database/energy.db` during development.

## Version ownership

From schema version 3 onward, `PRAGMA user_version` is the authoritative current version. `schema_migrations` records every completed migration with its name, deterministic checksum, UTC application time, and application version. The legacy `schema_info` row is updated for compatibility, but new code must not treat it as authoritative.

`config.SCHEMA_VERSION` is the highest version this application can open. A database with a higher version fails before backup or mutation. Missing, non-contiguous, or checksum-mismatched migration metadata also fails explicitly; EnergyRadar does not guess or rebuild it silently.

## Lifecycle

Migrations run automatically in two places:

- explicitly during React desktop startup in `desktop_web.main()`;
- defensively before the first SQLite storage connection in `storage._connect()`.

Repeated calls are idempotent. An in-process lock plus SQLite's bounded `BEGIN IMMEDIATE` write reservation serializes desktop startup and defensive storage initialization; the authoritative version is re-read after the reservation so a second process cannot apply a migration twice. Foreign keys and a 5-second busy timeout are enabled on migration and storage connections.

Before changing an existing older database, the runner creates an integrity-checked SQLite backup beside the live database. Its collision-safe name records the version range and UTC creation time, for example `energy.pre-v2-to-v3-20260731T153012123456Z.db.bak`. Existing backups are never silently overwritten. Fresh empty databases do not need a pre-migration backup.

Each pending migration executes in its own `BEGIN IMMEDIATE` transaction. Its schema/data changes, compatibility version, migration record, and `PRAGMA user_version` commit together. An exception rolls back that migration. Previously completed versions remain valid and the pre-migration backup remains available.

## Adding a migration

1. Increase `config.SCHEMA_VERSION` by one.
2. Add one `Migration` entry with the next contiguous integer version, stable name, checksum basis, and an apply function.
3. Use individual `Connection.execute()` calls. Do not use `executescript()`, which can introduce implicit transaction boundaries.
4. Make changes additive unless a separately reviewed recovery design requires otherwise.
5. Never reinterpret units, power signs, nulls, or valid zero values silently. Document and test any explicit transformation.
6. Add deterministic tests for fresh creation, upgrade, repeat execution, rollback, backups, metadata validation, and preservation of existing rows.
7. Verify that a fresh database and every supported upgrade path produce the same final table/index definitions.

Do not edit the name or checksum basis of an applied migration. A correction is a new migration.

## Downgrade and recovery policy

Automatic downgrade is unsupported. A newer database is left untouched and produces `UnsupportedSchemaVersion`. Recovery uses the pre-migration `.db.bak` copy or a user-created ZIP backup after its manifest, hashes, SQLite integrity, foreign keys, and compatible schema have been validated. The migration backup is a complete SQLite database and can be restored manually while EnergyRadar is stopped by first preserving the failed live database, then copying the validated backup to the configured `energy.db` path. The application does not yet expose restore; Phase 0 does not add restore behavior.

The v3 migration preserves `energy_samples_v1` unchanged and copies existing values additively into source-specific `raw_samples` rows with deterministic deduplication keys. Signed grid power and valid zero values are retained. Existing Wh counters are explicitly represented as kWh in the new canonical columns while the original Wh values remain untouched in `energy_samples_v1`. Because current live writes intentionally remain on `energy_samples_v1`, the later Phase 1 writer migration must idempotently catch up rows created after v3 before switching any reads.

## Phase 0 boundaries

Schema v3 introduces only foundations:

- `schema_migrations` and `application_metadata`;
- `device_sources` and `source_state`;
- `backfill_runs` metadata, without performing backfill;
- `raw_samples`, without changing the live writer or frontend readers.

It does not add historical UI, aggregation, retention cleanup, exports, greetings, Fronius detail/archive behavior, polling changes, or calculation changes. The existing Today history continues to read `energy_samples_v1`.

## Phase 1 persistence contract

Phase 1 keeps schema version 3 because the existing `raw_samples`, `device_sources`, constraints, and indexes already cover its write and bounded-read requirements. Each configured collection cycle transactionally keeps the compatibility write in `energy_samples_v1` and adds:

- a Fronius source row containing directly reported finite values and source/receive timestamp evidence;
- a Tasmota MT631/MT175 source row preserving signed grid power, cumulative measured totals, device time text/timezone, and receive time;
- an EnergyRadar derived-cycle row used by Today/7-day/30-day history queries.

The canonical chart timestamp is the collection cycle's UTC receive timestamp. Tasmota observations retain device and receive timestamps separately. The Fronius live endpoint has no device timestamp, so its naive host-local model timestamp is retained only as source text and the aware cycle receipt is authoritative; it is never mislabeled as UTC. Stable source UUIDs and cycle-based deduplication keys make repeated writes and restarts idempotent.

The `provenance` column continues to describe acquisition (`measured` or future `backfilled`), while `quality_state` distinguishes `measured`, `derived`, `partial`, and `missing`. A derived-cycle row contains `house_power_w` only when the unchanged live freshness/alignment calculation accepted both inputs. It may contain nullable source values and measured counters, but it never converts unavailable values to zero. Existing v2 rows are caught up into a stable legacy derived source only when no Phase 1 live derived row already represents that cycle; their PV and signed-grid evidence remains readable, but house power stays null because v2 did not persist alignment evidence. The v2 table remains untouched.
