import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailySummaryMetrics } from '../components/DailySummaryMetrics';
import { DailyInterpretation } from '../components/DailyInterpretation';
import { dailyStatements, evaluateCoverage } from '../lib/storytelling';
import { EnergySnapshot, TimelineEntry, TodayData } from '../types';

const point = (
  timestampMs: number,
  solarKw: number | null = 1,
  homeLoadKw: number | null = 0.5,
  origin: TimelineEntry['origin'] = 'observed',
): TimelineEntry => ({
  time: new Date(timestampMs).toISOString().slice(11, 19), timestampMs,
  solarKw, homeLoadKw, gridKw: null, batteryPct: null, origin,
  solarOrigin: solarKw === null ? 'unavailable' : 'observed',
  homeLoadOrigin: homeLoadKw === null ? 'unavailable' : origin,
});

const coverage = (timeline: TimelineEntry[], expectedCadenceSeconds = 5, start = 0, end?: number) =>
  evaluateCoverage(timeline, {
    expectedCadenceSeconds,
    expectedStartMs: start,
    expectedEndMs: end ?? timeline[timeline.length - 1]?.timestampMs ?? start,
  });

const totals = (values: Partial<Record<'solar' | 'home' | 'draw' | 'feed', number>> = {}): TodayData => ({
  solarTotal: values.solar === undefined ? { state: 'unknown' } : { state: 'available', value: values.solar },
  homeTotal: values.home === undefined ? { state: 'unknown' } : { state: 'available', value: values.home },
  gridDrawTotal: values.draw === undefined ? { state: 'unknown' } : { state: 'available', value: values.draw },
  gridFeedInTotal: values.feed === undefined ? { state: 'unknown' } : { state: 'available', value: values.feed },
  selfSufficiency: { state: 'unknown' }, selfConsumption: { state: 'unknown' }, history: [],
});

const liveSnapshot = (gridKw: number, solarKw: number | null = 2, homeKw: number | null = 1): EnergySnapshot => ({
  timestamp: '12:00', quality: 'live',
  solar: { valueKw: solarKw, origin: solarKw === null ? 'unavailable' : 'observed' },
  homeLoad: { valueKw: homeKw, origin: homeKw === null ? 'unavailable' : 'observed' },
  grid: { valueKw: gridKw, origin: 'observed' }, battery: null, assessment: null, warnings: [],
});

describe('cadence-aware coverage', () => {
  it('accepts exact cadence, jitter, and the exact inclusive gap threshold', () => {
    expect(coverage([point(0), point(5_000), point(10_000), point(15_000)]).level).toBe('complete');
    expect(coverage([point(0), point(7_500), point(15_000), point(22_500)], 5).level).toBe('complete');
  });

  it('marks one millisecond beyond the threshold and a 15-minute interval partial', () => {
    expect(coverage([point(0), point(5_000), point(12_501), point(17_501)], 5).level).toBe('partial');
    expect(coverage([point(0), point(5_000), point(10_000), point(910_000)], 5).level).toBe('partial');
  });

  it('does not let slow regular observations define a permissive cadence', () => {
    const slow = [point(0), point(60_000), point(120_000), point(180_000)];
    expect(coverage(slow, 5).level).toBe('partial');
    expect(coverage(slow, 5).gapCount).toBe(3);
  });

  it('detects exact boundary behavior and multiple interior gaps', () => {
    const normal = [point(7_500), point(12_500), point(17_500), point(22_500)];
    expect(coverage(normal, 5, 0, 30_000).level).toBe('complete');
    expect(coverage(normal, 5, 0, 30_001).level).toBe('partial');
    expect(coverage([point(7_501), point(12_501), point(17_501), point(22_501)], 5, 0).level).toBe('partial');
    expect(coverage([point(0), point(5_000), point(20_000), point(35_000)], 5).gapCount).toBe(2);
  });

  it('classifies sparse, unavailable, and a fully covered day deterministically', () => {
    expect(coverage([point(0), point(5_000), point(10_000)]).level).toBe('sparse');
    expect(evaluateCoverage([]).level).toBe('unavailable');
    const sixHours = 6 * 60 * 60 * 1000;
    const day = [0, sixHours, 2 * sixHours, 3 * sixHours, 4 * sixHours].map(value => point(value));
    expect(coverage(day, 6 * 60 * 60, 0, 4 * sixHours).level).toBe('complete');
  });
});

