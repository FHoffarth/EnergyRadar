# Energy Memory & Historical Analytics — Architecture and Product Audit

Status: documentation blueprint only<br>
Audit base: `main` at `4c6c96af433df9e4b961a17ca9553a25abe8e952`<br>
Application version: `0.5.0-rc1`<br>
Audit date: 2026-07-31

## 1. Executive summary

EnergyRadar already has a small, useful local energy memory. The current Qt/React desktop path writes combined Fronius and Tasmota samples to SQLite in ten-second buckets. Those rows survive a restart and are re-read for the Today chart and report exports. The current cards, React observables, source errors, device status, and most detailed source metadata are memory-only. Nothing is collected while EnergyRadar is closed or the computer sleeps.

This is not yet a trustworthy long-term historical subsystem. The existing `energy_samples_v1` table is a combined wide row without source identity, without the MT631 device timestamp, without retained phase/device detail, and without a retention policy. History calculations ignore the stored per-source quality columns and assume that values co-located in a bucket are suitable for derivation. Counter deltas can produce daily energy, but there is no reset/device-replacement model. Backup creation exists, restore does not. Migration and backup schema-version mechanisms are inconsistent and need to be unified before adding more durable data.

The safest next step is a schema-foundation PR, not a chart PR. It should introduce an append-oriented, UTC-based schema contract, source identities, per-field quality/provenance, migration bookkeeping, and migration/backup recovery tests while keeping all current UI behavior unchanged. Collection can then dual-write behind tests, followed by deterministic aggregation, gap-aware UX, exports, and only later device-dependent backfill.

Key trust conclusions:

- Live samples and the current-day chart survive normal application restarts.
- Exact readings during app-closed, sleeping, offline, or network-gap periods are permanently absent from the present store.
- No Fronius historical/archive backfill capability is confirmed by this repository for the installed device. The only implemented and repository-confirmed endpoint is `GetPowerFlowRealtimeData.fcgi`; therefore closed-app recovery must currently be shown as missing.
- Cumulative totals may support interval energy differences, but they must never be expanded into fabricated precise power curves.
- Signed grid power remains canonical: positive is import, negative is export. House power remains `pv_power_w + grid_power_w` only for fresh, aligned, complete sources.

## 2. Current behavior

### 2.1 Active desktop data flow

The packaged desktop entry point is [`desktop_web.py`](../desktop_web.py), and the PyInstaller specification includes the React build and Qt bridge in [`packaging/EnergyRadar.spec`](../packaging/EnergyRadar.spec). The older Flask/pywebview and QML paths remain in the repository but are not the canonical packaged React path.

```text
Fronius GetPowerFlowRealtimeData.fcgi ─┐
                                      ├─ EnergyBridge polling worker
Tasmota Status 10 (MT631/MT175) ──────┘        │
                                               ├─ SQLite energy_samples_v1
                                               ├─ NowViewModel → Qt signal → React cards
                                               ├─ HistoryService → TodayViewModel → React chart
                                               └─ DevicesViewModel → React device state
```

[`EnergyBridge.__init__`](../energyradar/ui/bridge.py) starts a `QTimer` at the effective `refresh_seconds` and schedules the first poll on the next event-loop tick. [`UISettings.resolve_effective`](../energyradar/ui/settings.py) bounds live polling to 3–10 seconds; new profiles default to five seconds. [`EnergyBridge._run_refresh`](../energyradar/ui/bridge.py) reads Fronius first, then starts and joins the smart-meter reader thread, timestamps the combined collection cycle in UTC, saves it, builds the live and Today view models, and emits JSON across QWebChannel.

Although the comment calls the MT175/MT631 read “parallel,” it begins after the synchronous Fronius request has completed. This matters for future source-alignment metadata and performance, but it does not change the current signed-power contract.

### 2.2 Current reading and chart paths

- Live cards use the newest collector objects directly through [`build_now_vm`](../energyradar/ui/viewmodels.py), [`processNowViewModel`](../frontend/react-ui/src/lib/energyService.ts), and [`DesktopBridgeEnergyProviderImpl`](../frontend/react-ui/src/providers/DesktopBridgeEnergyProvider.ts). They do not read the last SQLite row.
- The Today summary and chart call [`history.get_today_history`](../energyradar/services/history.py), which reads persisted SQLite rows on every successful refresh through [`build_today_vm_with_mt175`](../energyradar/ui/viewmodels.py).
- React state in [`energyService.ts`](../frontend/react-ui/src/lib/energyService.ts) and [`AppContext.tsx`](../frontend/react-ui/src/context/AppContext.tsx) is memory-only. It is repopulated from the bridge after restart.
- [`MemoryView.tsx`](../frontend/react-ui/src/views/MemoryView.tsx) is currently an export/backup screen with an explicit “memory in development” notice. It is not a historical analytics browser.

### 2.3 Explicit restart answers

| Question | Answer | Evidence |
|---|---|---|
| Are live energy samples persisted across application restarts? | Yes, when at least one energy source is configured and the save succeeds. They are stored in `energy_samples_v1`. | [`EnergyBridge._run_refresh`](../energyradar/ui/bridge.py), [`storage.save_sample`](../energyradar/services/storage.py) |
| Does the current chart survive restart? | Yes for rows retained in SQLite, including earlier rows from the current local day. The Today view reloads the database. It is not a multi-period history UI. | [`history.get_today_history`](../energyradar/services/history.py), [`build_today_vm_with_mt175`](../energyradar/ui/viewmodels.py) |
| What is lost while the app is closed? | Every instantaneous PV/grid/house value, source status transition, error, phase value, and device detail that no device archive later supplies. No background service runs. | [`desktop_web.py`](../desktop_web.py), collectors and bridge |
| Is there a partial historical store? | Yes: a local SQLite table with combined power, selected counters, timestamps, and quality strings. | [`migration._SCHEMA_V2`](../energyradar/services/migration.py) |
| Is there a migration framework? | Partially. Startup runs versioned, transactional setup with integrity checks and a `.bak` copy, but only a v1→v2 path exists and version bookkeeping needs consolidation. | [`migration.run_migrations`](../energyradar/services/migration.py) |
| Is backup/restore supported? | Consistent ZIP backup creation exists; restore is not implemented. A second legacy backup class also returns `False` for restore and should not become the new foundation. | [`exporters/backup_service.py`](../energyradar/services/exporters/backup_service.py), [`backup.BackupManager`](../energyradar/services/backup.py) |

## 3. Current limitations

The following are implementation blockers for a trustworthy multi-year history, not requests to change this audit branch:

1. **Combined-bucket provenance loss.** `energy_samples_v1` stores one row per aggregator timestamp. It does not identify a concrete Fronius or meter instance and does not preserve the MT631 `Time`; `grid_measured_at` is populated from `received_at`.
2. **Quality is stored but not enforced by history.** [`history.get_today_history`](../energyradar/services/history.py) integrates non-null values regardless of `pv_quality_status`, `grid_quality_status`, or `sample_quality_status`.
3. **Historical alignment is implicit.** Live house power applies freshness/alignment checks and a transparent 50 W timing-skew boundary in [`build_now_vm`](../energyradar/ui/viewmodels.py). Historical house power only calls `derive_home_power` on values sharing a combined row; the alignment decision is not persisted.
4. **Fronius nulls become zero.** [`fronius.read_url`](../energyradar/collectors/fronius.py) uses `site.get(...) or 0` for PV power and all energy counters. This deliberately accommodates nighttime `P_PV: null`, but it also makes missing/malformed source fields indistinguishable from measured zero and is not a safe long-term raw-data rule.
5. **Counter semantics are incomplete.** Daily PV, grid import, and grid export deltas are used without explicit reset, rollover, device-replacement, or monotonicity events.
6. **No closed-app recovery.** There is no archive client, import job, cursor, or backfill merge.
7. **No retention or maintenance.** There is no deletion, compaction, checkpoint policy, scheduled integrity check, or vacuum strategy.
8. **Migration version mismatch.** Runtime migrations use `schema_info`, while the backup manifest reports `PRAGMA user_version`, which the migration code never sets. Migration backup is attempted on every process’s first connection, even when no schema upgrade is required. Migration/restore behavior has no dedicated test matrix.
9. **Backup scope/restore gap.** The active backup contains the database and `ui-settings.json`, but not the separate `data-source.json`, weather cache, logs, or window state. Excluding cache/log/window state is reasonable; device configuration inclusion must be an explicit privacy/product decision. Restore validation and atomic replacement are absent.
10. **Forecast history coverage is approximate.** [`forecast.get_historical_days_count`](../energyradar/services/forecast.py) assumes 288 samples/day (five-minute cadence), while current persistence buckets at ten seconds. It counts non-null PV rows, not trustworthy covered intervals.
11. **Dormant paths diverge.** [`energyradar/app.py`](../energyradar/app.py), the static Flask UI, and QML screens are not the packaged React path and contain older assumptions. Historical work must declare the React/Qt bridge as authoritative or deliberately retire/align those paths.

