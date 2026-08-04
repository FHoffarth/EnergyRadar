# Energy Decision Experience — Phase A Proposal

> **Status: PROPOSAL, pending owner approval. Not yet Product Law.**
> This document defines the decision model, information hierarchy and status
> semantics for Product Experience v2. No UI has been built yet. Nothing here
> amends `DESIGN_CONSTITUTION.md` until the owner explicitly approves the items
> marked **[NEW PRODUCT LAW — needs approval]**.

Companions (unchanged): `DESIGN_CONSTITUTION.md` (Product Law),
`DATA_TRUTH_ARCHITECTURE.md`, `MEMORY_INTEGRITY_CONTRACT.md`,
`FRONIUS_LOCAL_ARCHIVE_INTEGRATION.md`.

Governing truth rule (unchanged): EnergyRadar does not invent truth. Every hero
value is truth-compatible or it is honestly unavailable.

---

## 1. Product promise

Fronius monitors the *installation*. EnergyRadar interprets the *household's
energy day*. It leads with judgement and value, not watts and connectivity:

1. Autarkie · 2. Economic value · 3. Daily assessment · 4. Explanation ·
5. Evidence · 6. Technical detail.

This is an execution of existing Product Law (Constitution §1, §2, §14.1
"the UI explains before it measures"), not a new direction.

## 2. Audit findings (current build @ 55a2773)

| Area | Already present (backend) | Gap (this sprint) |
|------|---------------------------|-------------------|
| Autarkie | `build_today_vm` `autarky_pct = 1 − import/consumption` | not the hero; no gauge; no verdict sentence |
| Eigenverbrauch | `self_consumption_pct = 1 − export/generation` | supporting, not surfaced as a distinct concept |
| Economy | `economy.calculate_period`: avoided, feed-in, total, net — each with **precise reason codes** (`grid_tariff_missing_or_boundary`, `feed_in_tariff_missing_or_boundary`, `energy_unavailable_or_sparse`) | UI shows generic "keine belastbare Berechnung" instead of the precise cause |
| Daily verdict | — | does not exist; must be defined + tested |
| Fronius status | `f_conn ∈ {connected, stale, offline, error, unconfigured}` (viewmodels ~587) | no **night/standby** state → red "Offline" at night (false fault) |
| Weather status | `weather_fetched_at` may be null while location resolved | contradiction "Standort ✔" + "Noch nicht verfügbar" |
| Charts | one bounded 5-min line for every range (downsampled) | not range-appropriate (7d spaghetti, 30d/year not daily bars) |

**Key insight:** the decision *data* exists and is truth-checked; v2 is mostly
hierarchy, one verdict, gauge presentation, and status wording.

## 3. Information hierarchy — "Heute" (proposed)

First viewport answers verdict + autonomy + economic value + one reason:

1. **Daily verdict** (one sentence, self-explaining)
2. **Autarkie gauge** (hero instrument)
3. **Economic value** (strong monetary figure + small breakdown)
4. Energy balance story (generated / consumed / import / export / self-consumed)
5. Energy flow / daily composition
6. Day arc (5-min)
7. Weather explanation (adjective on production)
8. Recording & source confidence (heartbeat — Constitution §9)
9. Technical details (diagnostics, on lean-in)

Raw figures are evidence, never the headline (Constitution §14.1, §14.12).

**[NEW PRODUCT LAW — needs approval]** Elevating **Autarkie to the Heute hero**
(the Constitution frames Heute as "how is today developing?"; this makes autonomy
the dominant instrument of that story).

## 4. Formulas & compatibility rules

All use existing trusted period values; all require a **compatible period** (same
resolved window, compatible coverage, as already enforced by
`period_archive.derive_house_consumption`). Unknown stays unknown; invalid is a
conflict, never silently clamped.

- **Autarkie** `= 1 − grid_import / house_consumption`
  - only when: house_consumption known **and > 0**, grid_import known, periods
    compatible.
  - clamp only for harmless tolerance (e.g. −0.5 %…100.5 % → 0…100); otherwise
    report `autarky_period_conflict`. Never force an invalid value into 0–100.
- **Eigenverbrauch** `= (PV_generation − grid_export) / PV_generation`
  - only when: generation known **and > 0**, export known, self-consumed ≥ 0.
- **Economy** (unchanged, `economy.py`):
  - `avoided = self_consumed_PV × grid_tariff`
  - `feed_in = grid_export × feed_in_tariff`
  - `total = avoided + feed_in`
  - Never call gross production value "savings" — only avoided cost is savings.

Distinction (Constitution-aligned, contextual help): **Autarkie** = share of demand
met without the grid (hero). **Eigenverbrauch** = share of PV kept in the house
(supporting).

## 5. Daily assessment model **[NEW PRODUCT LAW — needs approval]**

Deterministic, evidence-only, conservative. No stars, no benchmarks, no praise.

Inputs (only proven metrics): Autarkie A, Eigenverbrauch E, data completeness
(curve/summary coverage), economic availability.

Proposed classes and **proposed** thresholds (must be owner-approved + tested;
these are starting points, not industry claims):

| Class | Condition |
|-------|-----------|
| `not_assessable` | Autarkie unavailable OR periods incompatible OR coverage insufficient |
| `incomplete_evidence` | assessable inputs exist but coverage is only partial |
| `excellent` | A ≥ 80 % and coverage complete |
| `strong` | 60 % ≤ A < 80 % |
| `balanced` | 40 % ≤ A < 60 % |
| `grid_dependent` | A < 40 % |