describe('storytelling trust rules', () => {
  it('keeps valid zero separate from unavailable totals and qualifies incomplete totals', () => {
    render(<DailySummaryMetrics data={totals({ solar: 0, home: 1.2 })}
      coverage={{ level: 'partial', measuredPoints: 4, gapCount: 1, firstTime: '08:00', lastTime: '09:00' }} locale="de-DE" />);
    expect(screen.getByText('0')).toBeTruthy();               // valid zero figure
    expect(screen.getByText('1,2')).toBeTruthy();
    expect(screen.getAllByText('kWh').length).toBeGreaterThan(0); // unit rendered subordinately
    expect(screen.getAllByText('—')).toHaveLength(2);         // unavailable, distinct from zero
    expect(screen.getByText('Tagesbilanz · im erfassten Zeitraum')).toBeTruthy();
    expect(screen.queryByText('Tagesbilanz · heute')).toBeNull();
  });

  it('uses daily labels only for complete trustworthy coverage', () => {
    render(<DailySummaryMetrics data={totals({ solar: 4.2, home: 3.1, draw: 0.4, feed: 1.5 })}
      coverage={{ level: 'complete', measuredPoints: 10, gapCount: 0, firstTime: '00:00', lastTime: '12:00' }} locale="de-DE" />);
    expect(screen.getByText('Tagesbilanz · heute')).toBeTruthy();
    expect(screen.queryByText('Tagesbilanz · im erfassten Zeitraum')).toBeNull();
    expect(screen.getByText('Solarertrag')).toBeTruthy();
    expect(screen.getByText('Netzbezug')).toBeTruthy();
  });

  it('shows derived partial consumption and a precise unavailable reason', () => {
    const partial = { level: 'partial' as const, measuredPoints: 4, gapCount: 1, firstTime: '08:00', lastTime: '09:00' };
    const { rerender } = render(<DailySummaryMetrics data={totals({ home: 3.81 })}
      coverage={partial} locale="de-DE" />);
    expect(screen.getByText('Tagesbilanz · im erfassten Zeitraum')).toBeTruthy();
    expect(screen.getByText('Hausverbrauch')).toBeTruthy();
    expect(screen.getByText('3,81')).toBeTruthy();

    const unavailable = totals();
    unavailable.homeTotalReason = 'house_energy_period_mismatch';
    rerender(<DailySummaryMetrics data={unavailable} coverage={partial} locale="de-DE" />);
    expect(screen.getByText('PV, Netzbezug und Einspeisung beziehen sich nicht auf denselben Zeitraum.')).toBeTruthy();
  });

  it('uses neutral export wording without PV evidence and solar wording only with supporting evidence', () => {
    const timeline = [point(0), point(5_000), point(10_000), point(15_000)];
    const complete = coverage(timeline);
    expect(dailyStatements(timeline, complete, liveSnapshot(-0.8, null, 1)).join(' '))
      .toContain('Energie ins Netz');
    expect(dailyStatements(timeline, complete, liveSnapshot(-0.8, 2, 1)).join(' '))
      .toContain('überschüssige Solarenergie');
  });

  it('suppresses peak stories for sparse input and distinguishes calculated house power', () => {
    const sparse = [point(0), point(5_000), point(10_000)];
    expect(dailyStatements(sparse, coverage(sparse), null).join(' ')).not.toContain('höchste');

    const calculated = [point(0, 1, 0.5, 'calculated'), point(5_000, 2, 1, 'calculated'), point(10_000, 3, 1.5, 'calculated'), point(15_000, 2, 1, 'calculated')];
    const statement = dailyStatements(calculated, coverage(calculated), null).join(' ');
    expect(statement).toContain('höchste berechnete Hausverbrauch');
    expect(statement).not.toContain('höchste gemessene Verbrauch');
  });

  it('does not make current claims for stale data and renders no empty interpretation', () => {
    const timeline = [point(0), point(5_000), point(10_000), point(15_000)];
    expect(dailyStatements(timeline, coverage(timeline), { ...liveSnapshot(-0.8), quality: 'stale' }).join(' '))
      .not.toContain('Derzeit');
    const { container } = render(<DailyInterpretation statements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