## 4. Existing persistence inventory

Paths below distinguish packaged ownership from development behavior. [`config._user_data_dir`](../energyradar/config.py) resolves Windows to `%LOCALAPPDATA%\EnergyRadar`, macOS to `~/Library/Application Support/EnergyRadar`, and Linux to `$XDG_DATA_HOME/EnergyRadar` or `~/.local/share/EnergyRadar`. In a frozen build, `DATA_DIR` is the user-data directory; in development it is the repository’s `energyradar` directory.

| Data | Location and format | Owner / lifecycle | Retention and restart | Crash/corruption behavior | Privacy |
|---|---|---|---|---|---|
| Energy samples | Packaged: `%LOCALAPPDATA%\EnergyRadar\database\energy.db`; dev: `energyradar/database/energy.db`; SQLite | Backend [`storage.py`](../energyradar/services/storage.py) | Indefinite; survives restart; no purge | Each context-managed write is transactional. Startup migration runs `PRAGMA integrity_check` only during an actual version upgrade. No runtime quarantine/rebuild path. | Reveals occupancy/load/PV patterns and meter totals; highly sensitive local household data. |
| UI settings | `%LOCALAPPDATA%\EnergyRadar\ui-settings.json`; JSON | [`ui/settings.py`](../energyradar/ui/settings.py) | Indefinite; survives restart; unknown keys retained | Atomic temporary-file replace; malformed root is renamed to timestamped `ui-settings.corrupt-*.json`; write uses `allow_nan=False`. | Contains device addresses, coarse location/coordinates, export path, preferences, and future display name. |
| Fronius source config | `%LOCALAPPDATA%\EnergyRadar\data-source.json`; JSON | [`services/data_source.py`](../energyradar/services/data_source.py) | Indefinite; survives restart; environment override wins | Atomic replace; malformed/unsupported content fails closed to unconfigured, but is not quarantined. Address is also mirrored through UI settings flows. | Private-network address; credentials are forbidden. Duplication increases consistency risk. |
| Current readings and errors | Python objects/strings in one poll cycle | [`EnergyBridge`](../energyradar/ui/bridge.py) | Lost on restart and overwritten next poll | Unhandled cycle errors are logged. Raw exception strings can be retained in transient device view models. | May reveal local hosts/error details in logs/UI diagnostics. |
| React live/Today/device state | In-process observables and React state | [`energyService.ts`](../frontend/react-ui/src/lib/energyService.ts), [`AppContext.tsx`](../frontend/react-ui/src/context/AppContext.tsx) | Lost on restart; rebuilt from bridge/SQLite | Parse failures log to the WebEngine console and generally preserve or fall back to prior/unknown state depending on path. | No energy values are intentionally written to browser storage by the React app. |
| Legacy browser theme | QWebEngine/browser `localStorage` key in the older static UI | [`static/app.js`](../energyradar/static/app.js) | Browser-profile dependent; not used by the canonical React settings path | Browser-managed | Preference only. Do not reuse browser storage for energy history. |
| Weather cache | `%LOCALAPPDATA%\EnergyRadar\weather-cache.json`; versioned JSON | [`services/weather/cache.py`](../energyradar/services/weather/cache.py) | Fresh 20 min, stale fallback to 6 h, then expired; survives restart | Atomic fsync/replace; corrupt or wrong-version cache is ignored, not moved | Contains rounded-coordinate cache key and weather data. It should stay outside energy backups by default. |
| Diagnostic log | Packaged: `%LOCALAPPDATA%\EnergyRadar\energyradar.log`; dev: `energyradar/energyradar.log` | [`desktop_web._configure_file_logging`](../desktop_web.py) | Append-only; no rotation configured | Logging failures are not a data recovery mechanism | Can include device errors/addresses; must be opt-in when shared. |
| Window geometry | Packaged user data `window.json`; JSON | [`desktop_web.py`](../desktop_web.py) | Survives restart | Non-atomic write; invalid/off-screen content falls back and logs | Low sensitivity; device/display layout. |
| CSV/JSON/PDF exports | User-selected path | [`reporting.py`](../energyradar/services/reporting.py) and exporters | User-managed permanent files | Export writers are atomic; reports reflect database content/quality limitations at creation time | Portable copies of sensitive household history. |
| ZIP backup | User-selected `.zip`; `energy.db`, optional `ui-settings.json`, manifest | [`exporters/backup_service.py`](../energyradar/services/exporters/backup_service.py) | User-managed | Uses SQLite backup API, integrity-checks the copy, hashes members, and atomically replaces ZIP. No restore path. | Highest-sensitivity portable artifact; settings may include coordinates/device addresses. |
| Environment configuration | Process environment, notably `FRONIUS_URL`, `MT175_TIMEZONE` | Operator / OS | Outside app lifecycle | Not backed up | May expose device address; never copy automatically into exports. |

`STORE_INTERVAL_SECONDS = 60` in [`config.py`](../energyradar/config.py) is currently unused. Actual persistence follows the bridge poll and is deduplicated into ten-second buckets by [`save_sample`](../energyradar/services/storage.py). Documentation and future configuration must not treat the unused constant as the real retention cadence.

### Current SQLite schema and behavior

The repository-defined v2 table contains:

- aggregator `measured_at` and `received_at` text timestamps;
- `pv_measured_at` and `grid_measured_at` text timestamps;
- `pv_power_w`, signed `grid_power_w`, PV daily energy in Wh, import/export totals in Wh;
- per-source and combined quality strings;
- a unique constraint and index on `measured_at`.

Writes floor the aggregator time to a ten-second UTC bucket. `INSERT OR IGNORE` followed by an update can fill null fields without replacing an existing value with null. This prevents duplicate rows within a bucket, but later non-null readings can overwrite earlier non-null values, `received_at` is not updated on merge, and no revision provenance is recorded. Out-of-order inserts are allowed and sorted on read. The table has no foreign key to a source/device entity.

## 5. Source and field inventory

### 5.1 Fronius fields

Implemented endpoint: the UI-managed URL is fixed by [`data_source.API_PATH`](../energyradar/services/data_source.py) to `/solar_api/v1/GetPowerFlowRealtimeData.fcgi`. [`fronius.read_url`](../energyradar/collectors/fronius.py) reads `Body.Data.Site`.

| Canonical field | Source field | Unit / kind | Timestamp and precision | Null/freshness behavior | Persistence / aggregation fitness |
|---|---|---|---|---|---|
| `pv_power_w` | `Site.P_PV` | W; instantaneous; non-negative by domain | Python/SQLite float. `EnergyReading.timestamp` is local host receive time from `datetime.now()`, not a device timestamp; no separate collector receive timestamp. | Current code maps any falsy/missing value to `0`. Live freshness is age `< 3 × refresh_seconds`. | Stored. Suitable only after finite/type validation and explicit missing-vs-night-zero semantics. Integrate only across trustworthy bounded gaps. |
| `pv_energy_today_wh` | `Site.E_Day` | Wh; cumulative daily counter | Float; same collector timestamp | Falsy/missing becomes `0`. | Stored. Good corroborating daily counter after reset/day-boundary handling; not a precise curve. |
| `pv_energy_year_wh` | `Site.E_Year` | Wh; cumulative annual counter | Float; same timestamp | Falsy/missing becomes `0`. | Present in `EnergyReading`, not stored in `energy_samples_v1`. Useful for reconciliation, not power reconstruction. |
| `pv_energy_lifetime_wh` | `Site.E_Total` | Wh; lifetime counter | Float; same timestamp | Falsy/missing becomes `0`. | Present in `EnergyReading`, not stored. Persist sparingly as checkpoints with device identity/reset rules. |
| Fronius device state/errors | None from response is modeled | State/event | Collector exceptions occur at receive time | Exception string is transient/logged; source quality may be `offline`, but current bridge can label response-shape errors as offline. | Persist normalized status events, not secrets/raw stack traces. |
| AC/DC/MPPT/temperature/firmware/model/serial | Not read | Device-dependent | None | Unavailable in current model | Not currently safe to claim or aggregate. Add only through confirmed capability discovery. |

