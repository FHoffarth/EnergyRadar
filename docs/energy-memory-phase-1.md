# Energy Memory Phase 1

EnergyRadar records local history only while the application is running and a source is configured. It does not contact a cloud archive, reconstruct missed curves from counters, interpolate outages, or backfill periods when the app was closed.

## Stored fields and trust

Each poll writes measured Fronius and Tasmota source observations plus one EnergyRadar cycle row to SQLite. Stored fields include canonical and receive UTC timestamps, available source timestamps, PV power, trustworthy derived house power, signed grid power, measured import/export counters, source identity, availability, provenance, quality state, and quality flags.

Grid power remains positive for import, negative for export, and zero for a measured balanced exchange. Null means unavailable. House power uses `pv_power_w + grid_power_w` only when the existing live freshness and alignment rules accept both readings; otherwise it remains null. Non-finite values abort the complete cycle transaction.

The canonical history timestamp is the UTC receive timestamp for the collection cycle. Tasmota device/source timestamps are retained separately and never replace this ordering anchor. Fronius supplies no device timestamp; its host-local model time remains source text while the aware cycle receipt is authoritative. Legacy v2 PV and signed-grid readings remain available, but legacy house power is left null because those rows contain no source-alignment evidence. Duplicate cycle/source keys are idempotent. Restarting the app continues with the same local database and stable source identities.

History queries are bounded to Today, 7 days, or 30 days using Europe/Berlin calendar boundaries and UTC database comparisons. Large ranges select representative measured points in SQLite without averaging or smoothing values. A raw gap over 30 seconds produces an explicit null separator so chart lines cannot bridge the missing period.

## Manual hardware checklist

- Start EnergyRadar and confirm the existing live values remain plausible.
- Leave EnergyRadar running for several minutes.
- Switch a kettle on and off; observe Solar, Consumption, and Grid Flow history.
- Confirm grid import appears above zero and export below zero.
- Confirm a genuine 0 W reading remains visible as zero.
- Close EnergyRadar and wait without claiming or expecting closed-app backfill.
- Restart EnergyRadar and confirm the earlier samples remain.
- Confirm the closed-app period is a visible gap and recording resumes.
- Confirm no duplicate points appear after reconnect or restart.
- Confirm Heute, 7 Tage, and 30 Tage load correctly.
