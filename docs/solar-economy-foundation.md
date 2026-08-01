# Solar Economy foundation

## Purpose and trust boundary

Solar Economy translates recorded energy into cautious economic estimates. The order is fixed: measured energy, user-confirmed tariff, deterministic calculation, then interpretation. Results are estimates, not invoices, guaranteed savings, actual payouts, or profit. Supplier and grid-operator settlements can differ. EnergyRadar does not infer taxes, contractual adjustments, or tariffs from installation age.

The German product terms are **Netzbezugskosten**, **vermiedene Stromkosten**, **geschätzte Einspeisevergütung**, **wirtschaftlicher Solarwert**, and **variable Energieposition**. The last term is feed-in remuneration minus grid-import cost plus avoided grid cost; it is not profit.

## Tariff history (schema v4)

Migration v4 adds `tariff_periods` without rewriting energy history. Monetary decimals are stored as canonical `TEXT`, preventing conversion to binary floating point. Each record has an ID, tariff type, either `value_ct_per_kwh` or `annual_eur`, inclusive `valid_from` and optional inclusive `valid_until`, optional label, source type, provisional flag, and UTC creation/update timestamps.

Supported types are `grid_work_price`, `feed_in_tariff`, and `base_price`. Work price and feed-in tariff use ct/kWh; base price uses EUR/year. Validity dates are inclusive: 31 March followed by 1 April is adjacent. Two records of the same type may not share a valid date. Create and update check overlap while holding a SQLite write reservation. Missing validity is unavailable, never zero. A selected period spanning multiple rates is withheld unless energy is safely segmented by tariff validity; rates are never blended silently.

No personal tariff is a default. The fixture values 34.00 ct/kWh, 120 EUR/year, `ENTEGA Ökostrom fix 24`, and supplied contract dates occur only in tests/examples. Feed-in remuneration remains unconfirmed until entered. A provisional entry is labeled “Vorläufiger Wert – noch nicht durch Abrechnung bestätigt” and makes dependent presentation provisional.

## Energy-source audit and hierarchy

Each economic energy quantity records provenance and coverage:

1. non-negative cumulative counter delta for the selected period;
2. trusted provider energy total (reserved; no separate current historical source);
3. trapezoidal power integration only with at least 50% coverage and no interval beyond the existing five-minute gap limit;
4. unavailable.

Negative deltas and resets are rejected. A reliable counter delta carries the timestamps of its actual first and last observations. It is exact for that captured interval and may therefore be `partial` even when observations cover less than half of the time since midnight; the unobserved part of the day is neither filled nor extrapolated. Covered power integration can be an explicit fallback and is identified as `integrated_power_history`; sparse integration is not used.

PV and export are combined for direct self-consumption only when period key, source identity, and provenance are all equal. Counter-based PV is never silently mixed with integrated export, and measurements from different captured boundaries or trust origins remain unavailable. A house-consumption total is not required because direct self-consumption is independently supported by compatible PV minus export totals. Derived house power is not an economic energy source.

Captured-period house consumption can be derived independently as `PV generation + grid import − grid export`, but only when all three energy totals have identical period boundaries, source identity, and provenance. This balance uses `Decimal`, never mixes live power with cumulative energy, and inherits partial coverage. A negative balance, counter reset, missing total, or compatibility mismatch remains unavailable with a specific reason; it is never clamped to zero.

The signed-grid convention remains unchanged: positive is import and negative is export. Valid zero energy and zero calculated amounts remain available zero; missing values remain unavailable.

## Formulas and precision

All money arithmetic uses Python `Decimal`. Raw result strings retain calculation precision; the UI rounds euro display to two decimals.

```text
grid import cost = grid_import_kwh × grid_work_price_ct_per_kwh ÷ 100
feed-in remuneration = grid_export_kwh × feed_in_tariff_ct_per_kwh ÷ 100
direct self-consumption = pv_generation_kwh − grid_export_kwh
avoided grid cost = direct_self_consumption_kwh × grid_work_price_ct_per_kwh ÷ 100
solar economic value = avoided_grid_cost + feed_in_remuneration
net variable energy position = feed_in_remuneration − grid_import_cost + avoided_grid_cost
```

Only negative self-consumption within `0.000001 kWh` is treated as decimal noise and set to zero. A larger negative result is withheld as inconsistent. Annual base price is shown as tariff context but excluded from every economic formula because it remains payable independently of consumption. In the UI this is explained as: “Der Grundpreis bleibt unberücksichtigt, weil er unabhängig vom Verbrauch anfällt.”

## Coverage inheritance

- `complete`: at least 90% of the applicable evidence period is covered.
- `partial`: trustworthy evidence for only the captured interval; wording says “Wirtschaftlicher Solarwert im erfassten Zeitraum”. A guarded counter delta does not become sparse merely because the day began before its first observation.
- `sparse`: above 0% but below 50%; money is withheld in this foundation.
- `unavailable`: no suitable evidence or required component/tariff is absent.

There is no full-day, monthly, or annual extrapolation. Today exposes the captured period. Memory exposes economy only for its currently loaded Today range; other selectors explain that no trustworthy result is loaded rather than scaling the Today value.

Every report carries period/timezone, calculation timestamp, per-energy source and coverage, tariff source/validity/provisional state, formulas, reasons for withheld values, and the base-price exclusion. Rejection reasons distinguish unavailable PV, unavailable export, period mismatch, source mismatch, provenance mismatch, inconsistent PV/export totals, tariff gaps/boundaries, and generic calculation failure. The frontend presents the specific reason when one exists.

## UI behavior

Today and supported Memory show economic solar value, avoided cost, estimated feed-in remuneration, optional import cost, and coverage. Complete Today results say “Wirtschaftlicher Solarwert heute”; partial results say “Wirtschaftlicher Solarwert im erfassten Zeitraum”. Audit details are behind disclosure. A withheld result says “Für diesen Zeitraum ist keine belastbare Berechnung möglich” followed by its precise reason; it never displays 0 EUR for unknown.

Settings provides tariff-period create, edit, discard, and explicit delete. Base price has its own EUR/year input and remains optional. Every field has an accessible label. Existing light, dark, and system appearance behavior is unchanged. A provisional work price or feed-in tariff marks the dependent result as provisional; a provisional base price is visibly labeled in context but does not affect calculation confidence or arithmetic.

## Known limitations and exclusions

- Multi-day tariff-boundary allocation is withheld until energy is safely segmented.
- Memory economy beyond the loaded current day is not exposed yet.
- Provider historical totals are reserved in the hierarchy but not available separately from current collectors.
- Base price, taxes, bonuses, discounts, meter fees, contractual adjustments, and supplier rounding are not inferred.
- Calculations are estimates, not invoices; actual supplier/grid-operator settlements may differ.
- Unconfirmed feed-in rates remain provisional.

## Example fixture (not a default)

With compatible partial evidence of 6.12 kWh PV and 3.93 kWh export, a confirmed 34.00 ct/kWh work price, and a 12.00 ct/kWh feed-in rate: direct self-consumption is 2.19 kWh; avoided cost is 0.7446 EUR; estimated remuneration is 0.4716 EUR; economic solar value is 1.2162 EUR, displayed as 1.22 EUR for the captured interval. An example invoice base price of 120.00 EUR/year is context only and excluded. These values are test/documentation fixtures, not product defaults.
