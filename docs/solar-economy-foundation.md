# Solar Economy foundation

## Purpose and trust boundary

Solar Economy translates recorded energy into cautious economic estimates. The order is fixed: measured energy, user-confirmed tariff, deterministic calculation, then interpretation. Results are estimates, not invoices, guaranteed savings, actual payouts, or profit. Supplier and grid-operator settlements can differ. EnergyRadar does not infer taxes, contractual adjustments, or tariffs from installation age.

The German product terms are **Netzbezugskosten**, **vermiedene Stromkosten**, **geschätzte Einspeisevergütung**, **wirtschaftlicher Solarwert**, and **variable Energieposition**. The last term is feed-in remuneration minus grid-import cost plus avoided grid cost; it is not profit.

## Tariff history (schema v4)

Migration v4 adds `tariff_periods` without rewriting energy history. Monetary decimals are stored as canonical `TEXT`, preventing conversion to binary floating point. Each record has an ID, tariff type, either `value_ct_per_kwh` or `annual_eur`, inclusive `valid_from` and optional inclusive `valid_until`, optional label, source type, provisional flag, and UTC creation/update timestamps.

Supported types are `grid_work_price`, `feed_in_tariff`, and `base_price`. Validity dates are inclusive: 31 March followed by 1 April is adjacent. Two records of the same type may not share a valid date. Create and update check overlap while holding a SQLite write reservation. Missing validity is unavailable, never zero. A selected period spanning multiple rates is withheld unless energy is safely segmented by tariff validity; rates are never blended silently.

No personal tariff is a default. The fixture values 34.00 ct/kWh, 120 EUR/year, `ENTEGA Ökostrom fix 24`, and supplied contract dates occur only in tests/examples. Feed-in remuneration remains unconfirmed until entered. A provisional entry is labeled “Vorläufiger Wert – noch nicht durch Abrechnung bestätigt” and makes dependent presentation provisional.

## Energy-source audit and hierarchy

Each economic energy quantity records provenance and coverage:

1. non-negative cumulative counter delta for the selected period;
2. trusted provider energy total (reserved; no separate current historical source);
3. trapezoidal power integration only with at least 50% coverage and no interval beyond the existing five-minute gap limit;
4. unavailable.

Negative deltas and resets are rejected. Covered power integration can be an explicit fallback and is identified as `integrated_power_history`; sparse integration is not used. PV and export are combined for direct self-consumption only when source class and period key match. Counter-based PV is never silently mixed with integrated export. Derived house power is not an economic energy source.

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

Only negative self-consumption within `0.000001 kWh` is treated as decimal noise and set to zero. A larger negative result is withheld as inconsistent. Annual base price is shown as context but excluded from avoided cost because it remains payable independently of consumption.

## Coverage inheritance

- `complete`: at least 90% of elapsed period is covered.
- `partial`: 50% to below 90%; wording says “Wert im erfassten Zeitraum”.
- `sparse`: above 0% but below 50%; money is withheld in this foundation.
- `unavailable`: no suitable evidence or required component/tariff is absent.

There is no full-day, monthly, or annual extrapolation. Today exposes the captured period. Memory exposes economy only for its currently loaded Today range; other selectors explain that no trustworthy result is loaded rather than scaling the Today value.

Every report carries period/timezone, calculation timestamp, per-energy source and coverage, tariff source/validity/provisional state, formulas, reasons for withheld values, and the base-price exclusion.

## UI behavior

Today and supported Memory show economic solar value, avoided cost, estimated feed-in remuneration, import cost, and coverage. Audit details are behind disclosure. Missing energy or tariff data says “Für diesen Zeitraum ist keine belastbare Berechnung möglich”; it never displays 0 EUR for unknown.

Settings provides tariff-period create, edit, discard, and explicit delete. Every field has an accessible label. Existing light, dark, and system appearance behavior is unchanged.

## Known limitations and exclusions

- Multi-day tariff-boundary allocation is withheld until energy is safely segmented.
- Memory economy beyond the loaded current day is not exposed yet.
- Provider historical totals are reserved in the hierarchy but not available separately from current collectors.
- Base price, taxes, bonuses, discounts, meter fees, contractual adjustments, and supplier rounding are not inferred.
- Calculations are estimates, not invoices; actual supplier/grid-operator settlements may differ.
- Unconfirmed feed-in rates remain provisional.

## Example fixture (not a default)

With compatible complete evidence of 3.2 kWh PV, 1.4 kWh export, 2.0 kWh import, a confirmed 34.00 ct/kWh work price, and a provisional 12.00 ct/kWh feed-in rate: direct self-consumption is 1.8 kWh; avoided cost is 0.612 EUR; estimated remuneration is 0.168 EUR; economic solar value is 0.780 EUR (displayed as 0.78 EUR and provisional); import cost is 0.680 EUR. The annual base price is excluded.
