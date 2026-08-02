# ADR-004: Continuous recording and counter anchors

- Status: accepted
- Date: 2026-08-02

## Context

EnergyRadar previously refreshed Fronius and the smart meter from a Qt bridge timer. Persistence, live state, Today totals and forecast generation were side effects of that UI refresh. The legacy history also integrated sampled power when counter evidence was missing. That made continuity depend on the desktop bridge and made exact period provenance impossible to prove.

## Decision

EnergyRadar uses one backend-owned pipeline:

`collectors -> monotonic scheduler -> atomic recorder -> SQLite -> disposable current projection -> trust/period services -> read-only adapters -> UI`

- A bounded collector cycle polls each configured physical source once. The same parsed result feeds the projection, source health and persistence.
- Cumulative counters are canonical for factual energy. `E_Total`, grid import and grid export are stored as exact decimal counter readings.
- Instantaneous power samples remain curve evidence only. Gaps remain visible and are never interpolated into factual kWh.
- Persistent cycles create a shared anchor with actual per-source observation times and measured skew. Deltas require the same source, register and counter epoch at both anchors.
- Counter resets close an epoch. No period delta crosses an epoch boundary.
- The UI is a read-only client. UI navigation and route reads cannot change device cadence or persist measurements.
- Current state is disposable. Startup may rebuild last-known state as stale, but only a successful new poll makes it fresh.
- Recording runs and gaps make clean shutdown, crash restart, provider outage, timing reversal and evidenced host suspend/resume explicit.
- Existing history is retained. Migration v5 does not synthesize or backfill anchors; exact anchor totals begin with the second compatible real anchor.

## Source-of-truth split

- Counters: factual PV, import, export, house consumption, direct self-consumption and Solar Economy.
- Samples: observed power curve and sample coverage.
- Projection: latest value, timestamps, health and freshness inputs; never authoritative history.
- Weather cache/projection: provider payload and timestamps; unrelated weather failures never gate energy.

## Alternatives rejected

- UI-triggered polling cannot guarantee recording before or independently of navigation.
- Power integration cannot prove factual energy across missing samples and would turn curve evidence into an accounting claim.
- Independent source periods cannot safely support cross-source balances or Economy.
- Interpolation would hide outages and manufacture observations.
- Installing an OS background service now would add deployment and permissions scope before the backend boundary is stable.
- A complete rewrite would endanger the additive migration and existing local history.

## Consequences and limitations

EnergyRadar currently confirms the existing battery-free, single-PV topology for the balance formulas. Battery, additional generation, Universal topology inference, long-term downsampling, signing and remote authentication remain out of scope. The backend stays bound to localhost. A future Keller Node can host the same scheduler, recorder and calculation services behind the same local HTTP contracts.
