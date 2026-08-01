import { describe, expect, it } from 'vitest';
import { currentEnergyVerdict, energyTooltipRows, energyWeatherInsight, recentSolarTrend } from '../lib/energyContext';
import { DemoDeviceSummary, EnergySnapshot, TimelineEntry } from '../types';

function snapshot(grid: number | null = 0, solar: number | null = 1, home: number | null = 1, quality: EnergySnapshot['quality'] = 'live'): EnergySnapshot {
  return {
    timestamp: '12:00', quality,
    grid: { valueKw: grid, origin: grid === null ? 'unavailable' : 'observed' },
    solar: { valueKw: solar, origin: solar === null ? 'unavailable' : 'observed' },
    homeLoad: { valueKw: home, origin: home === null ? 'unavailable' : 'observed' },
    battery: null, assessment: null, warnings: [],
  };
}

const offline = (id: string): DemoDeviceSummary => ({ id, name: id, status: 'offline' } as DemoDeviceSummary);
const weather = { condition: 'cloudy', weather_code: 3, cloud_cover_percent: 80, temperature_c: 20, precipitation_mm: 0, is_day: true };
const sun = { sunrise: '2026-08-01T05:00:00Z', sunset: '2026-08-01T18:00:00Z' };

describe('trustworthy current-state verdict', () => {
  it('translates grid import, export and valid zero without ambiguity', () => {
    expect(currentEnergyVerdict(snapshot(0.42), [], 'de-DE')).toContain('420 W aus dem Netz');
    expect(currentEnergyVerdict(snapshot(-0.88), [], 'de-DE')).toContain('880 W ins Netz');
    expect(currentEnergyVerdict(snapshot(0, 1, 1), [], 'de-DE')).toContain('vollständig von der Solaranlage');
    expect(currentEnergyVerdict(snapshot(0, 0, 1), [], 'de-DE')).toContain('keine Energie mit dem Netz');
  });

  it.each(['partial', 'stale', 'unavailable'] as const)('does not make a live claim for %s data', quality => {
    expect(currentEnergyVerdict(snapshot(-0.88, 1, 1, quality))).toContain('nicht verfügbar');
  });

  it('makes offline Fronius and SmartMeter states explicit instead of keeping a confident verdict', () => {
    expect(currentEnergyVerdict(snapshot(-0.88), [offline('fronius_primary')])).toContain('nicht verfügbar');
    expect(currentEnergyVerdict(snapshot(0.42), [offline('mt175_primary')])).toContain('nicht verfügbar');
  });

  it('keeps a partial source state neutral', () => {
    const partial = { ...offline('mt175_primary'), status: 'partial' as const };
    expect(currentEnergyVerdict(snapshot(-0.88), [partial])).toContain('nicht verfügbar');
  });
});

describe('energy-context priority', () => {
  const insight = (now: string, data = snapshot(), current: any = weather) => energyWeatherInsight({ now: new Date(now), sun, current, snapshot: data });

  it('uses sun boundaries before weather narration', () => {
    expect(insight('2026-08-01T04:59:59Z')).toContain('beendet');
    expect(insight('2026-08-01T05:00:00Z')).toContain('Bewölkung');
    expect(insight('2026-08-01T12:00:00Z')).toContain('Bewölkung');
    expect(insight('2026-08-01T18:00:00Z')).toContain('beendet');
    expect(insight('2026-08-01T18:00:01Z')).toContain('beendet');
  });

  it('never lets provider is_day or cloud narration override sunset', () => {
    expect(insight('2026-08-01T19:00:00Z', snapshot(), { ...weather, is_day: true })).toBe('Die Solarerzeugung ist für heute beendet.');
  });

  it('distinguishes fresh, stale, unavailable and valid zero PV', () => {
    expect(insight('2026-08-01T12:00:00Z', snapshot(0, 1))).toContain('Bewölkung');
    expect(insight('2026-08-01T12:00:00Z', snapshot(0, 1, 1, 'stale'))).toContain('PV-Daten');
    expect(insight('2026-08-01T12:00:00Z', snapshot(0, null))).toContain('PV-Daten');
    expect(insight('2026-08-01T12:00:00Z', snapshot(0, 0), { ...weather, cloud_cover_percent: 40 })).toContain('gültige 0 W');
  });
});

describe('evidence-gated trends and contextual tooltips', () => {
  const timeline = (values: Array<number | null>): TimelineEntry[] => values.map((solarKw, index) => ({
    time: `${10 + index}:00`, solarKw, homeLoadKw: null, gridKw: null, batteryPct: null, origin: 'observed',
  }));

  it('shows a trend only with three measured recent samples', () => {
    expect(recentSolarTrend(timeline([1, 1.2, 1.4]))).toBe('steigt');
    expect(recentSolarTrend(timeline([1.4, 1.2, 1]))).toBe('fällt');
    expect(recentSolarTrend(timeline([1, 1.01, 1.02]))).toBe('stabil');
    expect(recentSolarTrend(timeline([1, null, 1.4]))).toBeNull();
  });

  it('translates tooltip import, export and zero and omits missing values', () => {
    expect(energyTooltipRows({ solarKw: 0.412, homeLoadKw: 0.376, gridKw: 0.036 })[2].value).toBe('36 W Bezug');
    expect(energyTooltipRows({ gridKw: -0.036 })[0].value).toBe('36 W Einspeisung');
    expect(energyTooltipRows({ gridKw: 0 })[0].value).toBe('0 W Kein Austausch');
    expect(energyTooltipRows({ solarKw: null, homeLoadKw: undefined, gridKw: null })).toEqual([]);
  });
});