Verdict sentences are templated from the **real** values and only assert what the
evidence supports (e.g. "evening grid import" only if the curve shows it):

- excellent/strong: „Ein weitgehend autarker Energietag. Die PV-Anlage deckte den
  größten Teil des Verbrauchs."
- high generation, low Eigenverbrauch: „Ein ertragreicher Solartag, aber ein
  großer Anteil wurde eingespeist statt im Haus genutzt."
- incomplete: „Der Tag kann nur teilweise bewertet werden, weil Netz- und
  Solardaten nicht denselben Zeitraum vollständig abdecken."

## 6. Gauge semantics

- **Autarkie gauge**: dominant semicircular/circular, % in the centre, unit small;
  calm, no neon/glow/automotive styling; measured-vs-derived weight (Constitution
  §14.6 — Autarkie is *derived*, shown lighter than a measured hero fact);
  **unknown state is intentional** (a quiet "nicht bewertbar" arc, never a broken
  0 %). Accessible text equivalent required (§12).
- **Current-PV gauge** (secondary, optional): `live PV / configured kWp` **only if
  kWp is configured** (`pv_installed_kwp`). Never infer capacity. Must distinguish
  live / night-standby / unavailable / stale.
- **Economic instrument**: a strong monetary figure + small breakdown — **not** a
  euro value forced into a percentage ring (no real baseline → no ring). Decorative
  gauges without a baseline are disallowed (Constitution §11, §14.10).

## 7. Status semantics (fixes)

### Fronius at night
Add states beyond `offline`: `live`, `night_standby`, `wake_window`,
`offline_unexpected`, `error`, plus archive availability (`archive_available` /
`archive_stale`). A missing live reading during **expected night** (inverter
powers down ~22:00–05:00) is **not** a fault. Determine night from **sun times**
(weather report sunrise/sunset) when reliable; fall back to a conservative clock
window only if sun data is unavailable; never claim a fault without fault evidence.
Safe wording: `Nachtbetrieb · Live-Daten pausieren · Archiv verfügbar`. Historical
data stays available while live pauses.

### Weather
Separate: location configured · provider reachable · data loaded · last update ·
stale · loading · unavailable. Never present "erreichbar" as if data were current.
Exact strings:
- reachable, nothing stored yet → `Wetterdienst erreichbar · Wetterdaten noch nicht geladen`
- loaded → `Wetterdaten aktualisiert um HH:MM Uhr`
- stale → `Wetterdaten zuletzt um HH:MM Uhr aktualisiert`
- failed → `Wetterdaten derzeit nicht verfügbar`

### Recording
Unchanged — keep the proven split (live observation / recording session /
persisted freshness / archive availability) from the freshness fix.

## 8. Solar Economy reframe

Verdict first, then evidence, then detail (Constitution §6). Hierarchy: verdict
sentence → total economic value → avoided cost → feed-in → energy quantities →
tariff assumptions → details. Surface the **existing precise reasons** individually
(never one generic line):
- `Eine wirtschaftliche Bewertung ist noch nicht möglich, weil kein gültiger Stromtarif hinterlegt ist.`
- `Für die Einspeisevergütung fehlt ein gültiger Tarif.`
- incompatible energy period / partial coverage / provisional tariff → each its own line.
Show the known part; mark only the missing part unavailable.

## 9. Chart strategy by range

| Range | Presentation | Rule |
|-------|-------------|------|
| Heute / Gestern | bounded 5-min day arc (existing) | local/archive distinction subtle |
| 7 Tage | daily small multiples / separated daily arcs | visible day boundaries, no 7-day spaghetti |
| 30 Tage / Monat | **daily energy bars** (PV / Verbrauch / Import / Export) | not thousands of power points |
| Jahr | monthly (or daily) aggregates | trends, not telemetry |

Totals stay **independent of display aggregation** (already true — totals come from
raw counters/archive sums). No interpolation, no invented points, provenance kept.

## 10. Trust constraints & non-goals

Constraints: unknown ≠ zero ≠ not-yet; measured > derived > projected in weight;
no fabricated kWh/curve/economy; no false "offline"; no false "no data"; accessible
equivalents for every gauge; reduced-motion respected.

Non-goals: gamification, stars, industry benchmarks, euro rings without a baseline,
new providers, Solar.web, weakening the truth model, or a card-grid redesign.

## 11. Implementation sequence (proposed, each phase its own commit)

- **A (this doc)** — audit + model + hierarchy. *No code.*
- **B** — decision-model tests (autarkie, eigenverbrauch, verdict states, precise
  reasons, night status, weather status) — pure logic, fully testable.
- **C** — Heute decision cockpit (verdict, autarkie gauge, economic hero, balance
  story; evidence below). Validate light/dark, 320 px, large text.
- **D** — range-aware charts.
- **E** — status surfaces (Fronius night, weather, devices language).
- **F** — full validation + packaged screenshots.

## 12. Open decisions for the owner

1. Approve **Autarkie as the Heute hero** (§3).
2. Approve the **assessment classes + thresholds** (§5) — or adjust the cut points.
3. Confirm the **night window source** (sun times preferred; clock fallback ok?).
4. Confirm scope: is a secondary **live-PV/kWp gauge** wanted (needs kWp configured)?

Nothing in §3/§5 is frozen into `DESIGN_CONSTITUTION.md` until these are approved.
