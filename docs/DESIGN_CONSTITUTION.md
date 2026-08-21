# EnergyRadar — Design Constitution

*The authoritative product-experience reference. This document is Product Law. Implementation follows it; it does not follow implementation.*

EnergyRadar is a **local energy operating system**, not a dashboard. Opening it should feel like *"my house is calmly telling me how it is doing"* — not *"here are 47 values."* The backend produces reality; the interface observes, explains, and remembers it. Trust is the product.

---

## 1. Target feeling — quiet confidence

A house that is doing fine must *feel* fine at a glance, without the user reading a single number. Every screen is calm, professional, timeless, minimal — German engineering, not startup hype. The absence of warnings is itself informative: an empty, untroubled state is a valid and confident state, not a gap to fill.

The product never makes the user perform triage. If a screen forces the user to sort equally-weighted information to find what matters, the interface has failed to do its job.

---

## 2. The three glances

Every primary surface is read in three separated passes. Hierarchy — not a grid — keeps them apart.

1. **First glance — a feeling.** Is my house okay right now? A single dominant, mostly non-numeric impression. And: is recording still alive?
2. **Second glance — a fact.** The headline figures that quantify the impression.
3. **Third glance — a diagnosis.** Details and, deeper still, technical diagnostics, reached only on deliberate lean-in.

What must never appear on a landing view: raw backend timestamps, counter or anchor internals, vocabulary from the data model, or more than one element competing to be most important.

---

## 3. One page, one question

Each page answers exactly one question and owns it. A page that answers two questions is two pages wearing one coat.

- **Jetzt — "What is my house doing right now?"** The home. Centered on the living energy flow.
- **Heute — "How is today developing?"** A day told as a narrative arc with a beginning, a now, and an honest expectation of its end.
- **Geräte — "Where is my energy actually going?"** Consumption as behavior, ordered by energy relevance.
- **Gedächtnis — "What can I learn from my house?"** Patterns and retained understanding, not a log.
- **Einstellungen — "How is the instrument configured?"** Calm, complete, out of the way; the one place technical truth may be foregrounded.

---

## 4. Information hierarchy

Every visible element belongs to exactly one tier.

- **Hero** — the state of the house, the direction of energy flow, the recording heartbeat. One dominant idea per page. Usually a relationship or a state, rarely a number.
- **Evidence** — the headline figures that quantify the hero. Present, legible, subordinate.
- **Supporting** — secondary context that colors the evidence.
- **Diagnostic** — per-reading precision, thresholds, poll timing, anchors, sync state, timestamps. Reachable, honest, never volunteered.

---

## 5. Flow is the center, not a card

Energy is a verb — power made, spent, stored, moved. Jetzt revolves around the **flow of energy through the house** as its spatial and conceptual center: sun, house, grid, and battery only where real data supports it. Direction is the primary information. The user must be able to read *"the house is living off the sun and the surplus is going to the grid"* without reading a number. Numbers annotate the flow; they never replace it. A flow rendered as one more equal card is a failure of this article.

---

## 6. Solar Economy is an assessment, not a report

A report states; an assessment judges. Economy delivers a **verdict first**, the **evidence that justifies it second**, and **granular detail on demand third**. The judgment is human and calm — the tone of a fair appraisal, never flattery or alarm. It is honest about its own certainty: measured savings are real; projections must look like projections. Economy never uses the language of earnings, profit, guarantees, invoices, payouts, or return-on-investment claims without a supported model.

---

## 6a. The day answers three decision questions

*(Owner-approved Product Law, 2026-08 — Energy Decision Experience.)*

EnergyRadar is a decision application, not a monitor. Heute's first viewport
answers three questions before any measurement: **How independent was the
household? What economic value was created? Was this a good energy day — and
why?** **Autonomy (Autarkie) and economic value are co-equal first-viewport
decision signals**; raw watts, device connectivity and equal KPI grids are
evidence beneath them, never the headline.

The daily verdict is deterministic and evidence-only — never praise, stars, or
invented benchmarks. **Autonomy determines the assessment class**; self-consumption,
economic value and coverage refine the explanatory sentence but never silently
change the class. Unknown autonomy yields an honest *not assessable*, not a guess.
Detail lives in `ENERGY_DECISION_EXPERIENCE.md`.

## 7. Weather explains energy, or it leaves