### 5.2 Tasmota / bitShake / MT631 fields

Implemented endpoint: [`mt175.build_endpoint`](../energyradar/collectors/mt175.py) canonicalizes the local device address to `/cm?cmnd=Status%2010`. [`mt175.parse`](../energyradar/collectors/mt175.py) prefers `StatusSNS.MT631` over `StatusSNS.MT175` if both exist and preserves finite decimal values. The compatibility model remains named [`MT175Reading`](../energyradar/models/mt175.py).

| Canonical field | Source field | Unit / sign / kind | Timestamp and precision | Null/freshness behavior | Persistence / aggregation fitness |
|---|---|---|---|---|---|
| `grid_power_w` | `Power` | W; instantaneous signed net flow. **Positive import, negative export, zero valid.** | Finite Python float; device time from `StatusSNS.Time`; separate timezone-aware `received_at` captured at parse. | Missing, null, malformed, NaN, or infinity → `None`. MT175 PIN lock can make it unavailable; MT631 zero stays valid. Live freshness uses receive age. | Stored as signed W. Safe after current validation. Never clamp sign. Integrate positive and negative lobes separately. |
| `grid_import_total_kwh` | `ImportActive` | kWh; cumulative import counter | Finite decimal float | Invalid/missing → `None` | Converted to Wh and stored. Suitable for guarded counter differences; never for curve fabrication. |
| `grid_export_total_kwh` | `ExportActive` | kWh; cumulative export counter | Finite decimal float | Invalid/missing → `None` | Converted to Wh and stored. Same counter rules. |
| `grid_phase_l1_w`, `grid_phase_l2_w`, `grid_phase_l3_w` | `power_L1..3` | W; instantaneous, source semantics | Finite float or `None` | Optional for MT631; never fabricated | Parsed but not persisted. Aggregate only if capability/sign semantics are documented. |
| `meter_id` | `server_id` | Identifier | String | Optional/blank → `None` | Parsed but not persisted. Needed as a privacy-sensitive source identity/device-replacement discriminator. |
| `meter_type` | sensor block key | `MT631` or `MT175` | Exact string | Supported block required; MT631 precedence | Parsed but not persisted. Persist as adapter/capability metadata. |
| `pin_locked` | MT175 heuristic | Boolean quality metadata | Receive-time evaluation | Applied only to legacy MT175 and only when all power channels are present/zero with empty server ID | Not directly persisted; reflected by grid quality. Store normalized quality/event, not a fake zero. |
| `source_measured_at` | `StatusSNS.Time` | Zoned local device timestamp after configured-zone attachment | Second precision; source string has no UTC offset, so the repeated DST hour is ambiguous | Malformed/missing → `None` | **Currently lost**: storage writes `mt175.received_at` into `grid_measured_at`. Future raw store must preserve both raw/local source time and receive UTC. |
| `received_at` | parser clock | UTC-convertible aware datetime | Host wall-clock | Always present | Reliable ingest anchor; stored indirectly as grid timestamp and combined receive timestamp. |

### 5.3 Derived EnergyRadar values

| Field | Formula / semantics | Availability and quality | Persistence / aggregation |
|---|---|---|---|
| `house_power_w` | `pv_power_w + grid_power_w` | Live only when both readings are fresh and their receive timestamps differ by less than the stale threshold. A result in `[-50 W, 0 W)` is transparently represented as zero for collection/rounding skew; a more negative contradiction is unavailable. No battery model is supported. | Not stored in v2; recalculated. Future intervals should preserve formula version, input IDs, alignment, and derived quality. |
| `grid_import_power_w` | `max(grid_power_w, 0)` | Null if signed grid unavailable | Derived; integrate trustworthy segments. |
| `grid_export_power_w` | `max(-grid_power_w, 0)` | Null if signed grid unavailable | Derived; integrate trustworthy segments. |
| `pv_energy_kwh` | Prefer guarded Fronius counter difference; otherwise bounded power integration when coverage is adequate | Current Today logic uses >50% PV coverage fallback | Store interval/aggregate derivation method and coverage. |
| `house_energy_kwh` | Integrate trustworthy aligned house power, or energy balance `PV + import - export` when all compatible energies/coverage exist | Current code requires ≥90% home coverage for balance result, then clamps negative to zero | A negative contradiction must become invalid/source-conflict, not silently clamp in the future. |
| `self_consumed_pv_kwh` | Without battery: `max(0, pv_energy_kwh - grid_export_kwh)` over the same covered interval, bounded by PV and house energy | Null if boundaries/sources incompatible or battery exists/unknown | Store result plus method/coverage, not only percentage. |
| `self_consumption_rate` | `self_consumed_pv_kwh / pv_energy_kwh` | Null when PV denominator absent or zero | Never display as zero merely because denominator is unavailable. |
| `autarky_rate` | `self_consumed_pv_kwh / house_energy_kwh`, equivalently `1 - grid_import/house` only under compatible boundaries | Null when house denominator absent or zero | Same trust rule. |
| Quality/coverage | Current enum: valid, partial, stale, locked, offline, invalid, legacy, unknown | Source and sample strings exist, but history does not enforce them | Future quality must be structured, queryable, and per metric/interval. |

All future numeric ingestion must reject booleans, NaN, infinity, and malformed strings. A valid `0` must remain measured zero, distinct from null/missing.

## 6. Fronius capability audit

This audit deliberately limits confirmed capabilities to repository evidence. The repository contains no bundled official Fronius API document and no clearly referenced official archive-capability document. It identifies the adapter as “Fronius Solar API v1,” but that label alone does not prove which optional endpoints the actual inverter/datamanager/firmware exposes.

| Capability | Classification | Basis and backfill judgment |
|---|---|---|
| Current PV power | **Currently implemented** | `Site.P_PV` from `GetPowerFlowRealtimeData.fcgi`. Live-only in EnergyRadar; unsuitable for backfill by itself. |
| Daily production | **Currently implemented** | `Site.E_Day`. Counter/checkpoint suitable for daily reconciliation, not a precise intraday curve. |
| Annual and lifetime production | **Currently implemented in collector model, not persisted** | `Site.E_Year`, `Site.E_Total`. Useful as coarse counters/checkpoints. Not archive series. |
| Historical power series/archive data | **Uncertain/device-dependent; not implemented** | No repository-confirmed endpoint, device probe, granularity, or retention contract. No backfill capability may be promised. |
| Daily/monthly/yearly historical totals | **Uncertain/device-dependent; not implemented** | Current endpoint exposes only current counter values. Potential device APIs/cloud products are out of evidence scope. |
| AC voltage/current/frequency/phases | **Uncertain/device-dependent; not implemented** | No field or endpoint in current collector. Add only after capability discovery against official device-specific documentation/tests. |
| DC voltage/current, MPPT/string telemetry | **Uncertain/device-dependent; not implemented** | Same restriction. |
| Inverter temperature | **Uncertain/device-dependent; not implemented** | Same restriction. |
| Firmware/model/serial/device ID | **Uncertain/device-dependent; not implemented** | Current UI attempts optional `firmware` attribute, but `EnergyReading` never supplies it. |
| Status/errors | **Only transport/parse status currently implemented** | HTTP/connection/JSON/key failures are handled as collector errors; inverter-native state/error telemetry is not modeled. |
| Cloud-only historical features | **Unavailable without cloud access and intentionally unassumed** | EnergyRadar has no Fronius cloud client, account, token, or consent model. Local-first design should not add a cloud dependency implicitly. |

### Confirmed backfill answer

**Confirmed Fronius historical backfill capabilities for this repository and installation: none.** EnergyRadar can persist future live readings and can use newly observed cumulative counter differences for coarse energy reconciliation. It cannot currently recover a precise power series, daily archive rows, or missed telemetry after being closed.

Before any Phase 3 backfill implementation, a separate capability spike must record target inverter/datamanager model and firmware, cite the exact official local API contract, probe only user-authorized local endpoints, and fixture representative responses. It must establish granularity, retention, timezone, pagination/range limits, counter units, and behavior across firmware/device variants. Until that work succeeds, app-closed periods remain `missing`.

## 7. Trust and quality model

### 7.1 Canonical states

