import React from 'react';
import { TodayData } from '../../types';
import { NumberLocale, formatEnergy } from '../../lib/format';

function val(state: { state: string; value?: number } | undefined): number | null {
  return state && state.state === 'available' && typeof state.value === 'number' ? state.value : null;
}

/**
 * The household's energy day as a readable story rather than an equal-card grid.
 * Only compatible period values; a missing value stays "—" (never invented).
 */
export function EnergyBalanceStory({ data, locale }: { data: TodayData; locale: NumberLocale }) {
  const rows: { label: string; value: number | null; testid: string }[] = [
    { label: 'erzeugt', value: val(data.solarTotal), testid: 'balance-generated' },
    { label: 'im Haus genutzt', value: val(data.homeTotal), testid: 'balance-consumed' },
    { label: 'eingespeist', value: val(data.gridFeedInTotal), testid: 'balance-export' },
    { label: 'aus dem Netz bezogen', value: val(data.gridDrawTotal), testid: 'balance-import' },
  ];
  const selfConsumption = val(data.selfConsumption);

  return (
    <section aria-label="Energiebilanz des Tages" data-testid="energy-balance-story">
      <p className="cockpit-eyebrow">Energiebilanz</p>
      <ul className="mt-2 space-y-1.5">
        {rows.map(row => (
          <li key={row.testid} data-testid={row.testid} className="flex items-baseline gap-2 text-base">
            <span className="min-w-[5.5rem] text-right font-semibold tabular-nums text-slate-900 dark:text-white">
              {row.value !== null ? formatEnergy(row.value, locale) : '—'}
            </span>
            <span className="text-slate-600 dark:text-slate-300">{row.label}</span>
          </li>
        ))}
      </ul>
      {selfConsumption !== null && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Eigenverbrauchsquote: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{selfConsumption} %</span>
          {' '}der erzeugten Solarenergie blieb im Haus.
        </p>
      )}
    </section>
  );
}
