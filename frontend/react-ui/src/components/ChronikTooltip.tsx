import React from 'react';
import { NumberLocale, formatNumber } from '../lib/format';
import { AggregatedBucket } from '../lib/chartAggregation';

/** Tooltip for one 15-minute interval. UI text in Plus Jakarta Sans, values in
 *  Barlow (font-data → tabular figures). */
export function ChronikTooltip({ active, payload, locale, cap }: {
  active?: boolean;
  payload?: Array<{ payload?: AggregatedBucket }>;
  locale: NumberLocale;
  cap: number;
}) {
  const b = payload?.[0]?.payload;
  if (!active || !b) return null;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const kw = (v: number | null) => (v === null ? '—' : `${formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kW`);
  const homePeak = b.homeMaxKw !== null && b.homeMaxKw > cap ? b.homeMaxKw : null;

  return (
    <div className="font-ui rounded-lg border border-slate-200/70 bg-white/95 px-3 py-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
      <p className="font-data font-semibold tabular-nums text-slate-800 dark:text-slate-100">{time(b.startMs)}–{time(b.endMs)}</p>
      <p className="mt-1.5"><span className="text-slate-500">Solar</span> <span className="font-data font-medium tabular-nums text-slate-800 dark:text-slate-100">{kw(b.solarKw)}{b.solarKw !== null ? ' Ø' : ''}</span></p>
      <p><span className="text-slate-500">Hausverbrauch</span> <span className="font-data font-medium tabular-nums text-slate-800 dark:text-slate-100">{kw(b.homeLoadKw)}{b.homeLoadKw !== null ? ' Ø' : ''}</span></p>
      {homePeak !== null && (
        <p className="text-slate-500">Peak <span className="font-data font-medium tabular-nums text-slate-700 dark:text-slate-200">{kw(homePeak)}</span></p>
      )}
      <p className="mt-1 text-slate-400">Datenstatus · {b.hasData ? 'Messwerte vorhanden' : 'Keine Messwerte'}</p>
    </div>
  );
}
