import React from 'react';
import { EconomyReportData } from '../../types';
import { NumberLocale } from '../../lib/format';
import { economyHero, economyReasonCopy, economyReasonShort } from '../../lib/decisionView';

function euro(value: number, locale: NumberLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value);
}

/**
 * Economic value — co-equal Heute hero. Value-first: the strongest known euro
 * figure leads big; any missing part stays calm in the breakdown (never a red
 * error). Avoided cost may be called savings; feed-in and total never are.
 */
export function EconomicHero({ report, locale }: { report: EconomyReportData | null | undefined; locale: NumberLocale }) {
  const hero = economyHero(report);
  // The two components, in reading order. The primary (biggest known value)
  // is lifted out; the rest stay in the breakdown so nothing is shown twice.
  const components = [
    { key: 'avoided', label: 'Vermiedener Netzbezug', value: hero.avoided, reason: hero.avoidedReason },
    { key: 'feedIn', label: 'Einspeisevergütung', value: hero.feedIn, reason: hero.feedInReason },
  ] as const;
  const primaryComponent = hero.total === null ? components.find(c => c.value !== null) : undefined;
  const primary = hero.total !== null
    ? { value: hero.total, label: 'Gesamter Solarwert' }
    : primaryComponent
      ? { value: primaryComponent.value as number, label: primaryComponent.label }
      : null;
  const rest = components.filter(c => c.key !== primaryComponent?.key);

  return (
    <div data-testid="economic-hero" data-has-value={hero.anyValue}>
      <p className="cockpit-eyebrow">Wirtschaftlicher Solarwert</p>
      {primary ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-data text-4xl font-semibold tabular-nums text-slate-900 dark:text-white sm:text-5xl">
            {euro(primary.value, locale)}
          </span>
          <span className="text-sm font-normal text-slate-500">{primary.label}</span>
        </p>
      ) : (
        <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300" data-testid="economic-reason">
          {economyReasonCopy(hero.totalReason)}
        </p>
      )}

      {rest.length > 0 && (
        <dl className={`mt-4 grid gap-4 text-sm ${rest.length > 1 ? 'grid-cols-2' : ''}`}>
          {rest.map(c => (
            <div key={c.key}>
              <dt className="text-xs text-slate-500">{c.label}</dt>
              <dd className="mt-0.5 font-data font-medium tabular-nums text-slate-800 dark:text-slate-100">
                {c.value !== null ? euro(c.value, locale) : '—'}
              </dd>
              {c.value === null && (
                <dd className="mt-0.5 text-xs text-slate-400">{economyReasonShort(c.reason)}</dd>
              )}
            </div>
          ))}
        </dl>
      )}

      {hero.total !== null ? (
        <p className="mt-2 text-xs text-slate-400">Gesamtwert = vermiedener Netzbezug + Einspeisevergütung. Keine Prognose.</p>
      ) : primary ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="economic-partial">Noch nicht vollständig bewertbar.</p>
      ) : null}
    </div>
  );
}