Weather is an adjective on solar production, not a noun of its own. Its only job is to answer *"why did the sun give me what it gave me, and what should I expect next?"* Weather is woven into the day's story, coloring production with cause. Correlation is not presented as causation; language stays cautious. A weather block that competes with the energy story as an isolated widget violates this article.

---

## 8. Trust through honesty

The interface constantly communicates: *this application knows what it knows, and openly admits what it does not.* Not by saying so — by never once pretending.

- **Unknown, zero, and not-yet must look different.** *Unknown* (no data), *zero* (measured, genuinely zero), and *not-yet* (the period hasn't reached this point) are three distinct appearances. Collapsing them loses trust faster than anything else.
- **Valid zero remains zero. Unknown remains unknown.** Zero is never rendered as absence; unavailable is never rendered as zero.
- **Measured is stronger than derived; derived is stronger than projected.** Certainty is visible in weight and tone. Measured reads solid; derived reads lighter; projected reads lighter still and clearly sits ahead of *now*. The user never has to wonder whether a number is reality or a guess.
- **Show the seams.** A stale reading says so, quietly, in place. Admitted staleness earns more confidence than a silently stale number shown as live.

---

## 9. Recording is sacred and always visible

The heartbeat that says *"I am still observing reality"* is the foundation everything derived rests on. When healthy it whispers — compact, quiet, easy to stop noticing. When it breaks it becomes the loudest thing on the screen, and it names the exact human reason: stopped, stale, provider unavailable, host suspended, or no data yet.

---

## 10. Freshness is a feeling, not a timestamp

Every kind of state is expressed in the language of liveness, not clock arithmetic. Live, recent, stale, and stopped are shown by presence and prominence. Timestamps are diagnostic truth, available on lean-in, never the landing vocabulary. History is settled and needs no freshness signal — the past is allowed to be still.

---

## 11. A box must be earned

A border is a strong statement of separation; most groupings are relationships, not separations. Prefer typography, spacing, alignment, and rhythm over containers. Boxes are reserved for genuinely modular, dismissible, or alert-worthy things. When a box is rare, a box means something. Reduce nested cards, grey boxes inside white boxes, floating rectangles, and equal-weight panels.

---

## 12. Typography carries the hierarchy

In a product with almost no chrome, type is the design.

- Use the full scale. A hero number is dramatically larger than a label; the distance between largest and smallest is what creates calm authority.
- Numbers are protagonists: tabular, stable in width and position as they change, with the figure confident and the unit small and quiet. Live figures never jitter — jitter reads as nervous, and nervous breaks trust.
- Weight communicates certainty: heavy for measured hero facts, lighter for derived and secondary information.
- Interpretive prose (assessments, memory) is set at a genuinely readable measure. When EnergyRadar speaks in sentences, it looks like it means them.
- Section rhythm comes from headings and space, not rules and boxes. Unequal space groups and separates; even space says nothing.

---

## 13. Light and dark are one product

Both themes must feel like the same instrument — calm, exact, restrained. No generic bright SaaS light mode, no washed-out surfaces, no neon or cyberpunk dark mode, no startup glitter. Hierarchy, contrast, and the unknown/stale/partial/zero distinctions survive both themes intact.

---

## 14. Immutable principles

Every future UI change must be able to cite one of these. A change that violates one is wrong, however good it looks.

1. The UI explains before it measures.
2. One page tells one story.
3. The house speaks in its own voice — never the vocabulary of the data model.
4. Recording is always visible: a whisper when healthy, the loudest thing on screen when it stops.
5. Unknown, zero, and not-yet must look different.
6. Measured is solid; derived is lighter; projected is lighter still.
7. Trust is earned through honesty, not decoration.
8. Timestamps become feelings before they reach the user.
9. Flow is the center, not a card.
10. A box must be earned.
11. Whitespace is a tool of hierarchy, not emptiness.
12. The hero dominates; everything else defers.
13. Technical truth is available, never volunteered.
14. The empty, untroubled state is a valid and confident state.
15. Numbers hold still.
16. Assessments have opinions; reports do not.
17. Weather explains energy or it leaves.
18. The past is still.
19. Calm is a feature, not an absence of features.
20. Remove before you add.
21. Autonomy and economic value are co-equal decision signals; the day answers three questions before it measures.
22. The daily verdict is earned and deterministic; autonomy sets the class, and unknown autonomy is *not assessable*, never a guess.
