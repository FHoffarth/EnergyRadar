# EnergyRadar
## Product Blueprint & Roadmap

- **Status:** Authoritative Product Direction
- **Date:** July 2026
- **Scope:** Product vision, architecture, trust model, UX principles, and roadmap through v1.0

## 1. Product Vision

EnergyRadar is not a solar dashboard.

It is not a Fronius frontend.

It is not a Home Assistant clone, a SCADA interface, an engineering console or a generic AI chatbot.

EnergyRadar is a **local-first home energy intelligence system**.

Its purpose is simple:

> Help people understand what their home is doing, what has changed, and whether they should care.

EnergyRadar should not overwhelm users with measurements. It should transform reliable energy data into calm, understandable and trustworthy guidance.

The long-term ambition is:

> EnergyRadar becomes the memory and intelligence of the home.

The desired product feeling is closer to Apple Home, Apple Weather and Things than to Grafana, an inverter portal or a utility control panel.

Calm.  
Warm.  
Readable.  
Private.  
Trustworthy.

## 2. Product Positioning

Traditional energy software answers:

> What are the numbers?

EnergyRadar answers:

> What is happening?

And, when evidence allows:

> Is this normal?  
> What changed?  
> Why might it matter?  
> Should I do anything?

The user is not expected to interpret charts, power flows and historical time series alone. The product performs that cognitive work.

EnergyRadar should not display a collection of sensor feeds or statistics.

It should present an assessment.

## 3. Core Product Principles

These principles govern product, architecture, design and roadmap decisions.

### Windows First

Windows remains the primary supported desktop environment.

Platform and packaging work must support the product, not dominate it.

### Data Model First

No interface should be built for data the system cannot model, validate and explain.

### Memory Before Intelligence

The system cannot interpret today without remembering yesterday.

### Quality Before Claims

No conclusion may be stronger than the evidence that supports it.

### Explanation Before Evidence

The user first receives the meaning, then the numbers behind it.

### Silence Is a Valid Outcome

EnergyRadar must not manufacture an insight merely to fill a card.

When everything is normal, the product may simply say so.

### No More UI-First Development

New product capabilities begin with domain rules, data contracts and trust conditions.

The interface follows.

## 4. The Trust Rule

EnergyRadar must never display a number without knowing:

- where it came from
- when it was measured
- how fresh it is
- whether it is complete
- whether zero is a real value or missing data
- how trustworthy the value is
- whether the value is suitable for comparison or inference

Trust is not a feature.

Trust is the product.

## 5. What EnergyRadar Must Never Become

EnergyRadar must not drift into:

- dashboard fatigue
- endless KPI grids
- decorative insight cards
- invented explanations
- forced daily stories
- cloud dependency by default
- opaque AI reasoning
- provider-specific architecture
- constant alerts
- false precision
- analysis based on incomplete data
- a chatbot as the primary product interface

The product should remain useful even when AI is disabled entirely.

## 6. Product Experience

EnergyRadar should be glanceable first and explorable second.

A user should understand the current situation within roughly two seconds.

The interface must adapt to the severity and importance of the state.

### Normal State

When nothing meaningful has changed:

> Everything looks normal.  
> Your home covered 85% of today’s consumption with its own energy.

No artificial story.  
No unnecessary warning.  
No filler insight.

### Relevant Change

When a notable but noncritical change exists:

> Night-time consumption has been slightly higher this week.

The product may then show:

- magnitude
- comparison period
- confidence
- supporting evidence
- possible contextual explanation

### Critical State

When an inverter is offline, data is stale or a serious anomaly exists, that state takes priority over greeting, storytelling and decorative content.

For example:

> Live data has not been received for 18 minutes.

The interface hierarchy must be adaptive, not fixed.

## 7. Interface Hierarchy

The previous linear story model is replaced by an adaptive model.

```text
Priority State
    ↓
Glanceable Summary
    ↓
Relevant Change, only when present
    ↓
Evidence
    ↓
Details
```

In human terms:

> Show what matters first.  
> Say nothing when nothing needs to be said.  
> Prove every important claim.

The interface is not a fixed sequence of cards.

It is a presentation of the current truth.

## 8. Product Language

EnergyRadar should use calm, human language.

