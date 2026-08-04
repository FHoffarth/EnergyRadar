import React from 'react';
import { EconomyReportData } from '../../types';
import { NumberLocale } from '../../lib/format';
import { economyHero, economyReasonCopy } from '../../lib/decisionView';

function euro(value: number, locale: NumberLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value);
}

/**
 * Economic value — co-equal Heute hero. Avoided cost may be called savings;
 * feed-in and total never are. Precise reason when a component is missing.
 */
export function EconomicHero({ report, locale }: { report: EconomyReportData | null | undefined; locale: NumberLocale }) {
  const hero = economyHero(report);
  return (
    <div data-testid="economic-hero" data-has-value={hero.anyValue}>
      <p className="cockpit-eyebrow">Wirtschaftlicher Solarwert</p>
      {hero.total !== null ? (
        <p className="mt-1 text-4xl font-semibold tabular-nums text-slate-900 dark:text-white sm:text-5xl">
          {euro(hero.total, locale)}
        </p>
      ) : (
        <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-300" data-testid="economic-reason">
          {economyReasonCopy(hero.totalReason)}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Vermiedener Netzbezug (Ersparnis)</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-slate-800 dark:text-slate-100">
            {hero.avoided !== null ? euro(hero.avoided, locale) : '—'}
          </dd>
          {hero.avoided === null && hero.avoidedReason && (
            <dd className="mt-0.5 text-xs text-slate-500">{economyReasonCopy(hero.avoidedReason)}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-slate-500">Einspeisevergütung</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-slate-800 dark:text-slate-100">
            {hero.feedIn !== null ? euro(hero.feedIn, locale) : '—'}
          </dd>
          {hero.feedIn === null && hero.feedInReason && (
            <dd className="mt-0.5 text-xs text-slate-500">{economyReasonCopy(hero.feedInReason)}</dd>
          )}
        </div>
      </dl>
      {hero.total !== null && (
        <p className="mt-2 text-xs text-slate-400">Gesamtwert = vermiedener Netzbezug + Einspeisevergütung. Keine Prognose.</p>
      )}
    </div>
  );
}
