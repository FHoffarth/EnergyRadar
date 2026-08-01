import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailySummaryMetrics } from '../components/DailySummaryMetrics';
import { DailyInterpretation } from '../components/DailyInterpretation';
import { dailyStatements, evaluateCoverage } from '../lib/storytelling';
import { EnergySnapshot, TimelineEntry, TodayData } from '../types';

const point = (time: string, solarKw: number | null, homeLoadKw: number | null): TimelineEntry => ({
  time, solarKw, homeLoadKw, gridKw: null, batteryPct: null, origin: 'observed',
});

const totals = (values: Partial<Record<'solar' | 'home' | 'draw' | 'feed', number>> = {}): TodayData => ({
  solarTotal: values.solar === undefined ? { state: 'unknown' } : { state: 'available', value: values.solar },
  homeTotal: values.home === undefined ? { state: 'unknown' } : { state: 'available', value: values.home },
  gridDrawTotal: values.draw === undefined ? { state: 'unknown' } : { state: 'available', value: values.draw },
  gridFeedInTotal: values.feed === undefined ? { state: 'unknown' } : { state: 'available', value: values.feed },
  selfSufficiency: { state: 'unknown' }, selfConsumption: { state: 'unknown' }, history: [],
});

const liveSnapshot = (gridKw: number): EnergySnapshot => ({
  timestamp: '12:00', quality: 'live',
  solar: { valueKw: 2, origin: 'observed' }, homeLoad: { valueKw: 1, origin: 'observed' },
  grid: { valueKw: gridKw, origin: 'observed' }, battery: null, assessment: null, warnings: [],
});

describe('storytelling trust rules', () => {
  it('classifies complete, partial, sparse, and unavailable coverage', () => {
    expect(evaluateCoverage([point('00:00', 0, 0), point('00:05', 0.1, 0.2), point('00:10', 0.2, 0.3), point('00:15', 0.3, 0.4)], 0, 15).level).toBe('complete');
    expect(evaluateCoverage([point('00:00', 0, 0), point('00:05', 0.1, 0.2), point('00:10', 0.2, 0.3), point('01:00', 0.3, 0.4)], 0, 60).level).toBe('partial');
    expect(evaluateCoverage([point('00:00', 0, 0), point('00:05', 0.1, 0.2)]).level).toBe('sparse');
    expect(evaluateCoverage([point('00:00', null, null)]).level).toBe('unavailable');
  });

  it('keeps valid zero separate from unavailable totals', () => {
    render(<DailySummaryMetrics data={totals({ solar: 0, home: 1.2 })}
      coverage={{ level: 'partial', measuredPoints: 4, gapCount: 1, firstTime: '08:00', lastTime: '09:00' }} locale="de-DE" />);
    expect(screen.getByText('0 kWh')).toBeTruthy();
    expect(screen.getByText('1,2 kWh')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Teilweise')).toBeTruthy();
  });

  it('renders complete available totals without replacing missing totals', () => {
    const { rerender } = render(<DailySummaryMetrics data={totals({ solar: 4.2, home: 3.1, draw: 0.4, feed: 1.5 })}
      coverage={{ level: 'complete', measuredPoints: 10, gapCount: 0, firstTime: '00:00', lastTime: '12:00' }} locale="de-DE" />);
    expect(screen.getByText('4,2 kWh')).toBeTruthy();
    expect(screen.getByText('Vollständig')).toBeTruthy();
    rerender(<DailySummaryMetrics data={totals()}
      coverage={{ level: 'unavailable', measuredPoints: 0, gapCount: 0, firstTime: null, lastTime: null }} locale="de-DE" />);
    expect(screen.getAllByText('—')).toHaveLength(5);
  });

  it('states measured peaks without implying unsupported causes or trends', () => {
    const timeline = [point('09:00', 0.5, 0.4), point('10:00', 1.5, 0.8), point('11:00', 1, 0.6), point('12:00', 0.8, 0.5)];
    const statements = dailyStatements(timeline, evaluateCoverage(timeline), null);
    expect(statements).toContain('Der höchste gemessene Verbrauch trat gegen 10:00 Uhr auf.');
    expect(statements).toContain('Die höchste gemessene Solarleistung trat gegen 10:00 Uhr auf.');
    expect(statements.join(' ')).not.toMatch(/weil|gespart|Trend|typisch/i);
  });

  it('uses only fresh observed signed grid data for a current import/export statement', () => {
    const timeline = [point('09:00', 1, 2), point('10:00', 2, 1), point('11:00', 1, 1)];
    expect(dailyStatements(timeline, evaluateCoverage(timeline), liveSnapshot(0.8)).join(' ')).toContain('bezieht');
    expect(dailyStatements(timeline, evaluateCoverage(timeline), liveSnapshot(-0.8)).join(' ')).toContain('eingespeist');
    expect(dailyStatements(timeline, evaluateCoverage(timeline), { ...liveSnapshot(-0.8), quality: 'stale' }).join(' ')).not.toContain('Derzeit');
  });

  it('leads with partial coverage and handles insufficient series without invented peaks', () => {
    const sparse = [point('09:00', 1, null), point('12:00', null, null)];
    const statements = dailyStatements(sparse, evaluateCoverage(sparse), null);
    expect(statements).toEqual(['Es liegen nur wenige Messwerte vor. Aussagen sind eingeschränkt.']);
    expect(statements.join(' ')).not.toContain('höchste');
  });

  it('renders no interpretation when there is no trustworthy statement', () => {
    const { container } = render(<DailyInterpretation statements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
