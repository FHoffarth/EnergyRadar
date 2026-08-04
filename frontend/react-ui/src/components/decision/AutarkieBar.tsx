import React from 'react';
import { NumberLocale, formatEnergy } from '../../lib/format';

/**
 * Horizontal autonomy bar (Variante B) — lower height than the semicircle, faster
 * to read, mobile-friendly, and it explains the number directly (Solar vs Netz).
 * Accessible as a meter; the split is named in text, never colour-only.
 */
export function AutarkieBar({ pct, solarKwh, gridKwh, locale }: {
  pct: number | null;
  solarKwh: number | null;
  gridKwh: number | null;
  locale: NumberLocale;
}) {
  const known = pct !== null && Number.isFinite(pct);
  const clamped = known ? Math.max(0, Math.min(100, pct as number)) : 0;
  const gridPct = known ? 100 - clamped : 0;

  return (
    <section aria-label="Autarkie heute" data-testid="autarkie-bar" data-known={known}>
      <p className="cockpit-eyebrow">Autarkie heute</p>
      {known ? (
        <>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {clamped}<span className="ml-0.5 text-2xl font-normal text-amber-500/70">%</span>
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">solar gedeckt</span>
          </p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            role="meter" aria-label="Autarkiegrad" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}
            aria-valuetext={`${clamped} Prozent solar, ${gridPct} Prozent aus dem Netz`}>
            <div className="h-full bg-amber-500 dark:bg-amber-400" style={{ width: `${clamped}%` }} />
            <div className="h-full bg-indigo-400/70 dark:bg-indigo-500/70" style={{ width: `${gridPct}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />Solar selbst genutzt
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums text-slate-800 dark:text-slate-100">
                {solarKwh !== null ? formatEnergy(solarKwh, locale) : '—'}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full bg-indigo-400" aria-hidden="true" />Netzbezug
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums text-slate-800 dark:text-slate-100">
                {gridKwh !== null ? formatEnergy(gridKwh, locale) : '—'}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-1 text-lg font-medium text-slate-500 dark:text-slate-400">Nicht bewertbar</p>
      )}
    </section>
  );
}
