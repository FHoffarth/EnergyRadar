import { describe, it, expect } from 'vitest';
import { aggregateTimeline, gapBuckets, robustYCap, timelinePeaks } from '../lib/chartAggregation';
import { TimelineEntry } from '../types';

const DAY = new Date('2026-08-03T00:00:00'); DAY.setHours(0, 0, 0, 0);
const start = DAY.getTime();
const end = start + 24 * 3600 * 1000;

function pt(hh: number, mm: number, solar: number | null, home: number | null): TimelineEntry {
  const ts = start + (hh * 60 + mm) * 60_000;
  return { time: `${hh}:${mm}`, timestampMs: ts, solarKw: solar, homeLoadKw: home, gridKw: null, batteryPct: null, origin: 'observed' };
}

describe('aggregateTimeline — 15-minute display buckets', () => {
  it('averages samples within a bucket and keeps the max for peaks', () => {
    const b = aggregateTimeline([pt(12, 1, 1.0, 0.2), pt(12, 9, 2.0, 0.4), pt(12, 14, 3.0, 2.6)], start, end);
    const noon = b.find(x => x.startMs === start + 12 * 3600 * 1000)!;
    expect(noon.solarKw).toBeCloseTo(2.0);         // (1+2+3)/3
    expect(noon.homeLoadKw).toBeCloseTo(1.0666, 2); // (0.2+0.4+2.6)/3
    expect(noon.homeMaxKw).toBeCloseTo(2.6);        // raw max preserved for peaks
    expect(noon.count).toBe(3);
    expect(noon.hasData).toBe(true);
  });

  it('leaves empty buckets null — no interpolation, no zero-fill', () => {
    const b = aggregateTimeline([pt(8, 0, 1.0, 0.5)], start, end);
    expect(b.length).toBe(96);
    const eight = b.find(x => x.startMs === start + 8 * 3600 * 1000)!;
    expect(eight.solarKw).toBeCloseTo(1.0);
    const nine = b.find(x => x.startMs === start + 9 * 3600 * 1000)!;
    expect(nine.solarKw).toBeNull();
    expect(nine.homeLoadKw).toBeNull();
    expect(nine.hasData).toBe(false);
  });

  it('counts only interior gaps (leading/trailing night is not "missing")', () => {
    const b = aggregateTimeline([pt(10, 0, 1, 0.5), pt(12, 0, 1, 0.5)], start, end);
    // Interior empty buckets between 10:00 and 12:00: 10:15…11:45 = 7 buckets.
    expect(gapBuckets(b).length).toBe(7);
  });
});

describe('robustYCap + timelinePeaks', () => {
  it('caps near p95 with a floor, and marks real maxima above the cap', () => {
    const samples: TimelineEntry[] = [];
    // A calm day at ~0.3 kW, with one brief spike inside a populated bucket so
    // its mean stays low but the raw max (2.6) is preserved for peak detection.
    for (let h = 8; h < 18; h++) for (let m = 0; m < 60; m += 15) samples.push(pt(h, m, 0.3, 0.3));
    samples.push(pt(12, 3, 0.3, 2.6)); // spike within the 12:00 bucket
    const b = aggregateTimeline(samples, start, end);
    const cap = robustYCap(b);
    expect(cap).toBeGreaterThanOrEqual(0.5);
    expect(cap).toBeLessThan(2.6);              // the spike does not set the scale
    const peaks = timelinePeaks(b, cap);
    expect(peaks.length).toBe(1);
    expect(peaks[0].valueKw).toBeCloseTo(2.6);  // real value preserved, disclosed
    expect(peaks[0].series).toBe('home');
  });

  it('floors the scale so a quiet day is not over-dramatised', () => {
    const b = aggregateTimeline([pt(12, 0, 0.05, 0.05)], start, end);
    expect(robustYCap(b)).toBe(0.5);
  });
});
