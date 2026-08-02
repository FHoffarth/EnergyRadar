# EnergyRadar — Product Experience Audit (v1 sprint, Phase 1)

Measured against `docs/DESIGN_CONSTITUTION.md`. This audit is observation only — no code was changed to produce it. It inventories every visible element on **Jetzt** and **Heute**, classifies each into a tier, and names where the current UI contradicts Product Law. The backend engine (scheduler, anchors, counters, periods, recorder, weather backend, Economy math, provider integrations) is frozen and out of scope.

**Tiers:** `Hero` (the one dominant state/relationship per page) · `Evidence` (headline figures that quantify the hero) · `Supporting` (secondary context) · `Diagnostic` (precision, timing, internals — lean-in only) · `Misc` (chrome/labels).

---

## A. Jetzt — `views/NowView.tsx`

Owns the question *"What is my house doing right now?"*

| # | Element (source) | Current tier as built | Correct tier | Verdict |
|---|---|---|---|---|
| J1 | `CurrentEnergyBriefing` header — eyebrow "Aktuelle Energielage", plain-language `headline`/greeting, `verdict`, `timestamp` subline (`NowView.tsx:138`, `CurrentEnergyBriefing.tsx`) | Hero | **Hero** | Right idea, wrong details — see J1a/J1b |
| J1a | `subline` = `snapshot.timestamp` / "Veraltet · {timestamp}" / "Demo-Daten · {timestamp}" (`NowView.tsx:61‑66`) | Hero | **Diagnostic** | ✗ Raw timestamp string leaks into the hero. Must become a freshness *feeling* (Art. 10). |
| J1b | Greeting mode replaces the energy headline with a name-greeting; the actual verdict drops to a sub-line (`NowView.tsx:67‑70,139`) | Hero | Supporting | ✗ Personality outranks the house's state. The state must be the headline. |
| J2 | "Energiefluss" section, bordered `cockpit-surface`, header + "Live-Messwerte" label (`NowView.tsx:145‑149`) | Hero | **Hero** (as true flow) | ✗ Today it is a titled card, not a flow. |
| J2a | Three equal tiles PV / Haus / Netz, each an inner `rounded-xl bg-slate-50/70` box (`NowView.tsx:150‑176`) | Hero | **Evidence** | ✗ This *is* the "flow as a grid of equal cards" failure (Art. 5, 9-of-principles). Boxes-in-a-box (Art. 11). |
| J2b | Static `→` arrows between tiles (`NowView.tsx:156‑158`) | Misc | remove/replace | ✗ Always points right; encodes no real direction. Decoration, not flow. |
| J2c | "Live-Messwerte" label (`NowView.tsx:148`) | Misc | remove | ✗ Backend-flavoured label; redundant with freshness. |
| J3 | Grid channel detail "Bezug / Einspeisung / Kein Austausch" (`NowView.tsx:75‑81,109`) | Supporting | **Evidence** | ✓ Good semantic; sign-aware. Keep, feed it into flow direction. |
| J4 | Unknown handling: `UNKNOWN_VALUE` + muted `UNKNOWN_ACCENT`, gated on `origin === 'observed'` (`NowView.tsx:18,30‑32,88‑109`) | Evidence | Evidence | ✓ Unknown ≠ zero is respected. But *unknown* vs *not-yet* vs *stale* are not yet visually distinct (Art. 8). |
| J5 | Day-trend card — "Tagesverlauf PV", Messpunkte count, `DayTrendChart`, forecast headline (`NowView.tsx:182‑205`) | Evidence (8-col card) | **Supporting** (or remove) | ✗ Duplicates Heute's chart; pulls a day-narrative element onto the now-page. "Messpunkte" is diagnostic. |
| J6 | `WeatherIntelligence` compact (aside) (`NowView.tsx:209`) | Supporting | Supporting | ~ Acceptable, but should tie to production, not sit as a standalone aside widget (Art. 7). |
| J7 | "Datenquellen" muted box — device status chips "…online/veraltet/Fehler" (`NowView.tsx:210‑216`) | Supporting | **Diagnostic** | ✗ Source/device wiring status is lean-in detail, not landing content. |
| J8 | **Recording heartbeat** | **absent** | **Hero-adjacent** | ✗✗ The sacred heartbeat (Art. 9) is *not on Jetzt at all*. Liveness is only inferred in the sidebar from `snapshot.quality`, not from the recorder/anchor state now available post-#27. |

**Jetzt summary.** The page is a three-tile metric panel with a decorative arrow, topped by a headline whose freshness is a leaked timestamp, plus a duplicated day chart and a device-status box — and no recording heartbeat. The one thing that should be Hero (the *directional flow*) is rendered as Evidence; two Diagnostic things (timestamp, device wiring) sit near the top.

