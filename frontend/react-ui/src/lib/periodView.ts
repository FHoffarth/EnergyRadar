import { PeriodReport } from '../types';

/**
 * Availability of an authoritative period result, as the Memory surface renders
 * it. The whole point is that "unavailable" — the only state that may say "keine
 * Messwerte" — is reached ONLY when there are no records, no summary and no
 * curve. Everything else is a distinct, honest partial state.
 */
export type PeriodAvailability = 'loading' | 'summary' | 'records_only' | 'unavailable';

export function classifyPeriod(report: PeriodReport | null, loading: boolean): PeriodAvailability {
  if (loading) return 'loading';
  if (!report) return 'unavailable';
  if (report.has_summary) return 'summary';
  if (report.has_records) return 'records_only';
  return 'unavailable';
}

export const PERIOD_METRICS: { key: keyof PeriodReport['metrics']; label: string }[] = [
  { key: 'pv_generation', label: 'Solarerzeugung' },
  { key: 'grid_import', label: 'Netzbezug' },
  { key: 'grid_export', label: 'Einspeisung' },
  { key: 'house_consumption', label: 'Hausverbrauch' },
];

/** Human provenance label — never a raw backend enum on the primary surface. */
export function provenanceLabel(provenance: string | null | undefined): string | null {
  switch (provenance) {
    case 'counter_anchors':
      return 'Synchronisierte Zählerstände';
    case 'stored_sample_counters':
      return 'Gespeicherte Zählerstände (eingeschränkte Genauigkeit)';
    case 'demo':
      return 'Demodaten';
    default:
      return null;
  }
}
