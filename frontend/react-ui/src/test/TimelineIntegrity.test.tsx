import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryOverviewChart } from '../components/HistoryOverviewChart';
import { gapThresholdMs, timelineGaps, withVisibleTimelineGaps } from '../lib/timelineIntegrity';
import { TimelineEntry } from '../types';

const point = (timestampMs: number, solarKw: number | null): TimelineEntry => ({
  time: `T${timestampMs}`, timestampMs, solarKw,
  homeLoadKw: solarKw, gridKw: solarKw === null ? null : -solarKw,
  batteryPct: null, origin: 'observed',
});

describe('shared timeline gap preparation', () => {
  it('inserts a null marker for a missing interval and preserves elapsed x time', () => {
    const prepared = withVisibleTimelineGaps([point(0, 1), point(20_000, 2)], 5);
    expect(prepared).toHaveLength(3);
    expect(prepared[1]).toMatchObject({ timestampMs: 10_000, solarKw: null, homeLoadKw: null, gridKw: null, isGapMarker: true });
  });

  it('describes a readable gap bridge using only measured boundary samples', () => {
    const before = point(0, 0);
    const after = point(20_000, 2);
    const gaps = timelineGaps([before, after], 5);
    expect(gaps).toEqual([{ before, after, durationMs: 20_000 }]);
    expect(gaps[0]).not.toHaveProperty('interpolatedValue');
  });

  it('treats the exact threshold as continuous and one millisecond beyond as a gap', () => {
    const threshold = gapThresholdMs(5);
    expect(withVisibleTimelineGaps([point(0, 0), point(threshold, 0)], 5)).toHaveLength(2);
    expect(withVisibleTimelineGaps([point(0, 0), point(threshold + 1, 0)], 5)).toHaveLength(3);
  });

  it('preserves valid zero and explicit null samples', () => {
    const prepared = withVisibleTimelineGaps([point(0, 0), point(5_000, null), point(10_000, 0)], 5);
    expect(prepared.map(entry => entry.solarKw)).toEqual([0, null, 0]);
    expect(prepared.some(entry => entry.isGapMarker)).toBe(false);
  });

  it('exposes the shared gap result and signed grid meaning to Memory non-visually', () => {
    render(<HistoryOverviewChart timeline={[point(0, 1), point(20_000, 2)]}
      locale="de-DE" animate={false} expectedCadenceSeconds={5} />);
    expect(screen.getByRole('img', { name: /1 sichtbaren Datenlücke/ })).toHaveAccessibleName(/Netzbezug liegt über, Einspeisung unter null/);
    expect(screen.getByText(/nicht gemessene Orientierungshilfe/)).toBeTruthy();
    expect(screen.getByText(/Datenlücke \(keine Messwerte\)/)).toBeTruthy();
  });

  it('renders Memory for a grid-only zero instead of treating it as unavailable', () => {
    const gridOnly: TimelineEntry = {
      time: '12:00:00', timestampMs: 1_000, solarKw: null, homeLoadKw: null,
      gridKw: 0, batteryPct: null, origin: 'observed', gridOrigin: 'observed',
    };
    render(<HistoryOverviewChart timeline={[gridOnly]} locale="de-DE" animate={false} expectedCadenceSeconds={5} />);
    expect(screen.getByRole('img', { name: /Netzbezug liegt über, Einspeisung unter null/ })).toBeTruthy();
    expect(screen.queryByText(/keine Messwerte/)).toBeNull();
  });
});
