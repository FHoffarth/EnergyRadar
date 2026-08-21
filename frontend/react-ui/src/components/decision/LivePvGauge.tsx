import React from 'react';
import { NumberLocale, formatNumber } from '../../lib/format';
import { LivePvState } from '../../lib/decisionView';

/**
 * Secondary live-PV / configured-kWp instrument. Subordinate to autonomy. Shown
 * only when capacity is configured; never infers capacity; night 0 W is standby,
 * not a fault.
 */
export function LivePvGauge({ powerKw, capacityKwp, state, locale }: {
  powerKw: number | null;
  capacityKwp: number | null;
  state: LivePvState;
  locale: NumberLocale;
}) {
  if (!capacityKwp || capacityKwp <= 0) return null;   // never infer capacity
  const ratio = state === 'live' && powerKw !== null
    ? Math.max(0, Math.min(100, Math.round((powerKw / capacityKwp) * 100)))
    : null;

  const detail =
    state === 'night' ? 'Nachtbetrieb · Aktuelle PV-Leistung pausiert'
    : state === 'stale' ? 'Letzter Wert · aktualisiert gleich'
    : state === 'unavailable' ? 'Aktuelle PV-Leistung nicht verfügbar'
    : null;

  return (
    <div data-testid="live-pv-gauge" data-state={state}
      className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
      <span className="text-xs uppercase tracking-wide text-slate-400">Aktuelle PV-Leistung</span>
      {state === 'live' && powerKw !== null ? (
        <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">
          {formatNumber(powerKw, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kW
          {' '}von {formatNumber(capacityKwp, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWp
          {ratio !== null && <span className="ml-1 text-slate-400">· {ratio} %</span>}
        </span>
      ) : (
        <span className="text-slate-500 dark:text-slate-400">{detail}</span>
      )}
    </div>
  );
}
