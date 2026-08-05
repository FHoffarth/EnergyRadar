import { TimelineEntry } from '../types';

/**
 * Overview chart aggregation. Raw samples are bucketed into fixed local
 * intervals (default 15 min) purely for *display* — the factual daily energy
 * totals are computed elsewhere and never touched here.
 *
 * Rules: a bucket needs at least one real sample to exist; empty buckets stay
 * `null` (never interpolated, never zero-filled, never carried forward). Per
 * bucket we keep the arithmetic mean (the calm line/area) and the max (only for
 * honest peak detection).
 */
export interface AggregatedBucket {
  startMs: number;
  endMs: number;
  /** Plot x-position (bucket start). */
  timestampMs: number;
  solarKw: number | null;
  homeLoadKw: number | null;
  solarMaxKw: number | null;
  homeMaxKw: number | null;
  count: number;
  hasData: boolean;
}

export const DEFAULT_INTERVAL_MINUTES = 15;

export function aggregateTimeline(
  timeline: TimelineEntry[],
  dayStartMs: number,
  dayEndMs: number,
  intervalMinutes: number = DEFAULT_INTERVAL_MINUTES,
): AggregatedBucket[] {
  const intervalMs = intervalMinutes * 60_000;
  const bucketCount = Math.max(1, Math.round((dayEndMs - dayStartMs) / intervalMs));
  const solarSum = new Float64Array(bucketCount);
  const solarN = new Int32Array(bucketCount);
  const homeSum = new Float64Array(bucketCount);
  const homeN = new Int32Array(bucketCount);
  const solarMax = new Float64Array(bucketCount).fill(-Infinity);
  const homeMax = new Float64Array(bucketCount).fill(-Infinity);
  const anyN = new Int32Array(bucketCount);

  for (const point of timeline) {
    const ts = point.timestampMs;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < dayStartMs || ts >= dayEndMs) continue;
    const idx = Math.floor((ts - dayStartMs) / intervalMs);
    if (idx < 0 || idx >= bucketCount) continue;
    let real = false;
    if (typeof point.solarKw === 'number' && Number.isFinite(point.solarKw)) {
      solarSum[idx] += point.solarKw; solarN[idx] += 1;
      if (point.solarKw > solarMax[idx]) solarMax[idx] = point.solarKw;
      real = true;
    }
    if (typeof point.homeLoadKw === 'number' && Number.isFinite(point.homeLoadKw)) {
      homeSum[idx] += point.homeLoadKw; homeN[idx] += 1;
      if (point.homeLoadKw > homeMax[idx]) homeMax[idx] = point.homeLoadKw;
      real = true;
    }
    if (real) anyN[idx] += 1;
  }

  const buckets: AggregatedBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const startMs = dayStartMs + i * intervalMs;
    buckets.push({
      startMs,
      endMs: startMs + intervalMs,
      timestampMs: startMs,
      solarKw: solarN[i] > 0 ? solarSum[i] / solarN[i] : null,
      homeLoadKw: homeN[i] > 0 ? homeSum[i] / homeN[i] : null,
      solarMaxKw: solarN[i] > 0 ? solarMax[i] : null,
      homeMaxKw: homeN[i] > 0 ? homeMax[i] : null,
      count: anyN[i],
      hasData: anyN[i] > 0,
    });
  }
  return buckets;
}

/** Buckets with no real sample — the honest gaps (never interpolated). */
export function gapBuckets(buckets: AggregatedBucket[]): AggregatedBucket[] {
  // Only count gaps *inside* the observed span (leading/trailing empties, e.g.
  // the night before recording, are not "missing data" the user should worry about).
  const first = buckets.findIndex(b => b.hasData);
  const last = buckets.length - 1 - [...buckets].reverse().findIndex(b => b.hasData);
  if (first < 0) return [];
  return buckets.slice(first, last + 1).filter(b => !b.hasData);
}

/** Robust display cap: ~p95 of bucket means (+buffer), with a sane floor so a
 *  quiet day is not over-dramatised. Peaks above this are marked, not hidden. */
export function robustYCap(buckets: AggregatedBucket[], floorKw = 0.5): number {
  const values = buckets
    .flatMap(b => [b.solarKw, b.homeLoadKw])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  if (!values.length) return floorKw;
  const p95 = values[Math.min(values.length - 1, Math.floor(0.95 * values.length))];
  return Math.max(floorKw, Math.ceil(p95 * 1.2 * 10) / 10);
}

export interface Peak { timestampMs: number; valueKw: number; series: 'home' | 'solar'; }

/** Real interval maxima above the visible cap — surfaced honestly as markers. */
export function timelinePeaks(buckets: AggregatedBucket[], cap: number): Peak[] {
  const peaks: Peak[] = [];
  for (const b of buckets) {
    if (b.homeMaxKw !== null && b.homeMaxKw > cap) peaks.push({ timestampMs: b.timestampMs, valueKw: b.homeMaxKw, series: 'home' });
    else if (b.solarMaxKw !== null && b.solarMaxKw > cap) peaks.push({ timestampMs: b.timestampMs, valueKw: b.solarMaxKw, series: 'solar' });
  }
  return peaks;
}
