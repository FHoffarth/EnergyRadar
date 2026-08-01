import React from 'react';
import { NumberLocale } from '../lib/format';
import { energyTooltipRows } from '../lib/energyContext';
import { TimelineEntry } from '../types';

export function EnergyChartTooltip({ active, label, payload, locale }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload?: TimelineEntry }>;
  locale: NumberLocale;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const rows = energyTooltipRows(payload[0].payload, locale);
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {label && <p className="mb-1.5 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{label}</p>}
      {rows.map(row => <p key={row.label}><span className="text-slate-500">{row.label}: </span><span className="font-medium tabular-nums">{row.value}</span></p>)}
    </div>
  );
}
