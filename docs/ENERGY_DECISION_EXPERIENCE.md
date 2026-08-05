# Energy Decision Experience

> **Status: APPROVED (owner, 2026-08). Product Law — frozen in
> `DESIGN_CONSTITUTION.md` §6a and principles 21–22.**
> Decision-model logic + tests are implemented (Phase B: `services/decision.py`,
> `tests/test_decision.py`). Visual implementation (Phase C+) has not begun and
> must not begin until the decision-model tests are green (they are).
>
> **Owner refinements folded in:** autonomy **and economic value** are co-equal
> first-viewport signals (not autonomy alone); autonomy sets the assessment
> *class* while self-consumption/economy/coverage only refine the sentence;
> thresholds accepted as-is; night = reliable sun-times, else conservative clock;
> the secondary live-PV/kWp gauge is approved only when capacity is configured.

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

**APPROVED (Product Law):** Autarkie **and economic value** are co-equal
first-viewport signals; the verdict names the day. Frozen in Constitution §6a.

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

## 5. Daily assessment model (APPROVED — implemented in `services/decision.py`)

Deterministic, evidence-only, conservative. No stars, no benchmarks, no praise.
**Autonomy determines the class; self-consumption, economy and coverage refine the
sentence only** (owner Product Law). `coverage_complete=False` marks `trust:
partial` and adds a caveat but never downgrades the class. Unknown autonomy →
`not_assessable`.

Inputs (only proven metrics): Autarkie A, Eigenverbrauch E, data completeness
(curve/summary coverage), economic availability.

Owner-approved classes and thresholds (`decision.EXCELLENT_MIN=80`,
`STRONG_MIN=60`, `BALANCED_MIN=40`):

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

## 11a. Unified energy home (owner-directed, 2026-08)

**Now and Today are one energy story.** Jetzt and Heute are consolidated into one
primary surface, **Übersicht**. Navigation is Übersicht · Verlauf · Geräte ·
Einstellungen (Gedächtnis → Verlauf).

- **Routing (Option B):** the `today` route becomes the unified surface; the legacy
  `now` route redirects to it (`AppLayout`), so old deep links keep working without
  a second data fetch or duplicate polling. `NowView` is no longer routed.
- **First-viewport hierarchy:** a compact live-energy strip (PV · Hausverbrauch ·
  Netz + live/stale status) reads first on desktop; on mobile the verdict leads
  (CSS `order`). Then the decision cockpit (verdict · Autarkie gauge · economic
  value · one sentence), then the balance, chart, weather, recording, technical.
  Live never consumes the whole first viewport.
- **Gauge colour semantics:** the active arc is warm **solar amber**
  (`stroke-amber-500 / dark:stroke-amber-400`) over a warm, receding track; the
  centre number carries a subtle per-class text tone. No grey arc, no glow, no
  traffic-light colours; meaning is never colour-only (verdict text + aria carry it).
- **Autonomy/economy pairing:** one decision zone, two aligned columns (gauge |
  economic hero); economy known values first, missing components second with the
  precise reason.
- **Duplication rules:** exactly one verdict, one economy section (the hero — the
  legacy `EconomySummary` block is removed from the main flow), one weather block
  (multi-day forecast behind disclosure), one recording heartbeat, one
  data-quality message (a compact chart footer; "Warum fehlen Daten?" and all
  detailed reasons live only in Technical Details).
- **Balance language:** `PV-Erzeugung`, `Solarstrom selbst genutzt` (= generation −
  export, distinct from total consumption), `Hausverbrauch gesamt`, `Netzbezug`,
  `Einspeisung` — no ambiguous "im Haus genutzt".
- **Weather** is supporting context only: concise current + one sentence + freshness;
  hourly/multi-day behind disclosure.

## 11b. Above-the-fold cockpit & 24h graph (owner-directed, 2026-08)

**Above-the-fold hierarchy** (one closed cockpit, `max-w-5xl` content):
1. quiet personal greeting (`greetingTitle`, local time-of-day + name; a `<p>`,
   never a second h1) + one factual status line,
2. daily verdict (the single h1),
3. Autarkie gauge + economic value as one paired decision zone,
4. energy balance (left) **and weather (right)** in the same lower zone.

**Weather is integrated into the cockpit** (`CockpitWeather`): concise current
temp/condition + one solar-outlook sentence + sunset; hourly and multi-day forecast
behind one "Wetterdetails anzeigen" disclosure. The large separate weather section
below the page is **removed**; the duplicate chart "Ausblick" is gone. Only real
weather data is shown.

**24-hour graph** redesigned (not cosmetic):
- **Fixed local 24h axis** with even ticks (00·04·08·12·16·20·24), independent of
  sample/gap positions.
- **Data gaps recede** — a very light shaded band, and they are **never bridged by
  an artificial (interpolating) line** (the dashed gap-bridge lines were removed).
  `connectNulls={false}`; one compact data-quality footer + "Warum fehlen Daten?".
- **Robust Y scale** capped near the 95th percentile (+20 %) so a brief spike can't
  flatten the day; peaks above the cap are clipped **but disclosed** as a count +
  maximum below the chart — values are never deleted or silently truncated.
- Legend: Solar · Verbrauch · Datenlücke (forecast only when real forecast data
  exists). No energy math changed; totals stay independent of display.

Desktop and mobile share this information logic (verdict-first on mobile).

## 12. Owner decisions (resolved 2026-08)

1. Autarkie as Heute hero — **approved**, refined to **co-equal with economic value**.
2. Assessment classes + thresholds — **approved as-is** (autonomy sets the class).
3. Night-window source — **sun-times first, conservative clock fallback**.
4. Secondary live-PV/kWp gauge — **approved, only when capacity is configured**;
   never inferred.

