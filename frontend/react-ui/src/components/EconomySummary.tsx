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

const rejectionCopy: Record<string, string> = {
  solar_energy_unavailable_or_sparse: 'Für den erfassten Zeitraum fehlt eine belastbare PV-Energiemenge.',
  grid_export_energy_unavailable_or_sparse: 'Für den erfassten Zeitraum fehlt eine belastbare Einspeisemenge.',
  energy_period_mismatch: 'PV-Erzeugung und Einspeisung beziehen sich nicht auf denselben erfassten Zeitraum.',
  energy_source_mismatch: 'PV-Erzeugung und Einspeisung stammen aus nicht kompatiblen Messgrundlagen.',
  energy_provenance_mismatch: 'PV-Erzeugung und Einspeisung haben keine kompatible Datenherkunft.',
  pv_lower_than_export: 'Die Einspeisung ist größer als die erfasste PV-Erzeugung; die Messwerte sind nicht konsistent.',
  grid_tariff_missing_or_boundary: 'Der Strombezugspreis ist nicht für den gesamten erfassten Zeitraum bestätigt.',
  feed_in_tariff_missing_or_boundary: 'Der Einspeisetarif ist nicht für den gesamten erfassten Zeitraum bestätigt.',
  energy_unavailable_or_sparse: 'Für den erfassten Zeitraum fehlt eine belastbare Energiemenge.',
  required_component_unavailable: 'Mindestens ein erforderlicher Berechnungswert ist nicht verfügbar.',
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
  const rejectionReason = total?.reason ?? report?.reason ?? 'required_component_unavailable';
  const title = partial
    ? 'Wirtschaftlicher Solarwert im erfassten Zeitraum'
    : scope === 'today'
      ? 'Wirtschaftlicher Solarwert heute'
      : 'Wirtschaftlicher Solarwert';

  return (
    <section className="cockpit-surface my-5 p-5 lg:p-6" aria-labelledby={`economy-title-${scope}`} data-testid="economy-summary">
      <p className="cockpit-eyebrow">Solar Economy</p>
      <h2 id={`economy-title-${scope}`} className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
        {title}
      </h2>
      {available ? (
        <>
          <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{euros(total.value_eur, locale)}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {partial ? 'Keine Hochrechnung auf nicht erfasste Zeiträume.' : 'Geschätzter wirtschaftlicher Solarwert im erfassten Zeitraum.'}
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
          <p className="mt-1 text-xs text-slate-500">{rejectionCopy[rejectionReason] ?? `Berechnungsgrund: ${rejectionReason}`}</p>
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
          <p>Der Grundpreis bleibt unberücksichtigt, weil er unabhängig vom Verbrauch anfällt.</p>
          <p>Formel Solarwert: vermiedene Stromkosten + geschätzte Einspeisevergütung.</p>
          {report?.calculated_at && <p>Berechnet am: {new Date(report.calculated_at).toLocaleString(locale)}</p>}
          <dl className="grid gap-2 sm:grid-cols-2">
            {(['grid_work_price', 'feed_in_tariff', 'base_price'] as const).map(type => {
              const tariff = report?.tariffs?.[type];
              const label = type === 'grid_work_price' ? 'Strombezugspreis' : type === 'feed_in_tariff' ? 'Einspeisetarif' : 'Grundpreis (nur Kontext)';
              const amount = type === 'base_price' ? `${tariff?.annual_eur} €/Jahr` : `${tariff?.value_ct_per_kwh} ct/kWh`;
              const missing = type === 'base_price' ? 'Optional – nicht hinterlegt' : 'Nicht für den gesamten Zeitraum bestätigt';
              return <div key={type}><dt>{label}</dt><dd>{tariff ? `${amount} · ${sourceCopy[tariff.source_type] ?? 'angegebene Quelle'} · gültig ab ${tariff.valid_from}${tariff.valid_until ? ` bis ${tariff.valid_until}` : ''}${tariff.provisional ? ' · vorläufig' : ''}` : missing}</dd></div>;
            })}
          </dl>
        </div>
      </details>
    </section>
  );
}