Use a primary provenance state plus independent quality flags. A single enum cannot express “backfilled, partial, and stale source clock” without losing information.

Primary provenance:

- `measured`: value directly observed from a source during an EnergyRadar poll.
- `derived`: value calculated from trustworthy inputs; record method/version and input bounds.
- `backfilled`: value returned later by a confirmed historical source/API or imported trusted archive.
- `missing`: explicit absence for a requested period; not a synthetic numeric sample.

Additional quality flags:

- `stale`: arrival/source age exceeds the metric’s contract.
- `partial`: some fields/sources exist but the required set is incomplete.
- `estimated`: deliberately modeled estimate; never use for exact energy claims and do not introduce until a product requirement exists.
- `invalid`: malformed, non-finite, impossible, or contract-violating input.
- `counter_reset`: cumulative value fell and reset/wrap cannot yet be resolved.
- `source_conflict`: aligned sources/formulas contradict beyond tolerance.
- `clock_untrusted`: source clock is missing, ambiguous, or drifts beyond limit.
- `duplicate`: received event maps to an already-known immutable sample identity.
- `superseded`: retained audit record no longer selected after correction/backfill.
- `locked` and `offline`: source availability states, not numeric substitutions.

Do not store `missing` as a zero-valued raw sample. Represent gaps through absence plus interval/job/source-state metadata. Null means unavailable; zero means a valid observed or derived numeric zero.

### 7.2 Exactness levels

1. **Exact measured power:** finite instantaneous source value with source and receive timestamps.
2. **Derived power:** formula result from fresh, aligned measured inputs, with input references and derivation version.
3. **Integrated energy:** trapezoidal integration over trustworthy adjacent power samples with a bounded gap.
4. **Counter-difference energy:** cumulative end minus start after device/reset validation; exact for the total interval to source precision, but contains no curve shape.
5. **Coarse backfilled total:** source-provided day/hour total with provenance/granularity; may fill an energy aggregate, never raw power points.
6. **Unknown:** no trustworthy representation. Keep the chart visibly gapped and summaries partial/unavailable.

### 7.3 House-power invariant

The canonical sign and formula are immutable schema contracts:

```text
grid_power_w > 0  => grid import
grid_power_w < 0  => grid export
house_power_w = pv_power_w + grid_power_w
```

Derive house power only if both inputs are finite, fresh, from compatible source identities, within the configured alignment window, and not invalid/locked/offline. Persist the exact source-sample IDs, skew, and derivation version. Preserve the current transparent small-negative boundary only as a named derivation rule; values below the tolerance become `source_conflict`, not zero.

### 7.4 Gap/event handling rules

| Situation | Raw storage | Interval/aggregate treatment | User-facing truth |
|---|---|---|---|
| App closed / computer sleeping | No fabricated rows; record next startup/receive gap | Leave power intervals missing unless a confirmed archive later fills them | “Für diesen Zeitraum fehlen Daten.” |
| Fronius unavailable | Store source-state transition; meter may still store grid/counters | PV and house unavailable; grid can remain measured | Partial/offline source warning |
| MT631 unavailable | Store source-state transition; Fronius may still store PV | Grid and house unavailable; PV can remain measured | Partial/offline source warning |
| Network interruption | Same as source unavailable; retain error category without secrets | No interpolation across maximum gap | Visible gap |
| Delayed sample | Store receive time and source time; flag late | Recompute affected closed intervals if within accepted lateness | Backfilled/late distinction |
| Duplicate timestamp | Deduplicate on source identity + source event identity/receive bucket + payload fingerprint | Idempotent no-op unless revision policy explicitly supersedes | No duplicate point |
| Out-of-order sample | Append with ingest sequence; never rewrite sign/value silently | Mark affected aggregates dirty and recompute deterministically | Corrected data with quality retained |
| Clock change/drift | UTC receive time is ordering anchor; preserve raw device local time/offset evidence | Flag `clock_untrusted`; do not align on drifting clock alone | Explain timestamp uncertainty |
| DST forward | Store UTC instants; local day has 23 hours | Group by configured IANA zone boundaries | Visible missing wall-clock hour is not a data gap |
| DST backward | Store UTC instants; local day has 25 hours | Keep both repeated local times distinguished by offset/fold | Show offset or disambiguated tooltip |
| Counter reset/rollover | Keep both observations and source/device identity | Stop delta at boundary; emit reset event; resume from new baseline | Partial total, never negative energy |
| Device replacement | New `device_source` generation/identity | Never delta counters across devices | Clear source-change marker |
| Sign-convention change | Schema constant plus adapter version | Reject/migrate explicitly; never flip stored rows silently | Versioned correction notice |
| Partial/mixed backfill | Store original granularity and provenance | Prefer measured data; fill only uncovered compatible intervals; recompute | Legend differentiates measured/backfilled/missing |

## 8. Proposed database schema

### 8.1 Storage choice

SQLite remains the correct default: it is embedded, transactional, portable, queryable, supported by Python, and already used by EnergyRadar. Enable foreign keys, WAL mode where packaging/backup tests prove it safe, a bounded busy timeout, and explicit transaction boundaries. Prefer normalized tables plus targeted indexes over JSON blobs for canonical numeric history; retain JSON only for versioned optional device payload fragments when their query shape is genuinely unknown.

Alternatives are weaker here:

- JSON/JSONL is easy to inspect but poor for atomic multi-entity migration, range aggregation, deduplication, and concurrent backup.
- Parquet is efficient analytics storage but complicates incremental desktop writes, corrections, and migrations; it may later be an export format.
- An external time-series database adds service/deployment/account burden incompatible with the local-first product.

Use integer epoch microseconds or milliseconds for canonical UTC instants, not locale-formatted text. Use `REAL` for power and energy values with `CHECK(value IS NULL OR value = value)` plus application finite checks; SQLite cannot fully enforce infinity portability. Units belong in schema contracts and export metadata, not repeated in every row.

### 8.2 Entities

#### `device_sources`

Purpose: stable identity and capability generation for each physical/logical source.

| Design | Specification |
|---|---|
| Primary key | `source_id INTEGER PRIMARY KEY` |
| Essential columns | `source_uuid TEXT NOT NULL`, `provider TEXT NOT NULL` (`fronius`, `tasmota_mt631`, `tasmota_mt175`), `display_name`, `device_fingerprint_hash`, `model`, `firmware`, `serial_encrypted_or_null`, `adapter_version`, `sign_convention`, `capabilities_json`, `first_seen_utc`, `last_seen_utc`, `retired_utc` |
| Constraints/indexes | `UNIQUE(source_uuid)`; index `(provider, retired_utc)`; sign check such as `grid_positive_import_v1` |
| Privacy | Prefer a salted local fingerprint over exporting raw serial/meter ID. Raw identifiers require explicit export inclusion. |
| Retention | Permanent while referenced; retire rather than delete. |

#### `raw_samples`

Purpose: append-oriented source observations and the auditable basis for derivation.

| Design | Specification |
|---|---|
| Primary key | `sample_id INTEGER PRIMARY KEY` |
| Essential columns | `source_id`, `observed_at_utc`, `received_at_utc NOT NULL`, `source_time_text`, `source_timezone`, `ingest_sequence`, `pv_power_w`, `house_power_w`, `grid_power_w`, `grid_import_total_kwh`, `grid_export_total_kwh`, `pv_energy_today_kwh`, `pv_energy_year_kwh`, `pv_energy_lifetime_kwh`, `source_available`, `provenance`, `quality_flags`, `payload_fingerprint`, `adapter_version` |
| Timestamp semantics | `observed_at_utc` is source time only when trustworthy; otherwise null. `received_at_utc` is host ingest time and ordering anchor. Preserve raw source time/zone for DST/drift audit. |
| Source fields | One source observation per row. Fronius and MT631 should not be forced into one row. `house_power_w` is normally null on source rows; if stored derived, require derivation linkage below. |
| Constraints/indexes | FK `source_id`; indexes `(source_id, received_at_utc)`, `(source_id, observed_at_utc)`, `(received_at_utc)`; partial indexes for non-null counters if useful. `CHECK(provenance IN ('measured','backfilled'))`. |
| Deduplication | `UNIQUE(source_id, payload_fingerprint, received_at_utc)` is too receive-specific alone. Prefer source-specific deterministic `dedupe_key` with `UNIQUE(source_id, dedupe_key)`; include archive record identity/time/channel for backfill and a bounded receive bucket plus payload hash for live sources. |
| Retention | Default 90 days for 5/10-second raw samples after verified aggregates and backup policy; configurable later. Preserve sparse counter checkpoints/source events longer. |

