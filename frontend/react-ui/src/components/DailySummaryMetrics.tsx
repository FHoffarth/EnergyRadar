import React from 'react';
import { TodayData } from '../types';
import { NumberLocale, UNKNOWN_VALUE, formatNumber } from '../lib/format';
import { CoverageResult } from '../lib/storytelling';

/** Numeric part only; the unit is rendered subordinately by the caller. Null = unavailable. */
function energyNumber(state: TodayData['solarTotal'], locale: NumberLocale): string | null {
  return state.state === 'available' && Number.isFinite(state.value)
    ? formatNumber(state.value, locale, { maximumFractionDigits: 2 })
    : null;
}

/**
 * The day's evidence — the figures that quantify the assessment. A typographic
 * zone, not a grid of equal cards: labels are quiet, figures are the weight,
 * whitespace does the separating. Unavailable metrics stay in place with a
 * precise reason rather than vanishing or collapsing to zero.
 */
export function DailySummaryMetrics({ data, coverage, locale }: { data: TodayData; coverage: CoverageResult; locale: NumberLocale }) {
  const houseReasonCopy: Record<string, string> = {
    house_energy_period_mismatch: 'PV, Netzbezug und Einspeisung beziehen sich nicht auf denselben Zeitraum.',
    house_energy_source_mismatch: 'Die Energiesummen stammen aus nicht kompatiblen Messgrundlagen.',
    house_energy_provenance_mismatch: 'Die Energiesummen haben keine kompatible Datenherkunft.',
    house_energy_balance_negative: 'Die Energiebilanz ist negativ und damit nicht konsistent.',
    house_consumption_negative: 'Die Zählerbilanz ergibt einen negativen Verbrauch und ist nicht konsistent.',
    battery_free_topology_not_confirmed: 'Die Anlagenstruktur ist für diese Verbrauchsformel nicht bestätigt.',
    house_dependency_two_compatible_anchors_required: 'Für den Zeitraum sind zwei kompatible Zählerstände erforderlich.',
    house_dependency_grid_import_total_provider_unavailable: 'Der Netzzähler war zu einem erforderlichen Zeitpunkt nicht erreichbar.',
    house_dependency_pv_total_counter_epoch_changed: 'Der PV-Zähler wurde im Zeitraum zurückgesetzt oder ausgetauscht.',
  };
  const houseReason = data.homeTotal.state === 'available' || !data.homeTotalReason
    ? null
    : houseReasonCopy[data.homeTotalReason] ?? 'Mindestens eine erforderliche Energiesumme ist nicht belastbar.';

  const periodNote = coverage.level === 'complete' ? 'heute' : 'im erfassten Zeitraum';
  const metrics: Array<{ label: string; value: string | null; tone: string; reason?: string | null }> = [
    { label: 'Solarertrag', value: energyNumber(data.solarTotal, locale), tone: 'text-amber-600 dark:text-amber-400' },
    { label: 'Hausverbrauch', value: energyNumber(data.homeTotal, locale), tone: 'text-indigo-600 dark:text-indigo-300', reason: houseReason },
    { label: 'Netzbezug', value: energyNumber(data.gridDrawTotal, locale), tone: 'text-orange-600 dark:text-orange-400' },
    { label: 'Einspeisung', value: energyNumber(data.gridFeedInTotal, locale), tone: 'text-emerald-600 dark:text-emerald-400' },
  ];

  return (
    <section aria-label="Tagesbilanz">
      <p className="cockpit-eyebrow mb-3">Tagesbilanz · {periodNote}</p>
      <div className="evidence-zone">
        {metrics.map(metric => (
          <div className="evidence-item" key={metric.label}>
            <p className="evidence-item__label">{metric.label}</p>
            {metric.value === null ? (
              <p className="evidence-item__value tabular-nums text-slate-500 dark:text-slate-500">{UNKNOWN_VALUE}</p>
            ) : (
              <p className={`evidence-item__value tabular-nums ${metric.tone}`}>{metric.value}<span className="metric-unit">kWh</span></p>
            )}
            {metric.reason && <p className="evidence-item__reason">{metric.reason}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
