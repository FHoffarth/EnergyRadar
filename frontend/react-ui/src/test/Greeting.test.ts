import { describe, expect, it } from 'vitest';
import { greetingPeriod, greetingTitle, trustworthyEnergySummary } from '../lib/greeting';
import { EnergySnapshot } from '../types';

const snapshot = (grid: number | null, solar: number | null, quality: EnergySnapshot['quality'] = 'live'): EnergySnapshot => ({
  timestamp: '2026-07-31T12:00:00Z', quality,
  grid: { valueKw: grid, origin: grid === null ? 'unavailable' : 'observed' },
  solar: { valueKw: solar, origin: solar === null ? 'unavailable' : 'observed' },
  homeLoad: { valueKw: null, origin: 'unavailable' }, battery: null, assessment: null, warnings: [],
});

describe('personalized greeting trust rules', () => {
  it.each([
    [4 + 59 / 60, 'night'],
    [5, 'morning'],
    [11 + 59 / 60, 'morning'],
    [12, 'afternoon'],
    [17 + 59 / 60, 'afternoon'],
    [18, 'evening'],
  ] as const)('selects the local-time boundary at %s', (hour, expected) => {
    expect(greetingPeriod(hour)).toBe(expected);
  });

  it('uses a name only when one is configured', () => {
    expect(greetingTitle(7, 'Florian')).toBe('Guten Morgen, Florian.');
    expect(greetingTitle(7, null)).toBe('Guten Morgen.');
  });

  it('reports signed grid power including a valid zero', () => {
    expect(trustworthyEnergySummary(snapshot(-0.88, 1.1), 'de-DE')).toContain('880 W ins Netz');
    expect(trustworthyEnergySummary(snapshot(0.64, 1.1), 'de-DE')).toContain('640 W aus dem Netz');
    expect(trustworthyEnergySummary(snapshot(0, 1.1), 'de-DE')).toContain('keine Energie');
  });

  it('uses neutral copy for partial, stale or unavailable live data', () => {
    expect(trustworthyEnergySummary(snapshot(null, null), 'de-DE')).toContain('nicht verfügbar');
    expect(trustworthyEnergySummary(snapshot(-0.88, 1.1, 'stale'), 'de-DE')).toContain('nicht verfügbar');
  });

  it('may report fresh observed solar when grid power is unavailable', () => {
    const summary = trustworthyEnergySummary(snapshot(null, 2.4), 'de-DE');
    expect(summary).toContain('Solaranlage erzeugt gerade 2,4 kW');
    expect(summary).not.toMatch(/Netz|bezieht|speist/);
  });
});