To make derived raw-resolution house values auditable, add `derived_samples(sample_id, metric, value, unit, formula_version, left_input_sample_id, right_input_sample_id, source_skew_ms, quality_flags)` or keep derivation only in `energy_intervals`. Do not place an unexplained derived value in `raw_samples`.

#### `energy_intervals`

Purpose: canonical minute/hour interval metrics from measured integration, counter differences, or legitimate backfill.

| Design | Specification |
|---|---|
| Primary key | `interval_id INTEGER PRIMARY KEY` |
| Essential columns | `resolution_s`, `period_start_utc`, `period_end_utc`, `timezone`, `pv_energy_kwh`, `house_energy_kwh`, `grid_import_kwh`, `grid_export_kwh`, `self_consumed_pv_kwh`, `pv_avg_w`, `house_avg_w`, `grid_avg_w`, `grid_min_w`, `grid_max_w`, `coverage_pv`, `coverage_house`, `coverage_grid`, `provenance`, `quality_flags`, `method_version`, `input_revision`, `computed_at_utc` |
| Constraints/indexes | `UNIQUE(resolution_s, period_start_utc, method_version)` or a current-revision uniqueness model; index `(resolution_s, period_start_utc)` and dirty/revision index. End > start; coverages in `[0,1]`. |
| Semantics | Energy belongs to half-open `[start,end)`. Signed grid average may cross zero; import/export energies are separate non-negative columns. |
| Retention | Minute intervals at least five years; hour intervals permanent unless user chooses otherwise. |

#### `daily_aggregates`

Purpose: local-day product summaries and fast month/year views.

| Design | Specification |
|---|---|
| Primary key | `(local_date, timezone, method_version)` or surrogate plus equivalent unique key |
| Essential columns | `local_date`, `timezone`, UTC start/end, PV/house/import/export/self-consumed kWh, self-consumption/autarky nullable rates, coverage fields, provenance mix counts, quality flags, source-generation set/hash, revision, computed timestamp |
| Indexes | `(local_date DESC)`, quality/dirty partial index |
| Retention | Permanent |
| DST | UTC boundaries are derived from the IANA timezone for that specific local date; duration is not assumed to be 24 hours. |

Week/month/year views should aggregate daily rows dynamically initially. Add materialized calendar aggregates only after profiling demonstrates a need; if added, use the same half-open boundaries, quality, revision, and timezone contract.

#### `source_state`

Purpose: availability, clock, counter baseline, and capability state without inventing energy samples.

| Design | Specification |
|---|---|
| Primary key | `state_id INTEGER PRIMARY KEY` |
| Essential columns | `source_id`, `state_kind`, `state_value`, `effective_at_utc`, `received_at_utc`, `quality_flags`, `details_json`, `cleared_at_utc` |
| Indexes/constraints | `(source_id, effective_at_utc)`; optional unique active state per `(source_id,state_kind)` |
| Examples | online/offline/locked, clock drift, counter reset, device replacement, API capability discovered |
| Retention | Permanent for reset/replacement/capability; configurable compaction for repetitive connectivity events. |

#### `backfill_runs`

Purpose: resumable, auditable import/archive jobs.

| Design | Specification |
|---|---|
| Primary key | `run_id INTEGER PRIMARY KEY` |
| Essential columns | `source_id`, `requested_start_utc`, `requested_end_utc`, `provider`, `capability_version`, `status`, `cursor`, `started_at_utc`, `completed_at_utc`, `rows_seen`, `rows_inserted`, `rows_deduplicated`, `coverage_before`, `coverage_after`, `error_code`, `error_message_redacted` |
| Constraints/indexes | Index `(source_id,status)` and requested range; unique idempotency key for source/range/capability revision |
| Retention | Permanent compact audit record; no secrets/raw credentials. |

#### `schema_migrations`

Purpose: one authoritative migration ledger.

| Design | Specification |
|---|---|
| Primary key | `version INTEGER PRIMARY KEY` |
| Essential columns | `name`, `checksum`, `started_at_utc`, `applied_at_utc`, `app_version`, `success`, `backup_path_or_id` |
| Rules | Apply strictly ordered migrations in a transaction where SQLite permits; checksum immutable scripts; set `PRAGMA user_version` to the same latest version only after success. |
| Retention | Permanent |

#### `application_metadata`

Purpose: small versioned key/value metadata such as database UUID, install creation time, aggregation method version, last clean shutdown, and last successful maintenance.

Use `key TEXT PRIMARY KEY`, `value_json TEXT NOT NULL`, `updated_at_utc`, `schema_version`; whitelist keys. Do not use it as an untyped substitute for the tables above.

### 8.3 Migration safety

The foundation migration must:

1. open the current DB with a busy timeout and verify `integrity_check`;
2. create a consistent SQLite backup using the backup API, not a raw copy of a potentially active WAL database;
3. discover legacy shape defensively (`production`, `energy_samples_v1`, existing `schema_info` variants);
4. create new tables without destroying v2;
5. migrate rows idempotently with a deterministic legacy source and provenance `measured`/quality `legacy`;
6. validate row counts, finite values, signed grid preservation, and foreign keys;
7. atomically commit migration ledger and `user_version`;
8. leave v2 readable until a later release proves rollback/forward recovery;
9. test interrupted migration and restoration from the pre-migration backup.

## 9. Aggregation architecture

### 9.1 Pipeline

```text
validated source observations
  → deduplicated raw_samples
  → aligned trustworthy metric segments
  → one-minute energy_intervals
  → hour intervals
  → local-day daily_aggregates
  → week/month/year query aggregation
```

Raw ingestion and aggregation must be separate transactions/jobs. A successful raw write is never withheld because an aggregate fails. Each raw/backfill insert marks overlapping interval ranges dirty. The deterministic aggregator recomputes half-open ranges and commits a new/current revision idempotently.

### 9.2 Sample-to-interval conversion

- Order by canonical event time selected per source: trustworthy `observed_at_utc`, otherwise `received_at_utc` with `clock_untrusted`.
- Reject `dt <= 0` pairs from integration; retain them for audit/deduplication.
- Use trapezoidal integration for finite instantaneous power pairs: `E_Wh = (P1 + P2) / 2 × dt_seconds / 3600`.
- Do not bridge a gap larger than `max(3 × expected_poll_seconds, 30 seconds)` for raw 5/10-second collection. Make the threshold method-versioned and cap it explicitly. The current five-minute history gap is too permissive for precise high-frequency history.
- Split segments at minute/hour/day boundaries so energy is assigned proportionally to exact UTC duration.
- A source failure, invalid value, device-generation boundary, counter reset, or sign-contract change terminates the segment.
- House segments require aligned PV and grid samples under the same live alignment policy. No fake interpolation between independently stale streams.

### 9.3 Counter differences

For a cumulative counter pair from the same device generation:

- finite `end >= start`: delta is candidate energy for the full boundary interval;
- `end < start`: emit `counter_reset` and produce no cross-boundary delta until reset/rollover is resolved;
- implausibly large delta relative to elapsed time/device rating: `invalid` or `source_conflict`;
- a new source/device generation always resets the baseline;
- daily counters reset at the configured local day boundary and must not be treated as lifetime monotonic counters.

Counter energy can reconcile or fill a coarse interval only at its real granularity. It must not generate minute-level power points. Where integrated power and a counter both exist, preserve both method results and flag material conflict rather than silently choosing one.

### 9.4 Metrics and formulas

For compatible covered boundaries:

```text
pv_energy_kwh          = integrate(max(pv_power_w, 0)) / 1000
house_energy_kwh       = integrate(house_power_w) / 1000
grid_import_kwh        = integrate(max(grid_power_w, 0)) / 1000
grid_export_kwh        = integrate(max(-grid_power_w, 0)) / 1000
self_consumed_pv_kwh   = pv_energy_kwh - grid_export_kwh       # no battery only
self_consumption_rate  = self_consumed_pv_kwh / pv_energy_kwh
autarky_rate           = self_consumed_pv_kwh / house_energy_kwh
```

Clamp only insignificant floating-point epsilon after recording the raw calculation; a materially negative self-consumed/house result is `source_conflict`. Rates are null when a required input is missing, coverage is below the product threshold, the battery topology is unsupported, or the denominator is zero. Never show an unavailable rate as 0%.

