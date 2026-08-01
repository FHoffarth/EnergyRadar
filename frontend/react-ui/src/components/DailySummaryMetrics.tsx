import React from 'react';
import { TodayData } from '../types';
import { NumberLocale, UNKNOWN_VALUE, formatNumber } from '../lib/format';
import { CoverageResult } from '../lib/storytelling';

function energy(state: TodayData['solarTotal'], locale: NumberLocale): string {
  return state.state === 'available' && Number.isFinite(state.value)
    ? `${formatNumber(state.value, locale, { maximumFractionDigits: 2 })} kWh`
    : UNKNOWN_VALUE;
}

export function DailySummaryMetrics({ data, coverage, locale }: { data: TodayData; coverage: CoverageResult; locale: NumberLocale }) {
  const complete = coverage.level === 'complete';
  const periodLabel = (daily: string, captured: string) => complete ? daily : captured;
  const houseReasonCopy: Record<string, string> = {
    house_energy_period_mismatch: 'PV, Netzbezug und Einspeisung beziehen sich nicht auf denselben Zeitraum.',
    house_energy_source_mismatch: 'Die Energiesummen stammen aus nicht kompatiblen Messgrundlagen.',
    house_energy_provenance_mismatch: 'Die Energiesummen haben keine kompatible Datenherkunft.',
    house_energy_balance_negative: 'Die Energiebilanz ist negativ und damit nicht konsistent.',
  };
  const houseReason = data.homeTotal.state === 'available' || !data.homeTotalReason
    ? null
    : houseReasonCopy[data.homeTotalReason] ?? 'Mindestens eine erforderliche Energiesumme ist nicht belastbar.';
  const metrics = [
    [periodLabel('Solar heute', 'Solar im erfassten Zeitraum'), energy(data.solarTotal, locale), 'text-amber-600 dark:text-amber-400'],
    [periodLabel('Verbrauch heute', 'Verbrauch im erfassten Zeitraum'), energy(data.homeTotal, locale), 'text-indigo-600 dark:text-indigo-400', houseReason],
    [periodLabel('Netzbezug heute', 'Netzbezug im erfassten Zeitraum'), energy(data.gridDrawTotal, locale), 'text-orange-600 dark:text-orange-400'],
    [periodLabel('Einspeisung heute', 'Einspeisung im erfassten Zeitraum'), energy(data.gridFeedInTotal, locale), 'text-emerald-600 dark:text-emerald-400'],
    ['Datenabdeckung', coverage.level === 'complete' ? 'Vollständig' : coverage.level === 'partial' ? 'Teilweise' : coverage.level === 'sparse' ? 'Wenige Daten' : UNKNOWN_VALUE, 'text-slate-700 dark:text-slate-200'],
  ];
  return (
    <section aria-label="Tagesübersicht" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {metrics.map(([label, value, color, reason]) => (
        <div className="cockpit-surface-muted px-4 py-3" key={label}>
          <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
          {reason && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{reason}</p>}
        </div>
      ))}
    </section>
  );
}