Frozen in `DESIGN_CONSTITUTION.md` §6a and principles 21–22.

## 13. Typography system (owner-directed, 2026-08)

Two self-hosted OFL typefaces, no runtime Google Fonts / CDN requests:
- **Plus Jakarta Sans** (`--font-ui`, `--font-sans`) — all UI, text and decision
  copy. Weights 400/500/600/700, latin, normal.
- **Barlow** (normal width — **never Condensed**) (`--font-data`, `--font-metric`)
  — measured values only (Autarkie %, kW/kWh, €, °C, times, chart axes/tooltips,
  live-strip, balance figures). Weights 500/600/700, latin, normal.
- Geist Mono (`--font-mono`) is retained only for technical identifier fields; it
  is not used in the visible cockpit.

Files vendored to `src/assets/fonts/*.woff2` (from `@fontsource/*`, then the
packages removed); licenses in `PLUS-JAKARTA-SANS-LICENSE.txt` / `BARLOW-LICENSE.txt`
(SIL OFL 1.1). `font-display: swap`. The replaced Geist-sans weights were deleted.

Roles are applied through `@theme` tokens plus `.font-ui` / `.font-data` /
`.metric-value`, and — because numeric metrics already opt in via Tailwind's
`tabular-nums` — `.tabular-nums` is bound to the data font with tabular + lining
figures, giving Barlow app-wide for numbers with minimal churn (numbers align and
never jump on live updates). Section eyebrows moved from ALL CAPS to sentence case.
No layout, data, or calculation changed. Known limitation: on-screen light/dark and
1366×768/375/320/Large-Text verification is the owner's packaged-review step.

## 14. 24-hour chronicle — data-visualization redesign (owner-directed, 2026-08)

The overview chart is a readable day, not a raw/debug plot.

- **15-minute display aggregation** (`lib/chartAggregation.ts`, memoized): per bucket
  the arithmetic mean (calm line/area) plus the raw max (peak detection only). A
  bucket needs ≥1 real sample; empty buckets stay `null` — no interpolation, no
  zero-fill, no carry-forward. Factual daily totals are computed elsewhere and
  untouched. (Real device: ~hundreds of raw points/day → 96 display buckets.)
- **PV = calm amber area** to the baseline; **consumption = clear indigo line**;
  neither drawn across a real gap (`connectNulls=false`).
- **Fixed local 24h axis** (00·04·08·12·16·20·24), independent of sample/gap positions.
- **Gaps** are a thin band at the very bottom (never full-height), plus one footer
  line "Messdaten für N Zeiträume unvollständig" and a "Warum fehlen Daten?" disclosure.
- **Robust Y scale** ~p95×1.2 with a 0.5 kW floor; real interval maxima above the
  cap are **marked as dots at the top and disclosed** ("N Verbrauchsspitzen über der
  Skala · Maximum X kW") — values are never deleted or silently truncated (no needle
  forest, no misleading clipped line).
- **Tooltip** per interval: time range, PV Ø, Hausverbrauch Ø (+ Peak), Datenstatus;
  UI text Plus Jakarta Sans, values Barlow.
- **Accessible**: chart `aria-label` summarises period, series, gap count and peak
  maximum; an optional "Messwerte als Tabelle anzeigen" discloses the 15-min table.
- Compact height (`clamp(15rem,32vh,22rem)`); empty/partial states handled.

## 15. Shared cockpit grid (alignment, 2026-08)

The whole main card sits on one `grid-cols-12`: Autarkie 1–6 · Wirtschaft 7–12;
Solarenergie 1–3 · Haushalt 4–6 · Wetter 7–12 (a full-width divider between zones).
`EnergyBalanceStory` is split into `SolarBalanceBlock`/`HouseBalanceBlock` placed
directly on the shared grid, so Wirtschaft and Wetter share the exact col-start and
Autarkie shares its axes with the balance zone. Spacing is grid-gap only — no
per-block `ml-*/pl-*/translate-*` offsets. Mobile order: Autarkie, Wirtschaft,
Solarenergie, Haushalt, Wetter.

## 16 — Final visual cleanup (chart hierarchy + economy value-first)

A calm-down pass over the consolidated Übersicht — visual/copy only, no
aggregation, calculation, tariff, weather, or backend change.

- **PV reads as a trace, not a block.** The area fill drops to `stopOpacity 0.10`
  and the PV stroke rises to `2.25` so the line carries the day's shape; the fill
  only hints at volume. `connectNulls={false}` still forbids bridging real gaps.
- **Peaks are a compact chevron.** `PeakChevron` draws a small downward triangle
  whose tip sits on the exact time at the top of the plot — no circles, no
  full-height rule, no animation. The real maximum stays in the tooltip and footer.
- **The gap band is a thin neutral rule.** `y2 = yCap * 0.02`, slate `#64748B` at
  0.35 — a secondary quality hint, never full height and never PV-coloured.
- **The top legend is just the two series** (Solarerzeugung · Hausverbrauch).
  Coverage, peak count and peak maximum move into one compact footer line, with a
  small named symbol help (Datenlücke · Verbrauchsspitze) so neither is
  communicated by colour alone.
- **The hero no longer repeats itself.** The second coverage status line next to
  the greeting is gone; provisionality is stated once, by the Vorläufig chip.
- **The economy block is value-first.** The strongest known euro figure leads big
  (total, else feed-in, else avoided) with its label; the missing component stays
  calm in the breakdown with a compact precise reason (`economyReasonShort`, e.g.
  "Stromtarif nicht hinterlegt") — never a red error, no duplicated paragraph.