### 9.5 Calendar, partial periods, and recomputation

- Canonical storage and ordering use UTC. User periods use an IANA timezone saved with the result/query.
- “Today,” month, and year use local half-open calendar boundaries. DST days are 23/25 hours naturally.
- Week begins Monday for the German locale unless localization settings later specify otherwise.
- An in-progress interval is marked `partial` and may update; closed intervals are immutable per revision but replaceable by deterministic new revisions.
- Coverage is actual trustworthy seconds divided by actual period seconds per metric—not sample-count percentage.
- Late/backfilled rows mark all dependent minute/hour/day ranges dirty. Recompute from the lowest affected resolution upward in one job with method/version inputs.
- Queries select the latest successful revision and retain provenance-mix and quality metadata.

## 10. Gap and backfill strategy

Closed-app recovery has two independent questions:

1. Can a source later provide exact historical values/totals for the gap?
2. At what granularity and with what identity/timezone guarantees?

Today, the answer is unconfirmed for Fronius and absent for the Tasmota `Status 10` adapter. Therefore all app-closed power periods are missing. MT631 import/export total checkpoints after reopening may quantify net imported/exported energy accumulated over the gap, subject to same-device/reset validation. They cannot reveal when power flowed. Fronius day/year/lifetime counter changes have the same limitation.

Future legitimate backfill follows these merge rules:

- measured live raw rows outrank backfilled rows at equal trustworthy granularity;
- backfill fills only uncovered intervals unless an explicit correction version supersedes invalid data;
- a day total can improve the day’s energy summary while its intraday chart remains visibly gapped;
- mixed periods carry provenance proportions/counts and a partial-data warning;
- archive responses retain provider record IDs, requested range, ingest time, API/capability version, and source identity;
- every run is resumable/idempotent and never deletes prior evidence silently.

## 11. History UX

The future History experience should replace the “in development” portion of [`MemoryView.tsx`](../frontend/react-ui/src/views/MemoryView.tsx) without turning EnergyRadar into a generic analytics dashboard. Keep the visual language quiet: one primary timeline, restrained color, honest whitespace/gaps, short explanatory copy, and disclosure on demand.

### 11.1 Ranges and main chart

Required selectors: Today, 7 days, 30 days, Month, Year, Custom. Use resolution appropriate to range:

- Today: minute intervals, with live/in-progress tail visibly distinct.
- 7/30 days: hourly line/area or daily energy bars depending on zoom.
- Month/Year: daily/monthly energy bars; no millions of raw points sent to React.
- Custom: server-side resolution selection with a documented maximum point count.

The main power series are Solar, Consumption, and signed Grid Flow. The zero axis is prominent but calm; import is above zero and export below zero. Do not invert the existing sign contract for chart convenience. Daily/monthly energy views should also show separate non-negative import and export bars because signed averages can cancel important bidirectional flow.

### 11.2 Interaction and truth cues

- Hover/focus tooltip: local timestamp with offset when ambiguous, value/unit, measured/derived/backfilled label, source, and quality/coverage note.
- Zoom: wheel/pinch or range brush for Today/7/30-day views; keyboard-accessible controls and reset.
- Pan: useful only after zoom; constrain to loaded/requested range and avoid hidden data fetch surprises.
- Gaps: broken lines/empty bars, never linearly connected beyond the allowed gap.
- Backfill: dashed/hatched or lower-emphasis segment plus legend; do not rely on color alone.
- Partial period: “Bisher” label and open right edge; summaries explicitly say “bis jetzt.”
- Partial data: concise banner naming the affected source/period and which totals remain trustworthy.
- Empty state: distinguish no configured source, no recordings yet, app-closed gap, and selected range before installation.
- Source offline: keep historical data visible while marking live tail unavailable.
- DST: tooltip shows `02:30 CEST`/`02:30 CET` or UTC offset for repeated time. Forward jump is not labeled an outage.
- Export: action preserves selected range/resolution and exposes raw vs aggregated choice.

## 12. Fronius detail UX

Fronius should be a source detail inside EnergyRadar, not a promise to replicate every vendor screen. Capability discovery controls field visibility; unavailable optional fields are omitted or explained, never shown as zero.

| Section | Fields | Availability classification |
|---|---|---|
| Overview | Current PV power, today energy, lifetime energy, source freshness/connection | Power/today/lifetime are currently supported by collector; only power/today persist today. Device-native state is future optional/device-dependent. |
| AC | Voltage, current, frequency, phases, real power | Future optional, API/device-dependent; none currently supported. |
| DC | MPPT/string values, DC voltage/current | Future optional, API/device-dependent; none currently supported. UI must handle different MPPT/string counts. |
| Technical | Temperature, firmware, model, serial/device ID, status/errors | Future optional/device-dependent. Serial is privacy-sensitive and masked by default. Current support is transport/parse status only. |
| History | Production curves and daily/monthly/yearly production with quality | Current local measured Today samples are supported. Device archive backfill is unconfirmed. Longer local history follows new persistence phases. |

Every value carries source, age, and quality. A field capability registry should distinguish `supported`, `unsupported`, `temporarily_unavailable`, and `not_probed`; these are different states. Normal inspection should cover current production, counters, connection, and confirmed telemetry, while advanced vendor configuration remains in the Fronius UI.

## 13. Export and backup

### 13.1 Raw CSV

Canonical columns:

```text
timestamp,receive_timestamp,pv_power_w,house_power_w,grid_power_w,
grid_import_total_kwh,grid_export_total_kwh,source,quality
```

Add metadata comments only if consumers can handle them; otherwise provide a sidecar manifest with export schema version, app version, timezone, sign convention, selected range, generation time, and column definitions. One row must have unambiguous provenance—combined rows require source-set representation or separate source rows plus derived-row identifiers.

### 13.2 Aggregated CSV

Canonical columns:

```text
period_start,period_end,pv_energy_kwh,house_energy_kwh,grid_import_kwh,
grid_export_kwh,self_consumption_rate,autarky_rate,quality
```

Also include coverage fields and provenance/method version in the first schema revision, even if the minimum target is retained. Rates should use a documented unit (`0..1` recommended for machine export, with labels; not locale-formatted percent strings).

### 13.3 JSON

Use a top-level envelope: `export_schema_version`, `app_version`, `generated_at`, `timezone`, `sign_convention`, `period`, `resolution`, `sources`, `quality_summary`, and `records`. JSON numbers are locale-independent; missing values are `null`; disallow NaN/infinity. Stream large arrays rather than constructing the full export in memory.

### 13.4 Common export rules

- UTF-8; CSV may retain BOM for Excel compatibility as current [`csv_exporter.py`](../energyradar/services/exporters/csv_exporter.py) does.
- ISO 8601/RFC 3339 timestamps with `Z` or explicit offset; include IANA timezone in metadata.
- Decimal point is `.` and no thousands separators regardless of UI locale.
- Empty CSV field / JSON `null` means missing, never zero.
- Include quality, provenance, coverage, method/schema versions, and source identity pseudonyms.
- Stream/chunk range queries and write atomically; expose progress/cancel for large exports.
- Safe default filename: `EnergyRadar-history-YYYYMMDD-YYYYMMDD-raw-v1.csv`; sanitize user text and never include display name/address/serial.
- Warn that exports contain sensitive occupancy and energy behavior; never upload automatically.

The present report stack already protects CSV formula injection and writes atomically in [`csv_exporter.py`](../energyradar/services/exporters/csv_exporter.py) and [`exporters/utils.py`](../energyradar/services/exporters/utils.py). Preserve those controls.

### 13.5 Database backup and restore

Build on [`exporters/backup_service.create_backup_zip`](../energyradar/services/exporters/backup_service.py): SQLite online backup, integrity check, per-file SHA-256, manifest, and atomic destination replacement are sound foundations. Correct schema version sourcing and decide explicitly whether `data-source.json` is included; weather cache, logs, window geometry, and browser cache should remain excluded by default.

Restore must be a separate guarded workflow:

1. never extract untrusted member paths directly; whitelist filenames and reject traversal/symlinks;
2. validate ZIP/member size limits, manifest version, hashes, SQLite header, `integrity_check`, foreign keys, migration compatibility, and required tables;
3. close/quiesce writers and create a recovery backup of the current DB/settings;
4. restore into a temporary user-data directory, migrate/validate there, then atomically swap files;
5. reopen and run smoke queries before deleting nothing—the recovery backup remains user-recoverable;
6. report app/schema version incompatibility without partial replacement.

