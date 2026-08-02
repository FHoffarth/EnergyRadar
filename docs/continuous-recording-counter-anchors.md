# Continuous Recording & Counter Anchors

## Product contract

EnergyRadar zeichnet auf, solange es läuft.

Für Energiemengen verwendet EnergyRadar die Zählerstände der verbundenen Geräte. Zeitraumsummen können deshalb auch Messpausen überbrücken, wenn für den Anfang und das Ende des Zeitraums kompatible Zählerstände vorhanden sind.

Leistungsverläufe enthalten nur tatsächlich beobachtete Messwerte. Lücken werden sichtbar dargestellt und niemals interpoliert.

Alle Ansichten lesen aus derselben lokalen Historie. Wetter und Vorhersage aktualisieren sich unabhängig von der Navigation und zeigen ihre Aktualität.

Alle Daten bleiben lokal.

## Record once, derive many

The backend starts one recording runtime with the application process. A monotonic scheduler owns source cadence and uses a bounded I/O pool. One energy cycle polls each configured source once and fans the parsed result out to:

1. the disposable current-state projection;
2. source health/freshness;
3. a 60-second persisted power sample and counter anchor when due.

UI timers only refresh serialization from the projection and SQLite. Connection tests are serialized through the same runtime owner and never write history.

## Counters, anchors and periods

Fronius `E_Total` is normalized from Wh to kWh. The Tasmota smart meter contributes cumulative `ImportActive` and `ExportActive` kWh. Missing registers remain unknown; zero remains zero.

An anchor stores a shared sequence and trigger plus actual per-source `observed_at_utc`, `received_at_utc`, status and skew. Successful readings commit atomically with the anchor. Counter values use decimal text and belong to a source/register epoch. Reset, replacement or negative movement closes the epoch.

`GET /api/period?from=<utc>&to=<utc>` chooses real boundary anchors and returns requested and actual periods, source observations, skew, identities, epochs, gaps, provenance, state/reason pairs and a `no_extrapolation` marker. A single anchor returns `no_data_yet`.

For the confirmed battery-free, single-PV topology:

- PV generation = PV counter delta
- Grid import = import counter delta
- Grid export = export counter delta
- House consumption = PV + import - export
- Direct self-consumption = PV - export

Negative balances, missing anchors, source changes, epoch changes and unsupported topology remain unavailable with a precise reason.

## State and gap semantics

Metrics expose `no_data_yet`, `fresh`, `zero`, `stale`, `partial`, `sparse`, `provider_unavailable`, `metric_unsupported`, `incompatible_period`, `counter_reset`, `invalid_balance` or `error`. States are metric-specific: a meter outage does not hide PV.

No synthetic samples are written for process stops, suspend, clock correction or provider outages. Runs record clean shutdown. A latest run without clean shutdown creates a crash gap on restart. Evidenced wall/monotonic divergence records `host_suspended`; wall reversal is retained as a timing state while anchor sequence preserves logical order. Provider outage retains last-known timestamps and becomes a source gap when recovery bounds it.

A power-sample gap does not invalidate a compatible counter delta across the same interval.

## Weather

Current weather refreshes every 15 minutes and forecast projection every 30 minutes, independently of navigation. Provider `observed_at`/`fetched_at`, cache age, freshness and warnings remain part of the report. Stale fallback is labelled stale and cannot create a present-tense claim. Hour cards are filtered at render time: the current hour remains through `HH:59:59`, is labelled “Jetzt”, and expires exactly at the next hour boundary.

## Migration and legacy data

Schema v5 is additive and enables WAL with full synchronous durability. Existing tables and charts remain. Legacy v2 rows are not converted into anchors and do not acquire invented source timestamps or epochs. New exact totals begin only after two compatible real anchors. The old power-integration fallback is not used for factual totals.

## Local boundary and future node

Current: `Desktop client -> local projection/HTTP API -> backend recorder`.

Future: `Desktop or browser client -> RadarOS/Keller Node API -> same backend recorder`.

The current server remains localhost-only. This sprint adds no account, cloud, daemon installation or remote authentication.

## Known limitations

- The balance formulas cover the existing battery-free single-PV topology only.
- No synthetic historical anchors are available immediately after migration.
- A fully closed provider outage is required before its end timestamp is known.
- Suspend detection is best-effort and only records platform-neutral timing evidence.
- Long-term downsampling, a background OS service and weather-history scoring are not included.
- No authoritative inverter/meter maximum-energy-rate capability is currently available, so delta plausibility is limited to identity, epoch, ordering and non-negative balance guards.
