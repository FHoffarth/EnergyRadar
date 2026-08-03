# Fronius / Solar.web Data-Source Audit

Status: **audit complete for code + live owner database; live-device and Solar.web
probing NOT performed (no access from this environment).**
Branch: `feature/fronius-history-memory-integrity`.
Governing principle: **Unknown is not zero — but known is also not unknown.**

This document records where energy data actually exists, why EnergyRadar does not
surface most of it, and the corrected source hierarchy. It contains no credentials,
private IPs, or raw private payloads.

---

## 0. Evidence base

- **Code**: `energyradar/collectors/fronius.py`, `services/periods.py`,
  `services/history.py`, `services/recorder.py`, `services/runtime.py`,
  `ui/viewmodels.py`, and the React `frontend/react-ui/src`.
- **Live owner database**: `energyradar/database/energy.db`, inspected **read-only**
  (`mode=ro`). `PRAGMA user_version = 5`.
- **Not available in this environment**: the physical Fronius inverter (local API),
  the Tasmota/MT175 smart meter, and any Solar.web account. Sections 2 and 3 are
  therefore documented from code and marked **not device-verified**.

---

## 1. Root cause (proven)

EnergyRadar shows contradictory "no data" states **not because data is missing**,
but because the surfaces that claim emptiness read tables/paths that are empty,
while the real measurements live in other tables/paths.

Two independent, additive root causes plus three data-integrity defects:

| # | Root cause | Evidence |
|---|-----------|----------|
| R1 | **Authoritative period path is anchor-only and the anchor tables are empty.** `periods.calculate_period` reads only `counter_anchors` + `counter_readings`; with `< 2` anchors it returns `no_data_yet` for every metric. Used by Today totals, Reports, Economy. | `counter_anchors=0`, `counter_readings=0`, `counter_epochs=0` rows, yet `energy_samples_v1=140`, `production_legacy_v1=765`, `metrics=3080`. |
| R2 | **MemoryView is a today-only stub.** `MemoryView.tsx:32`: `const visibleTimeline = range === 'today' ? timeline : []`. Every non-today range renders empty regardless of stored rows and never calls the period API. | Source; the view's own copy at line 114 admits "liefert … noch keinen Verlauf". |
| D1 | **`recording_since` used the live run start, not earliest history** → "Aufzeichnung seit 16:50" shown *after* "Letzte Messung 05:15". | `viewmodels.py` `_build_storage_status` (pre-fix). |
| D2 | **Heartbeat reused the previous run's stale persisted sample as the current session's freshness** → "Aufzeichnung aktiv · Letzte Messung vor 2 Stunden" while the live feed is fresh. | `freshness.ts` `describeRecording` (pre-fix). |
| D3 | **Mixed UTC/local storage and null anchor timestamps.** `energy_samples_v1.measured_at` is UTC-naive while `pv_measured_at`/`grid_measured_at` are local (CEST, +2h). All 307 `raw_samples.observed_at_utc` are **NULL**. | DB inspection. |

**R1, R2, D1 and D2 are fixed** on this branch (see `MEMORY_INTEGRITY_CONTRACT.md`):
the authoritative period service now falls back to real stored cumulative counters
(`stored_sample_counter_delta`, anchors still preferred), and MemoryView resolves
every range through that one contract. Verified against a copy of the owner
database: a period that previously reported "no data" now returns
`grid_import 41.353 kWh`, `grid_export 76.979 kWh` (provenance
`stored_sample_counters`), with house/direct honestly withheld (sparse PV register).
**D3** (mixed UTC/local columns, NULL `raw_samples.observed_at_utc`) and the
reconciliation layer remain **open** and require device-validated follow-up.

---

## 2. Local Fronius API inventory (code-declared, NOT device-verified)

`collectors/fronius.py` issues a single `GET` (redirect-blocked, SSRF-guarded) and
consumes exactly one block: `raw["Body"]["Data"]["Site"]`.

| Field | Endpoint (Solar API v1) | Semantics | Reset behavior | Consumed by |
|-------|------------------------|-----------|----------------|-------------|
| `P_PV` | PowerFlow realtime `Site` | instantaneous PV power (W); documented null at night | instantaneous | live projection |
| `E_Day` | `Site` | energy today (Wh) | **daily-resetting** | live projection only |
| `E_Year` | `Site` | energy this year (Wh) | **yearly-resetting** | live projection only |
| `E_Total` | `Site` | lifetime energy (Wh) | monotonic (lifetime) | live projection only |

Consequences and **unverified** gaps:

- The local API **does** expose `E_Day`/`E_Year`/`E_Total`, and the collector reads
  them — but these values flow only into the live projection, **not** into the
  anchor/period path that Memory and Reports use. This is precisely why "Fronius
  shows daily energy" but "EnergyRadar solar yield unavailable" coexist.