## 14. Retention and storage sizing

### 14.1 Recommended defaults

- 5/10-second raw source samples: 90 days by default after verified minute aggregation; preserve sparse counter/device-state checkpoints permanently.
- Minute intervals: five years initially; reconsider based on real database profiling and user preference.
- Hour intervals and daily aggregates: permanent.
- Month/year results: compute from daily aggregates; cache/materialize only if profiling needs it.
- Backfill/job/migration/source-change audit: permanent, compact.
- User-configurable retention: later, with preview of effect and never deleting the only representation before verified aggregation/backup.

Run maintenance only when idle/on AC if detectable: WAL checkpoint, delete expired raw rows in bounded batches, incremental vacuum where configured, `ANALYZE` after material change, and periodic integrity/foreign-key checks. Avoid full blocking `VACUUM` during normal startup. Surface database size and last successful backup without fear-based copy.

### 14.2 Size estimates

Assumption: one normalized raw source observation plus index overhead averages **250 bytes** after SQLite page/index overhead. Real values could plausibly be 200–350 bytes depending on schema, indexes, null density, WAL, and page utilization. These estimates count one row per cadence, not two separate device-source rows; storing Fronius and MT631 separately can approach twice the raw-row total before compression/normalization.

| Cadence | Rows/day | Rows/year | Central size/year (250 B) | Plausible range/year (200–350 B) | Central size/5 years |
|---|---:|---:|---:|---:|---:|
| 5 seconds | 17,280 | 6,307,200 | 1.47 GiB | 1.17–2.06 GiB | 7.34 GiB |
| 10 seconds | 8,640 | 3,153,600 | 0.73 GiB | 0.59–1.03 GiB | 3.67 GiB |

If each cadence stores two source rows, central raw sizes are about 2.94 GiB/year at 5 seconds and 1.47 GiB/year at 10 seconds. By contrast, one minute interval per year is 525,600 rows; at 250 bytes that is about 125 MiB/year, while 8,760 hourly rows and 365 daily rows are small. Measure with generated five-year fixtures and SQLite `page_count × page_size`; do not promise these estimates as exact.

## 15. Personalized greeting

### 15.1 Product behavior

The home greeting is two quiet lines at most:

1. a time/return greeting, optionally with the locally configured display name;
2. a current-state or returning-data summary only when its evidence contract passes.

Never ship a hardcoded personal name. Copy examples use `{name}` only as a placeholder. Avoid savings, percentages, comparisons, and trends unless a future feature has complete, fresh, explicitly defined evidence.

Time bands in local configured/system time:

- 05:00–11:59: `Guten Morgen{, name}.`
- 12:00–17:59: `Guten Tag{, name}.`
- 18:00–04:59: `Guten Abend{, name}.`
- First app start may use `Willkommen bei EnergyRadar.`; no unsupported historical statement.
- If personalization is disabled, use the same greeting without a name or a calm `Willkommen zurück.`

### 15.2 State matrix

State priority is safety-first: unavailable/partial overrides energy claims; returning-history copy is used only when its persisted evidence is stronger and no live statement is required.

| Name / greeting | Evidence state | Second line |
|---|---|---|
| Enabled + valid name | Fresh aligned PV and grid; signed grid < negative balance threshold; house valid | `Deine Anlage erzeugt gerade mehr Energie, als dein Haus verbraucht.` |
| Any name state | Fresh aligned inputs; grid > import threshold; house valid | `Dein Haus bezieht gerade Energie aus dem Netz.` |
| Any name state | Fresh aligned inputs; absolute grid within named balance threshold | `Erzeugung und Netzfluss sind gerade nahezu ausgeglichen.` |
| Any name state | One required source absent/stale/offline, another usable | `Ein Teil deiner Energiedaten ist derzeit nicht verfügbar.` |
| Any name state | No trustworthy live data | `Aktuelle Energiedaten sind derzeit nicht verfügbar.` |
| Returning user | Persisted previous visit exists **and** query proves new trustworthy samples/aggregates since that instant | `Seit deinem letzten Besuch wurden neue Energiedaten gespeichert.` |
| Returning user | Absence known but no proven new data | Use live state if trustworthy; otherwise neutral unavailable copy. Never claim new data. |
| First start | No prior visit marker | `Richte deine lokalen Energiequellen ein, wenn du bereit bist.` or omit line after setup is complete. |
| Greeting disabled | Any | Hide the greeting module or show a neutral non-personal status heading; energy trust rules still apply. |
| Name missing | Any | Omit comma/name: `Guten Morgen.` Never insert account/device/OS username. |

“PV surplus” must be derived from fresh aligned signed-grid/house state, not PV alone. “New data” requires a stored `last_home_visit_at_utc` and a database query for later trustworthy records; elapsed time alone is insufficient. Do not claim trends or “more than yesterday” in this phase.

### 15.3 Settings and persistence model

Add to the existing local [`ui-settings.json`](../energyradar/ui/settings.py):

```json
{
  "greeting_enabled": true,
  "display_name": null
}
```

Migration-safe defaults are resolved at runtime and not written until the user chooses, matching current settings philosophy. `display_name` is optional, Unicode, trimmed, maximum 64 grapheme clusters (and a defensive byte limit), with control/bidi-control characters rejected or normalized according to a documented rule. Never use it in filenames, logs, telemetry, source IDs, or HTML. React text rendering escapes strings by default; do not use `dangerouslySetInnerHTML`. The setting is local-only with no account/cloud dependency and should be included in local backups only under the same settings privacy notice.

Settings UI: text field, on/off toggle, immediate deterministic preview using current local time and a clearly labeled sample/actual trustworthy state. Preview must not save on every keystroke unless debounced/explicitly confirmed; persisted backend validation is authoritative. Announce preview changes accessibly, associate label/help/error, preserve keyboard order, and do not rely on color for availability.

Returning-user metadata belongs in `application_metadata` (`last_home_visit_at_utc`, updated only after the home view is actually presented). Avoid counting app launches as visits. Localization should use message keys and grammatical templates, not string concatenation; tests cover missing names, Unicode, punctuation, all time boundaries, disabled state, and German copy.

## 16. Migration roadmap

### Phase 0 — schema and persistence foundation

- Scope: canonical schema contract, source identity, migration ledger, DB connection policy, pre-migration backup/recovery tests, repository interfaces, finite-value/sign constraints.
- Dependencies: decide authoritative desktop path; define device fingerprint privacy and schema version source.
- Risks: existing DB shape variations, migration interruption, version mismatch, accidental sign/null conversion.
- Tests: fresh DB, v1/v2 fixtures, alternate `schema_info` shapes, idempotency, interrupted migration, backup restore rehearsal, counts/hashes/integrity/foreign keys.
- Migration concern: additive only; retain `energy_samples_v1` and current reads.
- User-visible outcome: none except safer foundation.
- Out of scope: charts, backfill, greeting, retention deletion.
- Split: yes—0A schema/connection/migration tests; 0B source repository and read compatibility.

### Phase 1 — raw persistence, restart survival, basic daily history

- Scope: validated per-source raw writes, source/receive timestamps, device generation, derived alignment linkage, dual-read/compare, Today query from new store.
- Dependencies: Phase 0; canonical finite/null semantics for Fronius.
- Risks: write amplification, duplicate polls, bridge latency, historical mismatch.
- Tests: restart, clean shutdown/crash, signed/zero/null, source skew, dedupe/out-of-order, bridge performance.
- Migration concern: backfill v2 rows as `legacy` without inventing source timestamps.
- User-visible outcome: current Today history reliably survives restart with explicit gaps.
- Out of scope: multi-year UI and device archive.
- Split: raw writer first, then Today reader behind comparison/feature gate.

### Phase 2 — aggregation, quality/gaps, exports

- Scope: deterministic minute/hour/day aggregation, coverage/provenance, reset detection, dirty-range recomputation, raw/aggregate exports, retention instrumentation.
- Dependencies: stable Phase 1 data and fake-clock framework.
- Risks: DST boundaries, counter conflicts, performance, percentage trust.
- Tests: formula fixtures, gaps, resets/rollover, DST, late data, idempotency, export golden files, large datasets.
- Migration concern: version method outputs; recomputable tables can be rebuilt.
- User-visible outcome: trustworthy period totals and visibly partial data.
- Out of scope: unconfirmed Fronius backfill and polished long-range charts.
- Split: aggregation core, export formats, then retention maintenance.

