import { EnergySnapshot, TimelineEntry } from '../types';

export type CoverageLevel = 'complete' | 'partial' | 'sparse' | 'unavailable';

export interface CoverageResult {
  level: CoverageLevel;
  measuredPoints: number;
  gapCount: number;
  firstTime: string | null;
  lastTime: string | null;
}

function minuteOfDay(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function hasMeasurement(point: TimelineEntry): boolean {
  return [point.solarKw, point.homeLoadKw, point.gridKw]
    .some(value => typeof value === 'number' && Number.isFinite(value));
}

export function evaluateCoverage(
  timeline: TimelineEntry[],
  expectedStartMinute?: number,
  expectedEndMinute?: number,
): CoverageResult {
  const measured = timeline.filter(hasMeasurement);
  if (!measured.length) return { level: 'unavailable', measuredPoints: 0, gapCount: 0, firstTime: null, lastTime: null };
  if (measured.length < 4) return {
    level: 'sparse', measuredPoints: measured.length, gapCount: 0,
    firstTime: measured[0].time || null, lastTime: measured[measured.length - 1].time || null,
  };

  const minutes = measured.map(point => minuteOfDay(point.time)).filter((value): value is number => value !== null);
  if (minutes.length < 4) return {
    level: 'sparse', measuredPoints: measured.length, gapCount: 0,
    firstTime: measured[0].time || null, lastTime: measured[measured.length - 1].time || null,
  };
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  const intervals = sorted.slice(1).map((value, index) => value - sorted[index]).filter(value => value > 0);
  if (!intervals.length) return {
    level: 'sparse', measuredPoints: measured.length, gapCount: 0,
    firstTime: measured[0].time || null, lastTime: measured[measured.length - 1].time || null,
  };
  const orderedIntervals = [...intervals].sort((a, b) => a - b);
  const cadence = orderedIntervals[Math.floor(orderedIntervals.length / 2)];
  const tolerance = Math.max(15, cadence * 2.5);
  const interiorGaps = intervals.filter(value => value > tolerance).length;
  const boundaryGaps = (
    (expectedStartMinute !== undefined && sorted[0] - expectedStartMinute > tolerance ? 1 : 0)
    + (expectedEndMinute !== undefined && expectedEndMinute - sorted[sorted.length - 1] > tolerance ? 1 : 0)
  );
  const gapCount = interiorGaps + boundaryGaps;
  return {
    level: gapCount ? 'partial' : 'complete', measuredPoints: measured.length, gapCount,
    firstTime: measured[0].time || null, lastTime: measured[measured.length - 1].time || null,
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
  if (candidates.length < 3) return null;
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
    else if (snapshot.grid.valueKw < 0) statements.push('Derzeit wird überschüssige Solarenergie eingespeist.');
    else statements.push('Derzeit findet kein Austausch mit dem Netz statt.');
  }
  const solarPeak = highestMeasuredPoint(timeline, 'solarKw');
  const homePeak = highestMeasuredPoint(timeline, 'homeLoadKw');
  if (homePeak) statements.push(`Der höchste gemessene Verbrauch trat gegen ${homePeak.time} Uhr auf.`);
  if (solarPeak) statements.push(`Die höchste gemessene Solarleistung trat gegen ${solarPeak.time} Uhr auf.`);
  if (!statements.length && coverage.level === 'complete') {
    statements.push('Für den erfassten Tagesverlauf liegen durchgehend Messwerte vor.');
  }
  return statements.slice(0, 3);
}