---

## B. Heute — `views/TodayView.tsx`

Owns the question *"How is today developing?"*

| # | Element (source) | Current tier as built | Correct tier | Verdict |
|---|---|---|---|---|
| H1 | Header — eyebrow "Tagesanalyse", title "Heutiger Energieverlauf" (`TodayView.tsx:88‑97`) | Misc/Hero | Hero | ~ "Analyse"/"Energieverlauf" is report language. The Hero should be the day *assessment*, not a section title. |
| H2 | `DailySummaryMetrics` — 5-column grid of equal muted boxes: Solar, Verbrauch, Netzbezug, Einspeisung, **Datenabdeckung** (`TodayView.tsx:99`, `DailySummaryMetrics.tsx:36‑45`) | Hero (first, largest block) | **Evidence** | ✗ "Grid of equal cards" (Art. 11). Appears *before* the assessment — narrative inverted (Art. 6/3). |
| H2a | "Datenabdeckung: Vollständig/Teilweise…" as a 5th metric tile (`DailySummaryMetrics.tsx:34`) | Evidence | **Diagnostic** | ✗ Coverage state is diagnostic; it should not sit as a peer metric. |
| H3 | `DailyInterpretation` statements (`TodayView.tsx:100`) | Supporting (2nd) | **Hero** | ✗ This *is* the day assessment and must lead the page, not follow the metric grid. |
| H4 | `EconomySummary` (`TodayView.tsx:101`, `EconomySummary.tsx`) | Evidence (3rd) | Evidence/assessment | ~ Structurally verdict-first *within itself*, but see Economy section. Nested muted boxes; grey unavailable box. |
| H5 | 24-h chart section — numeric time axis, visible shaded gaps, dashed non-measured bridge, `connectNulls={false}`, valid zero kept (`TodayView.tsx:126‑231`) | Evidence | **Evidence** | ✓ Strong and honest already. Gaps visible, no interpolation, sr-only description present. Keep; calm the gap shading (Art., "flickenteppich"). |
| H6 | Weather trio — `WeatherIntelligence` + `CompactHourlyForecast` + `MultiDayWeatherForecast` stacked (`TodayView.tsx:232‑236`) | Supporting (large) | **Supporting** | ✗ A three-block mini weather-dashboard at page end, isolated from the day arc (Art. 7). |
| H7 | "Datendetails" `<details>` — `DataCoverageStatus` + stored-messpunkte box (`TodayView.tsx:237‑246`) | Diagnostic | **Diagnostic** | ✓ Correct progressive disclosure. Good pattern; reuse it elsewhere. |
| H8 | Demo/no-data notices (`TodayView.tsx:103‑124`) | Misc | Supporting | ~ Fine; keep honest. |

**Heute summary.** The narrative runs *evidence grid → assessment → economy → chart → weather trio*. Product Law requires *assessment → evidence → day arc → economy → weather-in-arc → recording context → details*. The verdict currently trails its own evidence, coverage-state is mis-tiered as a metric, and weather is an isolated widget stack.

---

## C. Cross-cutting findings

**C1 — Containers (Art. 11).** Heavy containeritis. `cockpit-surface`/`cockpit-surface-muted` borders wrap nearly everything, and Jetzt nests inner `rounded-xl` tiles inside a bordered surface (boxes-in-boxes). Equal-weight panels stack down Heute. Most of these separations are actually relationships and should be carried by type + space.

**C2 — Typography (Art. 12).** A usable scale exists (`cockpit-title`, `cockpit-eyebrow`, `cockpit-section-title` in `index.css`), and `tabular-nums` is applied to figures and chart ticks (good — numbers hold still). But hero numbers are only `text-3xl` and sit close to labels in size; the scale's extremes are unused, so nothing dominates. Units are `text-base`/`text-lg` — not quiet enough. There is no weight/tone language for **measured vs derived vs projected**, nor for **unknown vs zero vs not-yet**.

**C3 — Colour/theme system (Art. 13).** Three overlapping systems: `@theme --color-radar-*`, `:root --radar-*` CSS vars, and ad-hoc Tailwind `slate/amber/indigo/emerald/orange` literals scattered across components. Light and dark are handled per-component with `dark:` variants rather than through shared semantic tokens. There are no tokens expressing certainty (measured/derived/projected) or the three kinds of nothing. This fragmentation is the root cause that makes trust-state distinctions inconsistent across themes.

**C4 — Recording & freshness (Art. 9, 10).** The post-#27 recorder/anchor heartbeat is not surfaced anywhere in primary UI. Liveness is inferred from `snapshot.quality` in the sidebar "Datenstatus" only. Freshness reaches the user as raw `snapshot.timestamp` strings (Jetzt subline, sidebar detail). There is no distinct treatment for *stopped / stale / provider-unavailable / no-data-yet*.

