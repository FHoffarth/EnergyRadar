import { beforeEach, describe, expect, it } from 'vitest';
import { processNowViewModel, nowData$ } from '../lib/energyService';
import { powerDataToSnapshot } from '../providers/DesktopBridgeEnergyProvider';
import { dailyStatements, evaluateCoverage } from '../lib/storytelling';
import { TimelineEntry } from '../types';

const timeline: TimelineEntry[] = [0, 5_000, 10_000, 15_000].map(timestampMs => ({
  time: String(timestampMs), timestampMs, solarKw: 1, homeLoadKw: 0.5,
  gridKw: -0.5, batteryPct: null, origin: 'observed',
}));

describe('bridge stale-state preservation', () => {
  beforeEach(() => processNowViewModel({ data_quality: 'no_source' }));

  it.each([
    ['grid import', { pv_power_w: 1000, grid_power_w: 640, consumption_w: 1640 }],
    ['grid export', { pv_power_w: 1000, grid_power_w: -789, consumption_w: 211 }],
    ['PV', { pv_power_w: 1200, grid_power_w: null, consumption_w: null }],
    ['zero', { pv_power_w: 0, grid_power_w: 0, consumption_w: 0 }],
  ])('keeps stale %s numeric values last-known but not live', (_label, values) => {
    processNowViewModel({ ...values, data_quality: 'stale', freshness_label: 'Veraltet' });
    const raw = nowData$.get();
    const snapshot = powerDataToSnapshot(raw);
    expect(raw.status).toBe('stale');
    expect(snapshot.quality).toBe('stale');
    expect(dailyStatements(timeline, evaluateCoverage(timeline), snapshot).join(' ')).not.toContain('Derzeit');
  });

  it('keeps a fresh numeric zero live and available', () => {
    processNowViewModel({ pv_power_w: 0, grid_power_w: 0, consumption_w: 0, data_quality: 'live' });
    const snapshot = powerDataToSnapshot(nowData$.get());
    expect(snapshot.quality).toBe('live');
    expect(snapshot.grid.valueKw).toBe(0);
    expect(snapshot.solar.valueKw).toBe(0);
  });
});