Avoid:

- Current Load
- Consumption KPI
- Anomaly detected
- Vampiric load
- AI insight
- System telemetry
- Production variance

Prefer:

- Right now
- Your home is currently using 420 W
- Night-time consumption has increased slightly
- Solar generation is winding down for today
- Everything looks normal
- Data is incomplete for this period

The language must communicate uncertainty honestly.

Avoid:

> Your heat pump is consuming too much.

Prefer:

> Consumption was higher than usual during the night. Cold weather may be one possible reason.

Only mention causes supported by available context.

## 9. Provider-Independent Domain Model

Fronius is the first adapter, not the product architecture.

The internal model must use provider-neutral concepts.

Core domains include:

- Home
- Provider
- Energy Source
- Solar Generation
- Home Consumption
- Grid Import
- Grid Export
- Battery
- Battery Charge
- Battery Discharge
- State of Charge
- Device
- Measurement
- Daily Summary
- Data Quality
- Baseline
- Context
- Inference
- Explanation

Provider-specific fields may exist inside adapters, but they must not leak into product logic.

Future sources may include:

- Fronius
- Shelly
- MQTT
- Home Assistant
- smart meters
- battery systems
- heat pumps
- weather providers
- tariff providers

## 10. System Architecture

The architecture must not be a single synchronous pipeline.

Energy data arrives asynchronously and at different frequencies.

The system therefore splits after normalization.

```text
Providers
    ↓
Provider Adapters
    ↓
Provider-Independent Energy Model
    ├── Live State Path
    │       ↓
    │   In-Memory State
    │       ↓
    │      UI
    │
    └── Memory Path
            ↓
       Aggregation
            ↓
       Quality Evaluation
            ↓
          SQLite
            ↓
         Baselines
            ↓
      Inference Engine
            ↓
    Explanation Engine
            ↓
            UI
```

### Live State Path

Purpose:

- immediate feedback
- current power flow
- current battery status
- current provider connectivity
- freshness indicators

The UI must not wait for a database round trip to show live values.

### Memory Path

Purpose:

- historical storage
- aggregation
- quality tracking
- comparisons
- baselines
- inference
- explanations

Live data and historical truth are related but not identical.

## 11. Local Memory

Memory is the foundation of the product.

EnergyRadar must store enough history to understand the home over time.

Memory includes:

- timestamped measurements
- daily summaries
- partial-day markers
- provider provenance
- freshness
- quality states
- missing-value states
- aggregation level
- seasonal context
- baseline history
- inference history

SQLite is the default local database.

Recommended characteristics:

- WAL mode
- explicit schema
- migration support
- versioned database format
- transactional writes
- periodic aggregation
- controlled retention
- downsampling for older data
- recovery after interrupted writes

The database should favor explicit energy-domain columns over a generic EAV schema unless real future requirements justify greater abstraction.

## 12. Data Quality Model

Each relevant value should carry or inherit quality information.

Possible quality dimensions:

- source
- measured_at
- received_at
- age
- completeness
- aggregation status
- estimated or measured
- partial day
- missing
- invalid
- provider error
- confidence

A real zero must never be confused with missing data.

A partial day must never be compared to a full day without explicit normalization or warning.

A stale live value must never appear as current without a freshness indicator.

## 13. Baselines

EnergyRadar must not treat a rolling average as universal truth.

What is normal depends on:

- time of day
- weekday
- season
- weather
- household behavior
- available devices
- data completeness
- system configuration

The memory engine must therefore establish house-specific baselines.

Initial baseline dimensions may include:

- typical consumption by hour
- typical night-time load
- weekday versus weekend
- seasonal generation
- typical grid import
- typical battery charge behavior
- comparable-day ranges
- confidence based on sample count

The system must be willing to say:

> There is not enough history yet to assess this reliably.

That is better than a weak conclusion.

## 14. Context Contracts

Every inference rule must declare what it needs.

Example:

```text
Rule: unusual_night_consumption

Required inputs:
- home consumption
- valid local timestamps
- sufficient night-time history

Optional context:
- outside temperature
- heat-pump state
- tariff window

Minimum quality:
- high completeness
- no stale source data

Suppression conditions:
- insufficient baseline
- known device event
- incomplete comparison period
```