- **Archive / history endpoints are never queried by the live app** —
  `GetArchiveData.cgi` is not used by the collector. **UPDATE:** the endpoint is
  now **CONFIRMED on the real device** (5-min interval energy, 16-day window,
  ~12-month retention, DST-correct local timestamps, `EnergyReal_WAC_Sum_Produced`
  sums to `E_Day`). A read-only, provenance-separated ingestion foundation exists.
  Full details: **`FRONIUS_LOCAL_ARCHIVE_INTEGRATION.md`**.
- Device time vs. host time skew is **unmeasured**; the collector timestamps with
  host `datetime.now(timezone.utc)` (`fronius.py:72`), not device time.

**Open device-verification tasks** (require the owner's inverter):
capture real `Site` and `GetArchiveData` payloads; confirm archive granularity and
retention; confirm counter units and reset semantics; measure device/host skew.

---

## 3. Solar.web capability audit — **NOT PERFORMED**

No Solar.web account or API access exists in this environment. Per the sprint's stop
conditions, Solar.web integration must **not** be assumed or implemented. The visible
Solar.web daily curve / yearly / yield / weather are therefore treated as an
**external, unproven** source. Required before any integration: confirm an official
API for this product/account, authentication, historical granularity, retention,
rate limits, licensing, and whether caching/display is permitted. All **UNRESOLVED**.

---

## 4. Live database findings (read-only)

`user_version = 5`. Migrations applied through `5 · continuous-recording-counter-anchors`
(2026-08-02T20:03Z).

Row counts:

```
energy_samples_v1      140     counter_anchors          0
production_legacy_v1   765     counter_readings         0
metrics               3080     counter_epochs           0
raw_samples            307     anchor_source_results    0
device_sources           3     recording_runs           0
application_metadata     3     recording_gaps           0
schema_migrations        5     production               0
```

Timestamp ranges:

- `energy_samples_v1.measured_at`: `2026-07-22 21:10:10` → `2026-08-01 13:20:40`
  (UTC-naive). `pv_measured_at` is +2h (local CEST) — **mixed zones in adjacent columns**.
- `production_legacy_v1.timestamp`: `2026-07-17` → `2026-07-18` (765 rows).
- `metrics.measured_at`: `2026-07-17` → `2026-07-22` (3080 rows; `pv_power`,
  `pv_energy_today/year/total`, `solar_power_w`).
- `raw_samples.observed_at_utc`: **NULL for all 307 rows** (legacy backfill defect).

Why the impossible ordering appeared: `recording_runs` is written on each app start;
the recorder writes an anchor **and** a sample together (`runtime.py:171,174`). The DB
holds 140 samples but **0 anchors/readings**, proving those 140 samples predate the
v5 anchor system and were written by the older combined-samples path. So:

- All 905+ historical measurements are **invisible** to the anchor-only period path.
- A freshly started run makes `recording_since` (live run start) newer than the last
  actually-persisted sample → the "recording since after last measurement" paradox.

---

## 5. Period-service findings

`periods.calculate_period(from, to)` (authoritative, used by Today totals, Reports,
Economy): queries `counter_anchors WHERE completed_at_utc BETWEEN … AND status !=
'failed'`; `< 2` anchors ⇒ `metrics.* = unavailable / no_data_yet`. With zero anchors
this is **every** period. It never falls back to `energy_samples_v1` stored counter
columns (`pv_energy_today_wh`, `grid_import_total_wh`, `grid_export_total_wh`) or to
legacy tables.

`history.get_today_history(tz)` (Today curve): reads `energy_samples_v1` directly and
correctly treats `measured_at` as UTC. This is why the **curve** renders while the
**totals** are "unavailable" on the same screen.

---

## 6. Corrected source hierarchy (target)

1. **A — Counter anchors** (`counter_anchors`/`counter_readings`): exact period
   deltas. *Currently empty.*
2. **A′ — Stored sample counters** (`energy_samples_v1.*_total_wh`, same-day
   `pv_energy_today_wh`): **real cumulative counters**, not integrated power. Legit
   for exact deltas over their captured endpoints, labeled lower-confidence
   provenance (`stored_sample_counter_delta`). *Not yet wired into the period path.*
3. **B — Power samples**: curve shape only. **Never** integrated into a factual kWh.
4. **C — Fronius `E_Day`/`E_Year`/`E_Total`**: known provider summaries for
   reconciliation and "known summary, incomplete curve". Never used to fabricate a curve.
5. **D — Solar.web history**: only if officially accessible and permitted. **Unproven.**
6. **E — Unknown**: only when no authoritative source supplies the metric.

---

## 7. Known limitations / unresolved questions

- No live Fronius device: sections 2 real-payload capture, archive availability,
  units, reset semantics, and device/host skew are **unverified**.
- No Solar.web access: section 3 entirely **unresolved**; no integration attempted.
- `raw_samples.observed_at_utc` NULL backfill needs a migration to be usable.
- Reconciliation thresholds (aligned / minor / material deviation) are **not yet
  defined**; must be set with tests, not guessed.
- Real-device same-period comparison (Fronius local vs Solar.web vs Today vs Memory
  vs Report) — **not performed**; a human with device access must record it.