### Phase 3 — Fronius details and legitimate backfill

- Scope: device-specific capability spike, confirmed telemetry adapter(s), detail sections, resumable archive import only where officially/device-confirmed.
- Dependencies: source identity, backfill jobs, provenance-aware merge.
- Risks: firmware/model variance, local API load/range limits, raw identifiers, timezone/granularity mismatch.
- Tests: capability fixtures, unsupported endpoints, pagination/range limits, partial/retry/idempotent imports, measured precedence.
- Migration concern: capabilities/versioned optional fields; do not widen core schema for every vendor field prematurely.
- User-visible outcome: normal Fronius inspection and honest backfilled regions where available.
- Out of scope: cloud account dependency unless separately approved.
- Split: capability research PR, detail live telemetry PR, archive PR.

### Phase 4 — advanced historical analytics

- Scope: Today/7/30/Month/Year/Custom UI, resolution API, zoom/hover/gaps/quality legend, daily import/export bars.
- Dependencies: Phase 2 aggregates and Phase 3 provenance where applicable.
- Risks: point volume, misleading visual continuity, accessibility/DST display.
- Tests: range boundaries, visual/component states, keyboard interaction, point limits, mixed quality, timezone formatting.
- Migration concern: none beyond query/index tuning.
- User-visible outcome: calm, trustworthy personal energy history.
- Out of scope: predictive savings claims or generic KPI gamification.
- Split: range/query contract, Today/short-range UI, long-range/custom UI.

### Phase 5 — greeting and backup/restore polish

- Scope: local display name/toggle/preview, evidence-gated state summary, returning-user metadata, hardened restore UI, retention controls later.
- Dependencies: trustworthy live state and historical-query evidence; tested application metadata; restore foundation.
- Risks: privacy, overclaiming “new data,” unsafe ZIP/DB restore, localization grammar.
- Tests: full greeting matrix/accessibility/localization, corrupt settings, restore attacks/version mismatches/rollback.
- Migration concern: runtime-default settings are additive; metadata key versioned.
- User-visible outcome: personal but restrained home state and recoverable local memory.
- Out of scope: account/cloud personalization or behavioral profiling.
- Split: greeting settings/copy, returning evidence, restore workflow.

## 17. Test strategy

Use fake clocks, temporary SQLite files, deterministic source fixtures, explicit timezones, and property/golden tests. Never use sleep to prove freshness or ordering.

| Area | Required cases and assertions |
|---|---|
| Persistence/restart | Process/repository reopen returns identical signed/null/zero samples; Today chart rebuilds; settings/source identities persist. |
| Shutdown/crash | Clean shutdown metadata; committed transaction survives; interrupted transaction/migration does not; WAL recovery and backup remain valid. |
| Dedup/order | Repeated live payload, same timestamp/different source, archive duplicate, out-of-order correction, concurrent ingest; idempotent counts/aggregates. |
| Numeric trust | NaN/infinity/bool/malformed/missing rejected; valid zero retained; negative grid retained; no unavailable→zero conversion. |
| Source freshness | Stale Fronius, stale MT631, one offline, both offline, delayed receive, device clock drift; house requires aligned fresh inputs. |
| House formula | Import/export examples, exact zero, -50 W boundary and below-boundary conflict, no battery assumption violation, input IDs recorded. |
| Counters | Normal delta, reset, rollover if documented, midnight daily reset, implausible jump, device replacement, source generation change. |
| Time | DST spring 23-hour day, autumn repeated hour/fold, timezone change, UTC ordering, local month/year boundaries, leap day/year. |
| Aggregation | Minute/hour/day/week/month/year boundaries, trapezoid split, max gap, partial first/last interval, coverage seconds, zero denominators, formula conflict. |
| Backfill | Unsupported capability, partial response, retry/resume, duplicate run, mixed measured/backfilled, measured precedence, coarse total without curve, dirty-range reaggregation. |
| Migration | Fresh/v1/v2/variant schema fixtures, backup before mutation, checksums, idempotent rerun, disk-full/interruption, invalid DB, forward-incompatible DB. |
| Corruption | Settings quarantine, database integrity failure, corrupt WAL/backup/manifest/hash, safe user error, original data retained. |
| Export | Exact headers/order/units/sign, UTC offsets/timezone metadata, UTF-8/CSV injection, null vs zero, schema version, large streamed export, filename sanitization. |
| Backup/restore | Online write consistency, whitelist/traversal/zip-bomb limits, version compatibility, rollback backup, atomic swap, restart smoke query. |
| Greeting | Time boundaries, name absent/Unicode/max/control chars, disabled, first start, returning with/without proven rows, surplus/import/balanced/partial/unavailable, stale/misaligned suppression. |
| Localization/accessibility | German copy keys, punctuation, screen reader labels/live regions, keyboard zoom/preview/toggle, non-color quality legend, reduced motion. |
| Performance | Generated 1/5-year databases, ingest p95, aggregation/reaggregation, Today/Year query latency, memory-bound exports, maintenance duration; assert bounded point count. |

Existing tests in [`tests/test_storage.py`](../tests/test_storage.py) cover bucket merge/null-overwrite, and [`tests/test_history.py`](../tests/test_history.py) covers basic formulas/integration. They are valuable but not sufficient for migration, quality enforcement, reset/DST, restart, or long-term behavior. Frontend tests currently cover Now/Today unavailable states but not the future historical/greeting matrix.

## 18. Risks and open questions

1. What exact Fronius inverter/datamanager model and firmware are installed, and what official local API document applies?
2. Does the target expose a local archive endpoint, and if so what granularity, retention, timezone, range limit, and channels are actually available? This must be measured/documented before promising backfill.
3. Should EnergyRadar store two raw rows per poll (best provenance) or source-specific compact tables/views (potential space savings)? Benchmark before fixing retention.
4. What maximum alignment skew should history use: the live `3 × refresh` threshold, a tighter fixed threshold, or source-specific windows? Make it explicit and versioned.
5. Is Fronius `P_PV: null` guaranteed to mean nighttime zero for the target generation, or can it mean unavailable? The present `or 0` behavior needs device-contract evidence before migration.
6. How should existing v2 combined rows map to source identity when no IDs/device timestamps were stored? Recommended: synthetic `legacy_fronius`/`legacy_meter` provenance with reduced quality, never guessed hardware identifiers.
7. Should precise device IDs be stored encrypted, hashed, or not at all? Device replacement detection needs a stable local fingerprint, while exports should pseudonymize by default.
8. What is the product’s battery stance? Current house/self-consumption formulas assume no battery. Battery detection/support must precede use on battery systems.
9. Should `data-source.json` be consolidated into `ui-settings.json` or included separately in backups? Avoid duplicated ownership and clearly disclose private addresses.
10. What minimum coverage permits each summary? Current 50%/90% thresholds are not yet a documented product contract and sample history ignores quality flags.
11. Do current users have variant/experimental SQLite schemas? Migration discovery must inspect actual table definitions rather than assume one `schema_info` shape.
12. Should display name be included in backups by default? It is local personal data; the backup UI should say so.

## 19. Recommended first implementation PR

**PR: `feat(history): add versioned local history schema foundation`**

Keep the first implementation PR deliberately non-visual and additive:

- introduce one authoritative SQLite connection/migration module;
- add `schema_migrations`, `application_metadata`, `device_sources`, and `raw_samples` with UTC/source/receive/provenance/quality contracts;
- align `PRAGMA user_version` and the backup manifest;
- create a consistent pre-migration SQLite backup and recovery validation path;
- migrate current `energy_samples_v1` rows into legacy-source raw records idempotently, preserving signed grid and null/zero exactly;
- add extensive fresh/v1/v2/variant/interrupted migration tests;
- keep bridge writes and all UI reads on the current schema in this PR, or dual-write only in a separately reviewable follow-up behind equivalence tests.

Out of scope for the first PR: retention deletion, aggregate calculations, charts, exports changes, Fronius archive probing, greeting, restore UI, and any macOS packaging work. This creates a small trust boundary that can be reviewed and rolled back before user-visible historical behavior depends on it.

---

This audit intentionally makes no implementation change and no claim of physically tested Fronius archive support. Product copy and future calculations must continue to prefer an honest gap or unavailable value over fabricated precision.
