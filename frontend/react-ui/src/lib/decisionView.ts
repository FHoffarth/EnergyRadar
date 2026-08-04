import { DailyAssessment, EconomyReportData } from '../types';

/** Verdict accent tone per class (colour is never the only signal — text carries it). */
export function verdictTone(cls: DailyAssessment['assessment_class']): string {
  switch (cls) {
    case 'excellent': return 'text-emerald-700 dark:text-emerald-400';
    case 'strong': return 'text-sky-700 dark:text-sky-400';
    case 'balanced': return 'text-slate-700 dark:text-slate-200';
    case 'grid_dependent': return 'text-amber-700 dark:text-amber-400';
    default: return 'text-slate-500 dark:text-slate-400';
  }
}

/** Precise German copy for an economy reason code — never a raw enum on the surface. */
export function economyReasonCopy(reason: string | null | undefined): string {
  switch (reason) {
    case 'grid_tariff_missing_or_boundary':
      return 'Eine wirtschaftliche Bewertung ist noch nicht möglich, weil kein gültiger Stromtarif hinterlegt ist.';
    case 'feed_in_tariff_missing_or_boundary':
      return 'Für die Einspeisevergütung fehlt ein gültiger Tarif.';
    case 'energy_unavailable_or_sparse':
      return 'Die Energiemengen für diesen Zeitraum sind noch nicht belastbar.';
    case 'pv_lower_than_export':
      return 'Solar- und Einspeisedaten sind für diesen Zeitraum nicht vergleichbar.';
    case 'required_component_unavailable':
      return 'Für eine vollständige Bewertung fehlt noch eine Teilgröße.';
    default:
      return 'Für diesen Zeitraum liegt noch keine belastbare wirtschaftliche Bewertung vor.';
  }
}

export interface EconomyHero {
  total: number | null;       // total solar value (avoided + feed-in), EUR
  avoided: number | null;     // avoided grid purchase (may be called savings)
  feedIn: number | null;      // feed-in remuneration (NOT savings)
  totalReason: string | null;
  avoidedReason: string | null;
  feedInReason: string | null;
  anyValue: boolean;
}

function eur(entry: any): number | null {
  const v = entry?.value_eur;
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Extract the economic hero figures + precise reasons from the economy payload. */
export function economyHero(report: EconomyReportData | null | undefined): EconomyHero {
  const r = report?.results as any;
  const total = eur(r?.solar_economic_value);
  const avoided = eur(r?.avoided_grid_cost);
  const feedIn = eur(r?.feed_in_remuneration);
  return {
    total, avoided, feedIn,
    totalReason: total === null ? (r?.solar_economic_value?.reason ?? report?.reason ?? null) : null,
    avoidedReason: avoided === null ? (r?.avoided_grid_cost?.reason ?? null) : null,
    feedInReason: feedIn === null ? (r?.feed_in_remuneration?.reason ?? null) : null,
    anyValue: total !== null || avoided !== null || feedIn !== null,
  };
}

export type LivePvState = 'live' | 'night' | 'stale' | 'unavailable';

/** Secondary live-PV gauge state. Night uses a conservative local clock window
 *  (mirrors the approved decision.inverter_status clock fallback) so 0 W at night
 *  is standby, never a fault. */
export function livePvState(
  powerKw: number | null,
  origin: string | undefined,
  quality: string | undefined,
  now: Date,
): LivePvState {
  if (quality === 'stale') return 'stale';
  if (origin === 'observed' && powerKw !== null) return 'live';
  const hour = now.getHours();
  const isNight = hour >= 22 || hour < 5;
  if (isNight) return 'night';
  return 'unavailable';
}
