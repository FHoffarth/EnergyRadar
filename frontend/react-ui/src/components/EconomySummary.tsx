import React from 'react';
import { EconomyReportData } from '../types';
import { NumberLocale } from '../lib/format';

function euros(raw: string | null | undefined, locale: NumberLocale): string {
  if (raw == null) return 'Nicht verfügbar';
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Nicht verfügbar';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

const coverageCopy = {
  complete: 'vollständig',
  partial: 'teilweise',
  sparse: 'nur eingeschränkt aussagekräftig',
  unavailable: 'nicht verfügbar',
};

const sourceCopy: Record<string, string> = {
  user_entry: 'eigene Eingabe', invoice: 'Abrechnung', contract: 'Vertrag', other: 'andere Quelle',
  grid_operator_statement: 'Netzbetreiber-Mitteilung', feed_in_invoice: 'Einspeiseabrechnung',
  provisional_user_assumption: 'vorläufige eigene Annahme',
};

export function EconomySummary({ report, locale, scope = 'today' }: {
  report?: EconomyReportData | null;
  locale: NumberLocale;
  scope?: 'today' | 'memory';
}) {
  const total = report?.results?.solar_economic_value;
  const available = total?.value_eur != null;
  const partial = report?.coverage_state === 'partial';
  const provisional = Boolean(report?.provisional);

  return (
    <section className="cockpit-surface my-5 p-5 lg:p-6" aria-labelledby={`economy-title-${scope}`} data-testid="economy-summary">
      <p className="cockpit-eyebrow">Solar Economy</p>
      <h2 id={`economy-title-${scope}`} className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">Wirtschaftlicher Solarwert</h2>
      {available ? (
        <>
          <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{euros(total.value_eur, locale)}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {partial ? 'Geschätzter Wert im erfassten Zeitraum.' : 'Geschätzter wirtschaftlicher Solarwert im erfassten Zeitraum.'}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="cockpit-surface-muted p-3"><dt className="text-xs text-slate-500">Vermiedene Stromkosten</dt><dd className="mt-1 font-semibold">{euros(report?.results?.avoided_grid_cost?.value_eur, locale)}</dd></div>
            <div className="cockpit-surface-muted p-3"><dt className="text-xs text-slate-500">Geschätzte Einspeisevergütung</dt><dd className="mt-1 font-semibold">{euros(report?.results?.feed_in_remuneration?.value_eur, locale)}</dd></div>
            <div className="cockpit-surface-muted p-3"><dt className="text-xs text-slate-500">Netzbezugskosten</dt><dd className="mt-1 font-semibold">{euros(report?.results?.grid_import_cost?.value_eur, locale)}</dd></div>
          </dl>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          Für diesen Zeitraum ist keine belastbare Berechnung möglich.
          <p className="mt-1 text-xs text-slate-500">Fehlende Mess- oder Tarifdaten werden nicht als 0 € behandelt.</p>
        </div>
      )}
      {provisional && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Vorläufiger Wert – noch nicht durch Abrechnung bestätigt.
        </p>
      )}
      <p className="mt-4 text-xs text-slate-500">Datenabdeckung: {coverageCopy[report?.coverage_state ?? 'unavailable']}. Die Berechnung ist eine Schätzung, keine Abrechnung.</p>
      <details className="mt-4 text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium">Berechnungsdetails</summary>
        <div className="mt-3 space-y-2 text-xs">
          <p>Dieser Betrag setzt sich aus vermiedenen Stromkosten und geschätzter Einspeisevergütung zusammen.</p>
          <p>Direkter Eigenverbrauch: PV-Erzeugung minus Einspeisung – nur bei kompatibler Messgrundlage.</p>
          <p>Grundpreise bleiben unberücksichtigt, weil sie unabhängig vom Verbrauch weiter anfallen.</p>
          <p>Formel Solarwert: vermiedene Stromkosten + geschätzte Einspeisevergütung.</p>
          {report?.calculated_at && <p>Berechnet am: {new Date(report.calculated_at).toLocaleString(locale)}</p>}
          <dl className="grid gap-2 sm:grid-cols-2">
            {(['grid_work_price', 'feed_in_tariff'] as const).map(type => {
              const tariff = report?.tariffs?.[type];
              return <div key={type}><dt>{type === 'grid_work_price' ? 'Strombezugspreis' : 'Einspeisetarif'}</dt><dd>{tariff ? `${tariff.value_ct_per_kwh} ct/kWh · ${sourceCopy[tariff.source_type] ?? 'angegebene Quelle'} · gültig ab ${tariff.valid_from}${tariff.valid_until ? ` bis ${tariff.valid_until}` : ''}` : 'Nicht für den gesamten Zeitraum bestätigt'}</dd></div>;
            })}
          </dl>
        </div>
      </details>
    </section>
  );
}
