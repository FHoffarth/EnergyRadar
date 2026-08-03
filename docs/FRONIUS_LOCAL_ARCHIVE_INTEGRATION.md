# Fronius Local Archive Integration

Status: **local archive endpoint proven on the owner's real device; read-only,
provenance-separated ingestion foundation implemented and tested (fixtures + real
device). UI/period-contract display integration is the next staged phase.**

Truth layer: **Historical Provider Truth** (`fronius_local_archive`) — see
`DATA_TRUTH_ARCHITECTURE.md §1`. Kept strictly separate from recorder samples,
counter anchors, stored sample counters, Fronius realtime, and Solar.web.

No private IPs, credentials, unique device IDs, or full payloads appear here.

---

## 1. Confirmed local endpoints (real device, Solar API v1, CompatibilityRange 1.8-1)

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /solar_api/GetAPIVersion.cgi` | API version + base path | none |
| `GET /solar_api/v1/GetLoggerInfo.cgi` | timezone, UTC offset, logger identity | none |
| `GET /solar_api/v1/GetInverterInfo.cgi` | device ids (`inverter/1`) | none |
| `GET /solar_api/v1/GetInverterRealtimeData.cgi?...CommonInverterData` | `DAY_ENERGY`/`YEAR_ENERGY`/`TOTAL_ENERGY` (= E_Day/E_Year/E_Total) | none |
| **`GET /solar_api/v1/GetArchiveData.cgi`** | **historical archive** | none |

Archive query (proven):
```
/solar_api/v1/GetArchiveData.cgi?Scope=System&StartDate=YYYY-MM-DD&EndDate=YYYY-MM-DD&Channel=<ch>&Channel=<ch>
```
Response: `Body.Data["inverter/1"]` with `Start`/`End` (offset-aware, local) and
`Data[<channel>].Values` mapping **integer second-offset from `Start`** → value.
`Head.Status.Code == 0` on success; `255` "Query interval is restricted to 16 days".

## 2. Channel inventory (this device)

| Channel | Unit | Classification | Use |
|---------|------|---------------|-----|
| `EnergyReal_WAC_Sum_Produced` | Wh | **interval total** | factual PV energy history (curve + sums) |
| `PowerReal_PAC_Sum` | W | interval average | PV power curve shape |
| `Current_DC_String_1` | A | interval average | diagnostics |
| `Voltage_DC_String_1` | V | interval average | diagnostics |
| `Temperature_Powerstage` | °C | interval average | diagnostics |
| `TimeSpanInSec` | sec | interval length | sets `interval_seconds` per point |

**Not present in this inverter's archive:** grid import/export and house/load.
Grid history therefore remains **smart-meter / Counter Truth** — the Fronius
archive supplies **PV production only**. This boundary is intentional and must
not be blurred.

`EnergyReal_WAC_Sum_Produced` is an interval total, not power integration: its
per-day sum equals the realtime `E_Day` (observed: archive sum **12791 Wh** =
`DAY_ENERGY` **12791 Wh**). It is therefore admissible as factual energy history.

## 3. Timezone / timestamp semantics

- `Start`/`End` carry the device-local UTC offset and are **DST-correct**:
  observed `+02:00` in August, `+01:00` in February.
- A point's UTC instant = `Start` + `key` seconds, converted to UTC.
- `GetLoggerInfo` reports `TimezoneName=CEST`, `TimezoneLocation=Berlin`,
  `UTCOffset=7200`.
- Nominal sample interval ≈ 5 minutes (≈170–204 points/day depending on daylight).

## 4. Retention & limits (probed)

- **Retention ≈ 12 months**: data present today, yesterday, ~2 months, ~6 months;
  **empty at ~13 and ~25 months**.
- **Max query window = 16 days** per request → chunking required.
- No pagination beyond the window limit; a 7-day request returned ~1336 points
  in one response.
- Offline/unreachable → connection error (retryable). Out-of-retention → success
  code with empty `Data`.

## 5. Source & persistence model (migration 6)

Three provenance-separated tables — history never enters `energy_samples_v1` or
the counter tables:

- `provider_archive_sources` — `(provider, device_key)` identity, timezone,
  `base_fingerprint` (hash, not the raw address), device identity hash.
- `provider_archive_imports` — one import batch: requested window, status,
  points/chunk counts, `idempotency_key`.
- `provider_archive_points` — normalized point: `channel`, `observed_at_utc`
  (UTC 'Z'), `interval_seconds`, `value_decimal`, `unit`, `measurement_kind`
  (`interval_total`/`interval_average`/…), `provenance='fronius_local_archive'`,
  `dedupe_key` UNIQUE, plus `UNIQUE(source_id, channel, observed_at_utc)`.

## 6. Ingestion & backfill (`services/archive_ingest.py`, `collectors/fronius_archive.py`)

Properties: read-only against Fronius; chunked ≤16-day windows; timeout;
retry with exponential backoff; duplicate-proof (`INSERT OR IGNORE` + unique
constraints); crash-safe (one transaction per chunk → resumable); no deletion;
no overwrite of recorder truth; bounded memory; deterministic chunk tiling.

Import states: `complete`, `partial`, `source_unavailable`, `source_unsupported`,
`outside_retention`/`no_archive_data`, `import_failed`, `conflict`. A completed
import for an identical window is short-circuited.

Backfill policy: from the EnergyRadar recording baseline forward; older history
only on explicit request and only within retention; missing intervals stay
missing (never interpolated); incremental catch-up fetches only absent windows.

## 7. Reconciliation with local data (implemented — `services/period_archive.py`)

Curve precedence (metadata-preserving, no silent splicing):
1. EnergyRadar local samples where healthy,
2. `fronius_local_archive` for intervals the local recorder is missing,
3. cloud only if later proven,
4. unknown.

`build_period_curve` merges local + archive into one **source-tagged** curve:
local wins on overlap (points within 150 s are deduped), source segments are
retained, `mixed_source` is flagged, and genuine gaps are never interpolated.
Energy **totals** stay counter-derived; PV falls back to archive interval energy
only when the counter paths supply nothing (`build_period_report`, precedence
anchors → stored sample counters → `fronius_local_archive`). Grid/house are never
archive-filled. Real-device: today's mixed curve = 210 local + 139 archive points;
yesterday PV total 13.941 kWh = the archive daily sum exactly.

## 6a. Ingestion trigger policy (`runtime.refresh_archive` → `archive_ingest.catch_up`)

Registered as a scheduler task (`ARCHIVE_SECONDS = 10 min`), so it never blocks
live polling and inherits backoff:
- **startup + every 10 min**: import the recent 7-day window (idempotent — already
  complete days are skipped) and **force-refresh the current day** so new intervals
  arrive after downtime.
- No repeated full-history download; no duplicate imports (dedupe + completed-window
  short-circuit); failures are swallowed and never disturb recording. Historical
  range requests beyond the window are on-demand only (future).

## 7b. Curve downsampling & request control (reliability)

Range switching previously froze: a 7-day curve returned **8860 points / 769 KB**
and the local↔archive overlap check was **O(n·m)** (~3 s). Fixed:
- **O(n log n) merge**: archive/local overlap uses binary search over sorted local
  timestamps (`period_archive.build_period_curve`), dropping build time to <500 ms.
- **Display downsampling** (`downsample_curve`, totals untouched): bounded rendered
  points per span — Heute/Gestern ≤600, ≤7 d ≤1000, ≤31 d ≤1200, year ≤730. A
  deterministic bucket min/max keep that always preserves first/last, both sides of
  every **source change** and **gap**, and per-bucket **extrema**. Every kept point
  is a real, unmodified input point — no interpolation, no invented points. Raw
  counts (`n_points`) and all energy totals are unchanged (totals come from raw
  counters/archive sums, never the curve).
- **Latest-request-wins / dedup**: the desktop provider binds the `periodReady`/
  `periodFailed` signals **once** and dispatches by operation id (no per-request
  handler leak); identical in-flight requests share one promise; MemoryView uses a
  monotonic request id so a stale/out-of-order response can never overwrite the
  active range, keeps the previous result visible while loading, and always clears
  loading (15 s bounded timeout → harmless `unavailable`). Archive catch-up runs on
  its own 10-min scheduler task and is **not** re-triggered per range click; range
  selection reads already-ingested SQLite data.

## 8. Privacy / security

Committed material is sanitized: no IPs (device shown as `<fronius-ip>`), no
credentials, no `UniqueID`/`PlatformID`, no full payloads. The stored source row
keeps only a hash fingerprint of the base address. Access is read-only GET to a
local, private-address device (the existing collector's SSRF posture applies).

## 9. Known limitations / unsupported

- PV-only archive on this inverter; no grid/house history from Fronius.
- Retention ~12 months; older ranges return empty.
- 16-day request window.
- Solar.web/cloud not used or implemented.
- Display integration **implemented**: the period contract (`build_period_report`)
  now carries a source-tagged curve + archive PV total; Memory renders it with
  precise provenance copy ("Verlauf aus dem Fronius-Datalogger" / mixed-source /
  "Solarertrag vom Fronius-Datalogger bestätigt"); Reports share the same PV
  precedence. Today consumes the same contract totals. A dedicated archive-fill of
  the *live Today curve widget* (beyond the period contract) remains future polish.
- Multi-inverter / battery / meter-on-Fronius archives untested (single-inverter
  device only).
