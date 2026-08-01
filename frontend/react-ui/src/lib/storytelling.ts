import { EnergySnapshot, TimelineEntry } from '../types';
import { gapThresholdMs, timelineTimeMs } from './timelineIntegrity';

export type CoverageLevel = 'complete' | 'partial' | 'sparse' | 'unavailable';

export interface CoverageResult {
  level: CoverageLevel;
  measuredPoints: number;
  gapCount: number;
  firstTime: string | null;
  lastTime: string | null;
}

export interface CoverageOptions {
  /** Configured collector cadence. Never inferred from observed samples. */
  expectedCadenceSeconds?: number;
  expectedStartMs?: number;
  expectedEndMs?: number;
  /** Fewer measured samples cannot support continuity or peak claims. */
  sparseThreshold?: number;
}

export function hasMeasurement(point: TimelineEntry): boolean {
  return [point.solarKw, point.homeLoadKw, point.gridKw]
    .some(value => typeof value === 'number' && Number.isFinite(value));
}

export function evaluateCoverage(
  timeline: TimelineEntry[],
  options: CoverageOptions = {},
): CoverageResult {
  const expectedCadenceSeconds = options.expectedCadenceSeconds ?? 5;
  const sparseThreshold = options.sparseThreshold ?? 4;
  const measured = timeline
    .filter(hasMeasurement)
    .map((point, index) => ({ point, index, timestampMs: timelineTimeMs(point) }))
    .filter((entry): entry is { point: TimelineEntry; index: number; timestampMs: number } => entry.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index);
  if (!measured.length) return { level: 'unavailable', measuredPoints: 0, gapCount: 0, firstTime: null, lastTime: null };
  const uniqueTimes = [...new Set(measured.map(entry => entry.timestampMs))];
  const thresholdMs = gapThresholdMs(expectedCadenceSeconds);
  const intervals = uniqueTimes.slice(1).map((value, index) => value - uniqueTimes[index]).filter(value => value > 0);
  const interiorGaps = intervals.filter(value => value > thresholdMs).length;
  const boundaryGaps = (
    (options.expectedStartMs !== undefined && uniqueTimes[0] - options.expectedStartMs > thresholdMs ? 1 : 0)
    + (options.expectedEndMs !== undefined && options.expectedEndMs - uniqueTimes[uniqueTimes.length - 1] > thresholdMs ? 1 : 0)
  );
  const gapCount = interiorGaps + boundaryGaps;
  const firstTime = measured[0].point.time || null;
  const lastTime = measured[measured.length - 1].point.time || null;
  if (measured.length < sparseThreshold || uniqueTimes.length < sparseThreshold) return {
    level: 'sparse', measuredPoints: measured.length, gapCount, firstTime, lastTime,
  };
  return {
    level: gapCount ? 'partial' : 'complete', measuredPoints: measured.length, gapCount,
    firstTime, lastTime,
  };
}

export function coverageCopy(level: CoverageLevel, scope = 'Zeitraum'): string {
  if (level === 'complete') return `Im erfassten ${scope} liegen durchgehend Messwerte vor.`;
  if (level === 'partial') return `Im ${scope} fehlen für einzelne Abschnitte Messwerte.`;
  if (level === 'sparse') return 'Es liegen nur wenige Messwerte vor. Aussagen sind eingeschränkt.';
  return `Im ${scope} liegen keine Messwerte vor.`;
}

export function highestMeasuredPoint(timeline: TimelineEntry[], key: 'solarKw' | 'homeLoadKw'): TimelineEntry | null {
  const candidates = timeline.filter(point => typeof point[key] === 'number' && Number.isFinite(point[key]));
  if (candidates.length < 4) return null;
  return candidates.reduce((highest, point) => (point[key] as number) > (highest[key] as number) ? point : highest);
}

export function dailyStatements(
  timeline: TimelineEntry[],
  coverage: CoverageResult,
  snapshot?: EnergySnapshot | null,
): string[] {
  const statements: string[] = [];
  if (coverage.level !== 'complete') statements.push(coverageCopy(coverage.level, 'Tagesverlauf'));
  if (snapshot?.quality === 'live' && snapshot.grid.origin === 'observed' && snapshot.grid.valueKw !== null) {
    if (snapshot.grid.valueKw > 0) statements.push('Derzeit bezieht dein Zuhause Energie aus dem Netz.');
    else if (snapshot.grid.valueKw < 0) {
      const supportedSolarSurplus = snapshot.solar.origin === 'observed'
        && snapshot.homeLoad.origin === 'observed'
        && snapshot.solar.valueKw !== null
        && snapshot.homeLoad.valueKw !== null
        && snapshot.solar.valueKw > snapshot.homeLoad.valueKw;
      statements.push(supportedSolarSurplus
        ? 'Derzeit wird überschüssige Solarenergie eingespeist.'
        : 'Derzeit wird Energie ins Netz eingespeist.');
    }
    else statements.push('Derzeit findet kein Austausch mit dem Netz statt.');
  }
  const mayStatePeaks = coverage.level === 'complete' || coverage.level === 'partial';
  const solarPeak = mayStatePeaks ? highestMeasuredPoint(timeline, 'solarKw') : null;
  const homePeak = mayStatePeaks ? highestMeasuredPoint(timeline, 'homeLoadKw') : null;
  if (homePeak) {
    const origin = homePeak.homeLoadOrigin ?? homePeak.origin;
    const qualifier = origin === 'observed' ? 'gemessene' : origin === 'calculated' ? 'berechnete' : 'erfasste';
    statements.push(`Der höchste ${qualifier} Hausverbrauch trat gegen ${homePeak.time} Uhr auf.`);
  }
  if (solarPeak) {
    const origin = solarPeak.solarOrigin ?? solarPeak.origin;
    const qualifier = origin === 'observed' ? 'gemessene' : 'erfasste';
    statements.push(`Die höchste ${qualifier} Solarleistung trat gegen ${solarPeak.time} Uhr auf.`);
  }
  if (!statements.length && coverage.level === 'complete') {
    statements.push('Für den erfassten Tagesverlauf liegen durchgehend Messwerte vor.');
  }
  return statements.slice(0, 3);
}