**C5 — Weather (Art. 7).** Present and functional, but positioned as standalone widgets on both pages (aside on Jetzt, trio on Heute). It never explains a dip in the day's production curve; it reports sky rather than colouring energy.

**C6 — Solar Economy (Art. 6).** `EconomySummary` already leads with a title + single euro figure (verdict-ish) and discloses detail in `<details>` — the best-structured component today. Gaps: it nests three muted sub-boxes as an equal grid; the unavailable state is a grey report-style box; coverage/estimate caveats are present but visually flat; the verdict does not yet read as a human sentence.

**C7 — Diagnostics leakage (Art. 13-principle).** On landing surfaces: device wiring chips (J7), "Live-Messwerte" (J2c), "Messpunkte" counts (J5), coverage-as-metric (H2a). All belong behind lean-in.

**C8 — Accessibility (keep & extend).** Good baseline: section `aria-label`s, chart `role="img"` + descriptive label + `sr-only` gap explanation, `tabular-nums`, global `prefers-reduced-motion`. Missing: a **non-visual textual summary of the live energy state/direction** for Jetzt (e.g. *"Solar erzeugt 2,4 kW, das Haus verbraucht 1,1 kW, 1,3 kW werden eingespeist"*), and semantic distinction of unknown/stale not conveyed by colour alone.

**C9 — Responsive.** `cockpit-shell` caps width at 1720px and centres; `cockpit-grid` collapses to one column ≤1079px. No obvious horizontal-overflow risk seen in source, but the Jetzt 5-track grid and Heute 5-col metric grid need checking at 1366×768 and 150% scaling (Phase 10).

---

## D. Tier-1 violations — what must move

**Currently occupying Hero but shouldn't:**
- Jetzt three equal metric tiles + arrow (J2a/J2b) → demote to Evidence, replaced by a true directional flow.
- Jetzt leaked timestamp subline (J1a) → Diagnostic, replaced by freshness feeling.
- Heute 5-metric grid (H2) → Evidence, moved below the assessment.
- Heute coverage-as-metric (H2a) → Diagnostic.

**Should be Hero but is absent or demoted:**
- The **directional energy flow** on Jetzt (currently Evidence-as-tiles).
- The **recording heartbeat** on Jetzt (currently absent).
- The **day assessment** on Heute (currently second, after its own evidence).

---

## E. Change plan mapped to sprint phases (implementation follows this)

1. **Shared primitives (pre-Jetzt).** Introduce semantic trust/freshness tokens and small presentational primitives — `Figure` (value+unit with tabular, measured/derived/projected weight), `Freshness` (live/recent/stale/stopped feeling), `RecordingHeartbeat`, and unknown/zero/not-yet renderers — in the theme layer (`index.css` tokens) and `lib`/`components`. No engine calls.
2. **Phase 2 — Jetzt.** Rebuild around a directional flow (sun→house→grid, real direction from signed values), hero plain-language state without leaked timestamp, live values as annotations, add the recording heartbeat, demote device wiring and the duplicated chart to lean-in. Add the non-visual flow summary.
3. **Phase 3 — Heute.** Reorder to assessment → evidence → day arc → economy → weather-in-arc → recording context → details; convert the 5-metric grid into a typographic evidence zone; move coverage to diagnostics.
4. **Phase 4 — Economy.** Verdict as a human sentence first; evidence second (flatten nested boxes); precise unavailable reasons without the grey report box; estimate/provisional visibly softer.
5. **Phase 5 — Weather.** Bind weather to the day arc as explanation; keep forecast correctness (current-hour = Jetzt, expired drops at boundary, stale labelled); stop the standalone trio from competing.
6. **Phase 6 — Containers.** Remove earned-less borders across the changed scope; replace with type/space/rhythm.
7. **Phase 7 — Typography.** Widen the scale; hero numbers larger, units quieter; encode measured/derived/projected weight.
8. **Phase 8 — Remove.** Strip raw ISO/backend wording/identifiers/state-names from primary surfaces into diagnostics.
9. **Phase 9 — Light/Dark.** Consolidate onto semantic tokens so both themes read as one product and trust-states survive both.
10. **Phase 10 — Validation.** Python, frontend tests, lint, build, visual + desktop + accessibility review; screenshots (light/dark · Jetzt/Heute/Economy).

**Guardrail.** If any step starts to read like Grafana, Home Assistant, TradingView, or a card collection, stop and re-check against `docs/DESIGN_CONSTITUTION.md` before continuing.
