import React from 'react';
import { EnergySnapshot } from '../../types';
import { NumberLocale, formatNumber } from '../../lib/format';

function kw(v: number | null, locale: NumberLocale): string {
  return v === null ? '—' : `${formatNumber(v, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kW`;
}

/**
 * Compact live-energy strip — "what is happening right now?" It is one slim row,
 * never the whole first viewport (the day's judgement sits below/beside it).
 */
export function LiveEnergyStrip({ snapshot, locale }: { snapshot: EnergySnapshot | undefined; locale: NumberLocale }) {
  const solar = snapshot?.solar?.origin === 'observed' ? snapshot.solar.valueKw : null;
  const home = snapshot?.homeLoad?.origin === 'observed' ? snapshot.homeLoad.valueKw : null;
  const gridKw = snapshot?.grid?.origin === 'observed' ? snapshot.grid.valueKw : null;
  const gridLabel = gridKw === null ? 'Netz' : gridKw >= 0 ? 'Netzbezug' : 'Einspeisung';
  const gridValue = gridKw === null ? null : Math.abs(gridKw);

  const quality = snapshot?.quality ?? 'unavailable';
  const status =
    quality === 'live' ? { label: 'Live', dot: 'bg-emerald-500' }
    : quality === 'stale' ? { label: 'Veraltet', dot: 'bg-amber-500' }
    : quality === 'error' ? { label: 'Nicht erreichbar', dot: 'bg-rose-500' }
    : { label: 'Keine Live-Daten', dot: 'bg-slate-400' };

  const items = [
    { label: 'PV', value: kw(solar, locale), testid: 'live-pv' },
    { label: 'Hausverbrauch', value: kw(home, locale), testid: 'live-home' },
    { label: gridLabel, value: kw(gridValue, locale), testid: 'live-grid' },
  ];

  return (
    <section aria-label="Aktueller Energiefluss" data-testid="live-energy-strip"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
        <span data-testid="live-status">{status.label}</span>
      </span>
      {items.map(item => (
        <span key={item.testid} data-testid={item.testid} className="inline-flex items-baseline gap-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400">{item.label}</span>
          <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{item.value}</span>
        </span>
      ))}
    </section>
  );
}
