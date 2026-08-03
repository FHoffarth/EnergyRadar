# Memory Integrity Contract

Branch: `feature/fronius-history-memory-integrity`.
Companion: `FRONIUS_DATA_SOURCE_AUDIT.md`.

Product rule: **Known summary, incomplete curve — not "No data".**
And its inverse: **Unknown is not zero, but known is also not unknown.**

---

## 1. Timestamp semantics (two distinct clocks)

The core class of contradictions came from conflating **persisted-history freshness**
with **live-session freshness**. They are now separate signals:

| Signal | Meaning | Source | Field |
|--------|---------|--------|-------|
| `recording_since` | Since when do we **hold history** | earliest persisted record `MIN(received_at)` | `SystemInfo.recording_since` |
| `current_session_since` | When did the **current live run** start | active `recording_runs.started_at_utc` | `SystemInfo.current_session_since` |
| `last_recorded_sample_at` | Last **persisted** measurement | `MAX(received_at)` | `SystemInfo.last_recorded_sample_at` |
| live projection freshness | Is the **live feed** current | runtime projection snapshot | `NowView` / flow |

Invariants:

- `recording_since ≤ last_recorded_sample_at` **always** (earliest ≤ latest). The old
  code set `recording_since` to the newest run start, breaking this; it is now the
  earliest persisted record. Enforced by
  `tests/test_recording_freshness.py::test_recording_since_is_earliest_history_not_live_run_start`.
- `current_session_since` may be **newer** than `last_recorded_sample_at` right after
  startup (the session has not persisted yet). That is expected and must **not** be
  read as staleness.

## 2. Heartbeat / freshness rules (`freshness.ts::describeRecording`)

A persisted sample belongs to the current session only when
`last_recorded_sample_at ≥ current_session_since`.

| Condition | State | Wording | Healthy |
|-----------|-------|---------|---------|
| Not recording | `stopped` | "Aufzeichnung unterbrochen · Letzte Messung vor …" | no |
| Recording, no this-session sample yet (fresh run over old/no history) | `no_data` | "Aufzeichnung läuft · … erste Speicherung läuft" | **yes** |
| Recording, this-session sample older than 3× cadence | `stale` | "Aufzeichnung aktiv · Zuletzt gespeichert vor …" | no |
| Recording, this-session sample within cadence | `recording` | "Aufzeichnung läuft · seit HH:MM Uhr" | yes |

The startup contradiction ("Aufzeichnung aktiv · Letzte Messung vor 2 Stunden" while
live values are fresh) is eliminated: a previous run's stale sample can no longer
drive the current session's heartbeat. Regression:
`frontend/react-ui/src/test/freshness.test.ts`.

Never show stale persisted-history wording as if the live feed were stale. Live-feed
staleness (a separate concern) is derived from the projection, not from persisted rows.

## 3. Source precedence

Per `FRONIUS_DATA_SOURCE_AUDIT.md §6`: A (counter anchors) → A′ (stored sample
counters, real cumulative registers only) → C (Fronius provider summaries, for
reconciliation and known-summary display) → D (Solar.web, only if proven) → E
(unknown). **B (power samples) is curve-only and is never integrated into a factual
kWh.**

## 4. Partial-history behavior (Memory must never claim empty when rows exist)

For a selected period, the Memory surface must classify into exactly one of:

| Case | Have | Show |
|------|------|------|
| 1 | samples + anchors | curve + totals + coverage + gaps + provenance |
| 2 | samples, anchors incomplete | curve + partial coverage; **no fabricated totals**; exact reason |
| 3 | anchors/stored counters, samples missing | exact summary + "Verlauf unvollständig"; **no empty state** |
| 4 | Fronius summary only, local history incomplete | known Fronius total + provenance + "Tagesertrag bekannt, Verlauf unvollständig"; **no invented curve** |
| 5 | Solar.web history (proven + permitted) | attributed import/live series; no silent mixing; conflict handling |
| 6 | no source has data | genuinely unavailable |

**Empty-state rule:** the Memory page must **never** say "keine Messwerte verfügbar"
when persisted records exist for the selected period. It must instead report the
existence of stored history (first/last record, count, coverage) and the precise
reason a given metric is unavailable.

## 5. API contract (period report — target)

`calculate_period` must expose separately, without collapsing into a generic state:
requested period; resolved local period; UTC bounds; summary metrics; curve series;
coverage; gaps; source provenance; freshness; data quality; reconciliation; exact
unavailable reason; first/last known record; installation/recording baseline;
provider summary values; conflict state. Raw internal enum names stay in diagnostics,
not on primary UI. Backward compatibility is deliberate and tested.

## 6. Conflict behavior (reconciliation — target, not yet implemented)

Compare local anchor/stored-counter totals with Fronius provider counters; **retain
both**; compute absolute + relative deviation; classify (aligned / minor deviation /
material deviation / local incomplete / provider stale / source conflict /
incomparable period / unavailable); never silently overwrite; preserve source
timestamps, identity, and confidence. Thresholds must be defined explicitly **with
tests** — none are invented here.

---

## 7. Status on this branch

**Implemented + tested (device-independent):**
- Two-clock timestamp model (`recording_since` = earliest history;
  `current_session_since` = live run start) — `viewmodels._build_storage_status`.
- Heartbeat separates live-session from persisted-history freshness — `freshness.ts`.
- **R1 — stored-sample-counter fallback in the authoritative period service**
  (`periods.calculate_period`): when no anchor pair covers a period, exact deltas
  from real cumulative registers in `energy_samples_v1` (grid import/export
  lifetime; PV `E_Day` summed per local day) are returned as
  `stored_sample_counter_delta` / provenance `stored_sample_counters`. Anchors are
  always preferred; power is never integrated into kWh; no curve is invented.
- **`viewmodels.build_period_report`** — one authoritative period contract behind
  Today, Memory and Reports; classifies summary / records-only / unavailable.
- **R2 — MemoryView** resolves every range (incl. today) through the period API
  via a new Qt bridge channel (`requestPeriod` → `periodReady/periodFailed`),
  the provider `requestPeriod`, and context. The `range === 'today' ? … : []`
  stub is gone; "keine Messwerte" can appear only when records, summary and curve
  are all absent.
- Regression tests: `tests/test_recording_freshness.py`,
  `tests/test_period_sample_fallback.py`, `frontend/react-ui/src/test/freshness.test.ts`,
  `MemoryView.test.tsx`, `periodView.test.ts`. Report↔Memory agreement asserted.

**Fronius local archive (proven + ingestion foundation shipped):**
- `GetArchiveData.cgi` confirmed on the real device; read-only, idempotent,
  provenance-separated ingestion into `provider_archive_*` (migration 6). PV
  interval-energy history reconciles with `E_Day`. See
  `FRONIUS_LOCAL_ARCHIVE_INTEGRATION.md`.
- **OPEN:** wiring the archive PV curve into the period contract + Memory/Today/
  Report display (Case: "local samples missing, Fronius archive available" →
  "Verlauf aus dem Fronius-Datalogger verfügbar"), with source-boundary metadata.

**Specified but OPEN (need device-validated work):**
- `raw_samples.observed_at_utc` backfill migration; UTC/local column normalization.
- Reconciliation layer + thresholds (provider summary vs local totals).
- Per-range curve series for historical ranges (period API is totals-only today).
- Real-device same-period comparison (Fronius/Solar.web vs EnergyRadar).