This prevents rules from producing conclusions without enough context.

Some rules require weather.

Others do not.

For example, weather is not necessary to determine that:

- a provider is offline
- data is stale
- a value is missing
- battery telemetry is inconsistent
- grid export remains zero despite confirmed solar production

Weather is relevant for conclusions about:

- heating consumption
- cooling consumption
- solar performance
- temperature-dependent household load
- seasonal deviations

## 15. Inference Engine

The initial intelligence layer is deterministic.

The Inference Engine reads:

- live state
- historical data
- quality information
- baselines
- context
- device metadata

It produces structured facts.

Example:

```yaml
type: night_consumption_increase
severity: low
confidence: 0.91
observed_change: 18%
comparison_period: 28 comparable days
quality: high
possible_context:
  - outside temperature lower than baseline
```

The engine does not write final prose.

It produces evidence-backed facts.

The previous separate Rule Engine and Knowledge Layer are merged for the initial product phase.

Additional knowledge infrastructure should only be introduced when genuinely required.

## 16. Explanation Engine

The first explanation system should be local, deterministic and reproducible.

It converts structured facts into human language.

Example input:

```yaml
fact: night_consumption_increase
change: 18%
confidence: high
weather_context: colder_than_usual
```

Example output:

> Night-time consumption was around 18% higher than on comparable recent nights. Colder weather may have contributed.

The Explanation Engine must:

- avoid invented causes
- respect confidence
- suppress low-value observations
- use a limited number of statements
- distinguish evidence from hypothesis
- remain fully functional without an LLM

## 17. Role of AI

EnergyRadar may use AI, but AI is not the foundation of truth.

The deterministic system remains responsible for:

- calculations
- validation
- aggregation
- history
- baselines
- comparisons
- confidence
- anomaly detection
- physical consistency

AI may assist with:

- phrasing
- summarization
- prioritization
- explaining several verified facts together
- adapting technical explanations to the user
- identifying candidate relationships for later validation

AI must never:

- calculate energy totals
- infer from raw data without guardrails
- replace quality validation
- invent missing readings
- state unverified causes as facts
- receive raw household history by default
- be required for core product operation

## 18. AI Privacy Model

The local-first promise must remain intact.

The default product must work without sending household data to an external AI provider.

A future AI module should be:

- optional
- disabled by default
- transparent about provider and processing location
- based on structured, minimized facts
- prohibited from receiving raw time-series history by default
- explicitly opt-in for cloud processing
- replaceable through a defined adapter interface
- removable without breaking the product

Potential modes:

### Local Deterministic Mode

Default.

No model required.

### Local Model Mode

Optional, only when hardware and product constraints permit.

Model size and resource requirements must remain proportionate.

### External AI Mode

Optional and explicit.

Only minimized structured facts may be transmitted.

The user must know:

- what is sent
- where it is processed
- why it is needed
- how to disable it

## 19. Time, Location and Daylight

Energy interpretation requires correct temporal context.

EnergyRadar must understand:

- local time
- timezone
- daylight-saving changes
- sunrise
- sunset
- date boundaries
- season
- partial days

A greeting may never be derived from solar output.

It must be based on valid local time and context.

Sunrise and sunset should ideally be calculated locally from stored coordinates to avoid unnecessary cloud dependency.

Location should be stored only with the precision required for the feature.

## 20. Data Ownership and Portability

Local-first means the user owns the memory.

EnergyRadar must provide:

- database backup
- database restore
- export of measurements
- export of daily summaries
- CSV export
- schema/version information
- validation before import
- safe backup before replacement
- clear recovery behavior

A local memory without a backup path is a temporary cache.

Backup and portability are part of v0.7.0, not future polish.

## 21. Notification Philosophy

EnergyRadar should not reward frequent attention.

Notifications should be rare, meaningful and confidence-aware.

Notify only when:

- action may be required
- a serious data problem exists
- a persistent anomaly is sufficiently supported
- a device condition may cause harm or cost
- the user explicitly requested the notification

Do not notify merely because a value changed.

Calm technology should be quiet when the home is healthy.

## 22. Roadmap

### v0.6.x — Stabilize

**Purpose:** Protect the existing release.

Scope:

