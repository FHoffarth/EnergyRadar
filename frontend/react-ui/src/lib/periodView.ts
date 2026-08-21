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
    case 'fronius_local_archive':
      return 'Solarertrag vom Fronius-Datalogger bestätigt';
    case 'demo':
      return 'Demodaten';
    default:
      return null;
  }
}

/**
 * Top-level Memory availability status, derived from the authoritative report so
 * it can never contradict the summary/curve below (no false "Nicht verfügbar").
 */
export function memoryTopStatus(
  report: PeriodReport | null,
  loading: boolean,
): { label: string; unavailable: boolean } {
  if (!report) {
    return loading
      ? { label: 'Zeitraum wird geladen …', unavailable: false }
      : { label: 'Nicht verfügbar', unavailable: true };
  }
  const source = report.curve?.source;
  if (source === 'mixed') return { label: 'Lokale Aufzeichnung ergänzt durch Fronius-Datalogger', unavailable: false };
  if (source === 'fronius_archive') return { label: 'Verlauf aus dem Fronius-Datalogger verfügbar', unavailable: false };
  if (report.has_curve && report.has_summary) return { label: 'Vollständig verfügbar', unavailable: false };
  if (report.has_summary || report.has_curve || report.has_records) return { label: 'Teilweise verfügbar', unavailable: false };
  return { label: 'Nicht verfügbar', unavailable: true };
}

/** Precise curve-source wording (§11). Empty string when there is no curve. */
export function curveSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'local':
      return 'Verlauf aus lokaler Aufzeichnung';
    case 'fronius_archive':
      return 'Verlauf aus dem Fronius-Datalogger';
    case 'mixed':
      return 'Gemischter Verlauf aus lokaler Aufzeichnung und Fronius-Datalogger';
    default:
      return '';
  }
}
