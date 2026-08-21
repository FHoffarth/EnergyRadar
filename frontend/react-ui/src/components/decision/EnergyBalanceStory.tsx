import React from 'react';
import { TodayData } from '../../types';
import { NumberLocale, formatEnergy } from '../../lib/format';

function val(state: { state: string; value?: number } | undefined): number | null {
  return state && state.state === 'available' && typeof state.value === 'number' ? state.value : null;
}

function Line({ value, label, dot, locale, testid }: { value: number | null; label: string; dot?: string; locale: NumberLocale; testid?: string }) {
  return (
    <li className="flex items-baseline gap-2 text-sm" data-testid={testid}>
      {dot && <span className={`h-2 w-2 shrink-0 self-center rounded-full ${dot}`} aria-hidden="true" />}
      <span className="min-w-[4.5rem] text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">
        {value !== null ? formatEnergy(value, locale) : '—'}
      </span>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
    </li>
  );
}

/** Solar side of the balance: PV generation → self-used / exported. */
export function SolarBalanceBlock({ data, locale, className }: { data: TodayData; locale: NumberLocale; className?: string }) {
  const generated = val(data.solarTotal);
  const exported = val(data.gridFeedInTotal);
  const selfConsumedPv = generated !== null && exported !== null ? Math.max(0, generated - exported) : null;
  return (
    <div className={className} data-testid="solar-balance">
      <p className="cockpit-eyebrow">Solarenergie</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="balance-generated">
        {generated !== null ? formatEnergy(generated, locale) : '—'}
        <span className="ml-1.5 text-sm font-normal text-slate-500">PV-Erzeugung</span>
      </p>
      <p className="mt-2 text-xs text-slate-400">davon</p>
      <ul className="mt-1 space-y-1">
        <Line value={selfConsumedPv} label="Solarstrom selbst genutzt" dot="bg-amber-500" locale={locale} testid="balance-selfused" />
        <Line value={exported} label="Einspeisung" dot="bg-emerald-500" locale={locale} />
      </ul>
    </div>
  );
}

/** House side of the balance: total consumption → covered by solar / grid. */
export function HouseBalanceBlock({ data, locale, className }: { data: TodayData; locale: NumberLocale; className?: string }) {
  const generated = val(data.solarTotal);
  const exported = val(data.gridFeedInTotal);
  const consumption = val(data.homeTotal);
  const imported = val(data.gridDrawTotal);
  const selfConsumedPv = generated !== null && exported !== null ? Math.max(0, generated - exported) : null;
  const selfConsumption = val(data.selfConsumption);
  return (
    <div className={className} data-testid="house-balance">
      <p className="cockpit-eyebrow">Haushalt</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="balance-consumed">
        {consumption !== null ? formatEnergy(consumption, locale) : '—'}
        <span className="ml-1.5 text-sm font-normal text-slate-500">Hausverbrauch gesamt</span>
      </p>
      <p className="mt-2 text-xs text-slate-400">gedeckt durch</p>
      <ul className="mt-1 space-y-1">
        <Line value={selfConsumedPv} label="Solarstrom" dot="bg-amber-500" locale={locale} />
        <Line value={imported} label="Netzbezug" dot="bg-indigo-400" locale={locale} />
      </ul>
      {selfConsumption !== null && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Eigenverbrauchsquote: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{selfConsumption} %</span>
        </p>
      )}
    </div>
  );
}

/**
 * The household's energy day as two grouped relationships. Kept as a wrapper for
 * standalone use/tests; the unified cockpit places the two blocks directly on the
 * shared 12-column grid so their axes align with Autarkie/Wetter above.
 */
export function EnergyBalanceStory({ data, locale }: { data: TodayData; locale: NumberLocale }) {
  return (
    <section aria-label="Energiebilanz des Tages" data-testid="energy-balance-story" className="grid gap-5 sm:grid-cols-2">
      <SolarBalanceBlock data={data} locale={locale} />
      <HouseBalanceBlock data={data} locale={locale} />
    </section>
  );
}