- Windows stability
- packaging
- installer reliability
- crash fixes
- provider connection fixes
- no major product expansion

macOS work remains limited until the unresolved Intel Mac issue is understood.

### v0.7.0 — EnergyRadar Remembers

**Purpose:** Build the reliable memory of the home.

Core scope:

- provider-independent energy model
- adapter boundary
- in-memory live state
- SQLite persistence
- WAL mode
- schema migrations
- measurement history
- daily summaries
- partial-day handling
- explicit `null` versus zero
- quality flags
- provenance and freshness
- retention
- downsampling
- local timezone handling
- sunrise and sunset context
- baseline foundations
- comparable-day model
- backup
- restore
- SQLite export
- CSV export

Definition of Done:

- historical data survives application restarts
- live values remain responsive
- source and freshness are traceable
- missing values are distinguishable from zero
- partial periods are never presented as full periods
- users can back up and restore their data
- no inference exceeds available evidence
- the product can begin establishing what is normal for this home

### v0.8 — EnergyRadar Understands

**Purpose:** Introduce deterministic, context-aware intelligence.

Core scope:

- Inference Engine
- structured fact format
- confidence levels
- minimum-history requirements
- rule suppression
- severity model
- house-specific baselines
- time-of-day baselines
- weekday and seasonal comparisons
- basic weather context
- temperature history
- device-aware context where available
- anomaly persistence requirements
- distinction between observation and possible cause

Possible first rules:

- stale or missing data
- provider offline
- persistent base-load increase
- unusual night consumption
- unexpected grid import
- inconsistent battery behavior
- unusual solar generation, only with weather context
- incomplete daily data
- repeated provider instability

Definition of Done:

- every rule declares required inputs
- rules are suppressed when evidence is insufficient
- no rule silently assumes missing context
- every generated fact includes confidence and provenance
- the normal state remains quiet

### v0.9 — EnergyRadar Explains

**Purpose:** Turn verified facts into calm, understandable guidance.

Core scope:

- deterministic Natural-Language Engine
- explanation templates
- confidence-aware language
- prioritized summaries
- adaptive home screen
- glanceability
- drill-down evidence
- explanation history
- user-readable quality states
- optional experimental AI adapter
- privacy controls for external AI
- structured fact minimization

Definition of Done:

- EnergyRadar explains relevant changes clearly
- no explanation requires an LLM
- no raw history is sent externally by default
- uncertainty is communicated honestly
- the application may remain silent when nothing matters
- evidence is always accessible behind the explanation

### v1.0 — Home Energy Intelligence

**Purpose:** Deliver a mature, trustworthy home energy intelligence product.

Possible scope:

- multiple providers
- richer home model
- device relationships
- weather integration
- tariff context
- long-term seasonal learning
- historical pattern comparison
- battery strategy analysis
- energy cost context
- configurable recommendations
- optional AI explanation modules
- robust backup and migration
- stable public product architecture

Definition of Success:

EnergyRadar can reliably answer:

- What is happening?
- Is it normal?
- What changed?
- How certain is that?
- What evidence supports it?
- Is there anything I should do?

## 23. Strategic Non-Goals Before v1.0

Do not prioritize:

- a chatbot-first interface
- broad smart-home control
- device automation
- marketplace integrations
- cloud accounts
- social features
- gamification
- public leaderboards
- predictive claims without strong context
- complex tariff optimization before reliable data
- a large local language model bundled by default
- decorative AI branding

## 24. Product Success Criteria

EnergyRadar succeeds when users say:

> I understand my home better.

Not:

> There are many charts.

The product should reduce:

- uncertainty
- unnecessary checking
- data interpretation effort
- false alarms
- provider dependence
- mistrust in unexplained values

It should increase:

- confidence
- awareness
- data ownership
- understanding
- calm
- long-term usefulness

## 25. Final Product Statement

> EnergyRadar is a calm, local-first home energy companion that remembers how a home behaves, detects meaningful changes and explains them without overstating what the data can prove.

Compact brand form:

> EnergyRadar remembers.  
> EnergyRadar understands.  
> EnergyRadar explains.

Governing engineering principle:

> The system calculates.  
> The rules assess.  
> AI may explain.  
> Evidence always wins.
