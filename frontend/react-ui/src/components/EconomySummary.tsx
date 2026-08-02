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
  two_compatible_anchors_required: 'Für den Zeitraum sind zwei kompatible Zählerstände erforderlich.',
  pv_total_anchor_missing: 'An mindestens einer Zeitraumgrenze fehlt der PV-Gesamtzähler.',
  grid_export_total_anchor_missing: 'An mindestens einer Zeitraumgrenze fehlt der Einspeisezähler.',
  pv_total_provider_unavailable: 'Der Wechselrichter war an einer erforderlichen Zeitraumgrenze nicht erreichbar.',
  grid_export_total_provider_unavailable: 'Der Netzzähler war an einer erforderlichen Zeitraumgrenze nicht erreichbar.',
  pv_total_counter_epoch_changed: 'Der PV-Zähler wurde im Zeitraum zurückgesetzt oder ausgetauscht.',
  grid_export_total_counter_epoch_changed: 'Der Einspeisezähler wurde im Zeitraum zurückgesetzt oder ausgetauscht.',
  pv_total_source_identity_changed: 'Die PV-Zählerwerte stammen nicht von derselben Quelle.',
  grid_export_total_source_identity_changed: 'Die Einspeisezählerwerte stammen nicht von derselben Quelle.',
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

  // 1 — a calm human verdict, never profit/earnings/payout/ROI language.
  const verdict = !available
    ? 'Für diesen Zeitraum ist keine belastbare Berechnung möglich.'
    : partial
      ? 'Im bisher erfassten Zeitraum hat deine Solaranlage einen wirtschaftlichen Wert erzeugt.'
      : scope === 'today'
        ? 'Heute hat deine Solaranlage einen wirtschaftlichen Wert erzeugt.'
        : 'Deine Solaranlage hat einen wirtschaftlichen Wert erzeugt.';

  return (
    <section className="max-w-3xl" aria-labelledby={`economy-title-${scope}`} data-testid="economy-summary">
      <p className="cockpit-eyebrow">Solar Economy</p>
      {/* 1 — verdict */}
      <h3 id={`economy-title-${scope}`} className="mt-2 text-lg font-medium text-slate-800 dark:text-slate-100">
        {verdict}
      </h3>
      {available ? (
        <>
          {/* 2 — economic value: the strongest figure */}
          <p className={`economy-value tabular-nums mt-3 ${provisional ? 'economy-value--soft' : 'text-slate-900 dark:text-white'}`}>
            {euros(total.value_eur, locale)}
            {provisional && <span className="economy-tag">vorläufig</span>}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {partial ? 'Keine Hochrechnung auf nicht erfasste Zeiträume.' : 'Geschätzter Solarwert, keine Abrechnung.'}
          </p>

          {/* 3 — evidence breakdown, flat: measured avoided cost, softer estimated remuneration */}
          <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Vermiedene Stromkosten</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{euros(report?.results?.avoided_grid_cost?.value_eur, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Geschätzte Einspeisevergütung</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums text-slate-500 dark:text-slate-400">{euros(report?.results?.feed_in_remuneration?.value_eur, locale)}</dd>
            </div>
          </dl>

          {provisional && (
            <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">Vorläufiger Wert – noch nicht durch Abrechnung bestätigt.</p>
          )}

          {/* 4 — data confidence / period context */}
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Datenabdeckung: {coverageCopy[report?.coverage_state ?? 'unavailable']}. Die Berechnung ist eine Schätzung, keine Abrechnung.
          </p>
        </>
      ) : (
        /* Unavailable: one concise verdict (above) and the precise reason — no large empty panel. */
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{rejectionCopy[rejectionReason] ?? 'Mindestens ein erforderlicher Wert ist für diesen Zeitraum nicht belastbar.'}</p>
      )}
      {/* 5 — technical details behind disclosure */}
      <details className="mt-4 text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium">Berechnungsdetails</summary>
        <div className="mt-3 space-y-2 text-xs">
          {!available && <p className="break-all opacity-70">Berechnungsgrund (technisch): {rejectionReason}</p>}
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
