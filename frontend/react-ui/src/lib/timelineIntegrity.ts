import { TimelineEntry } from '../types';

/**
 * The recurring collector may arrive slightly late without losing a sample.
 * One half-cadence of jitter is accepted. An interval exactly on the threshold
 * is continuous; anything beyond it is an explicit gap.
 */
export const CADENCE_JITTER_RATIO = 0.5;

export interface TimelineGap {
  /** Last observed sample before the missing interval. */
  before: TimelineEntry & { timestampMs: number };
  /** First observed sample after the missing interval. */
  after: TimelineEntry & { timestampMs: number };
  durationMs: number;
}

export function gapThresholdMs(expectedCadenceSeconds: number): number {
  const cadenceMs = Math.max(1, expectedCadenceSeconds) * 1000;
  return cadenceMs * (1 + CADENCE_JITTER_RATIO);
}

function minuteTimeMs(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return ((hour * 60 + minute) * 60 + second) * 1000;
}

export function timelineTimeMs(point: TimelineEntry): number | null {
  if (typeof point.timestampMs === 'number' && Number.isFinite(point.timestampMs)) return point.timestampMs;
  return minuteTimeMs(point.time);
}

export function hasFiniteTimelineValue(point: TimelineEntry): boolean {
  return [point.solarKw, point.homeLoadKw, point.gridKw]
    .some(value => typeof value === 'number' && Number.isFinite(value));
}

function gapMarker(timestampMs: number): TimelineEntry {
  return {
    time: '', timestampMs,
    solarKw: null, homeLoadKw: null, gridKw: null, batteryPct: null,
    origin: 'unavailable', isGapMarker: true,
  };
}

function orderedTimeline(timeline: TimelineEntry[]): Array<TimelineEntry & { timestampMs: number }> {
  return timeline
    .map((point, index) => ({ point, index, timestampMs: timelineTimeMs(point) }))
    .filter((entry): entry is { point: TimelineEntry; index: number; timestampMs: number } => entry.timestampMs !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs || a.index - b.index)
    .map(entry => ({ ...entry.point, timestampMs: entry.timestampMs }));
}

/**
 * Return only observed boundary samples. Consumers may shade the elapsed time
 * and draw an explicitly non-measured dashed bridge between these boundaries;
 * no midpoint value is derived or inserted.
 */
export function timelineGaps(
  timeline: TimelineEntry[],
  expectedCadenceSeconds: number,
): TimelineGap[] {
  const ordered = orderedTimeline(timeline);
  const threshold = gapThresholdMs(expectedCadenceSeconds);
  return ordered.slice(1).flatMap((after, index) => {
    const before = ordered[index];
    const durationMs = after.timestampMs - before.timestampMs;
    return durationMs > threshold ? [{ before, after, durationMs }] : [];
  });
}

/**
 * Prepare samples for a numeric time axis. A single null marker is sufficient
 * to break every Recharts series while the numeric x value preserves elapsed
 * time. Explicit null samples are retained unchanged and valid zero is never
 * rewritten.
 */
export function withVisibleTimelineGaps(
  timeline: TimelineEntry[],
  expectedCadenceSeconds: number,
): TimelineEntry[] {
  const ordered = orderedTimeline(timeline);

  if (ordered.length < 2) return ordered;

  const threshold = gapThresholdMs(expectedCadenceSeconds);
  const prepared: TimelineEntry[] = [];
  ordered.forEach((entry, index) => {
    if (index > 0) {
      const previous = ordered[index - 1];
      const elapsed = entry.timestampMs - previous.timestampMs;
      if (elapsed > threshold) prepared.push(gapMarker(previous.timestampMs + elapsed / 2));
    }
    prepared.push(entry);
  });
  return prepared;
}

export function formatTimelineTime(value: unknown, locale = 'de-DE'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  // Minute-only fallback timestamps are milliseconds since local midnight.
  if (value >= 0 && value < 86_400_000) {
    const totalSeconds = Math.floor(value / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function todayCoverageBoundaries(timeline: TimelineEntry[], now = new Date()): {
  expectedStartMs: number;
  expectedEndMs: number;
} {
  const usesEpochTime = timeline.some(point => {
    const value = timelineTimeMs(point);
    return value !== null && value >= 86_400_000;
  });
  if (!usesEpochTime) {
    return {
      expectedStartMs: 0,
      expectedEndMs: ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds(),
    };
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { expectedStartMs: start.getTime(), expectedEndMs: now.getTime() };
}
