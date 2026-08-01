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
  const metrics = [
    ['Solar heute', energy(data.solarTotal, locale), 'text-amber-600 dark:text-amber-400'],
    ['Verbrauch heute', energy(data.homeTotal, locale), 'text-indigo-600 dark:text-indigo-400'],
    ['Netzbezug', energy(data.gridDrawTotal, locale), 'text-orange-600 dark:text-orange-400'],
    ['Einspeisung', energy(data.gridFeedInTotal, locale), 'text-emerald-600 dark:text-emerald-400'],
    ['Datenabdeckung', coverage.level === 'complete' ? 'Vollständig' : coverage.level === 'partial' ? 'Teilweise' : coverage.level === 'sparse' ? 'Wenige Daten' : UNKNOWN_VALUE, 'text-slate-700 dark:text-slate-200'],
  ];
  return (
    <section aria-label="Tagesübersicht" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {metrics.map(([label, value, color]) => (
        <div className="cockpit-surface-muted px-4 py-3" key={label}>
          <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
        </div>
      ))}
    </section>
  );
}
