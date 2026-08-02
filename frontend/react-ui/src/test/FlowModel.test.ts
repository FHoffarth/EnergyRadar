import { describe, it, expect } from 'vitest';
import { buildFlowModel } from '../lib/flowModel';
import { EnergySnapshot } from '../types';

function snap(partial: Partial<EnergySnapshot>): EnergySnapshot {
  return {
    timestamp: null,
    quality: 'live',
    solar: { valueKw: null, origin: 'unavailable' },
    homeLoad: { valueKw: null, origin: 'unavailable' },
    grid: { valueKw: null, origin: 'unavailable' },
    battery: null,
    assessment: null,
    warnings: [],
    ...partial,
  };
}

describe('flow model — trust rules', () => {
  it('treats an unmeasured channel as unknown, never zero', () => {
    const model = buildFlowModel(snap({ solar: { valueKw: 2, origin: 'observed' } }), 'de-DE');
    expect(model.pv.state).toBe('measured');
    expect(model.house.state).toBe('unknown');
    expect(model.grid.state).toBe('unknown');
    expect(model.grid.direction).toBe('unknown');
  });

  it('keeps a valid measured zero as zero', () => {
    const model = buildFlowModel(snap({ solar: { valueKw: 0, origin: 'observed' } }), 'de-DE');
    expect(model.pv.state).toBe('zero');
    expect(model.solarActive).toBe(false);
  });

  it('marks solar → house active while PV produces', () => {
    const model = buildFlowModel(snap({ solar: { valueKw: 3.2, origin: 'observed' } }), 'de-DE');
    expect(model.solarActive).toBe(true);
  });

  it('reads grid import as a house-bound direction', () => {
    const model = buildFlowModel(snap({ grid: { valueKw: 1.5, origin: 'observed' } }), 'de-DE');
    expect(model.grid.direction).toBe('import');
    expect(model.gridActive).toBe(true);
  });

  it('reads grid export as a grid-bound direction', () => {
    const model = buildFlowModel(snap({ grid: { valueKw: -1.3, origin: 'observed' } }), 'de-DE');
    expect(model.grid.direction).toBe('export');
    expect(model.gridActive).toBe(true);
  });

  it('reads a measured zero grid as no exchange, not unknown', () => {
    const model = buildFlowModel(snap({ grid: { valueKw: 0, origin: 'observed' } }), 'de-DE');
    expect(model.grid.direction).toBe('none');
    expect(model.gridActive).toBe(false);
  });

  it('builds a full non-visual summary with signed grid semantics', () => {
    const model = buildFlowModel(snap({
      solar: { valueKw: 2.4, origin: 'observed' },
      homeLoad: { valueKw: 1.1, origin: 'observed' },
      grid: { valueKw: -1.3, origin: 'observed' },
    }), 'de-DE');
    expect(model.accessibleSummary).toBe(
      'Solar erzeugt 2,4 kW. das Haus verbraucht 1,1 kW. 1,3 kW werden ins Netz eingespeist.',
    );
  });

  it('names unavailable channels in the summary rather than inventing values', () => {
    const model = buildFlowModel(snap({ solar: { valueKw: 2, origin: 'observed' } }), 'de-DE');
    expect(model.accessibleSummary).toContain('der Hausverbrauch ist nicht verfügbar');
    expect(model.accessibleSummary).toContain('der Netzaustausch ist nicht verfügbar');
  });

  it('surfaces a battery only when real data exists', () => {
    expect(buildFlowModel(snap({}), 'de-DE').battery).toBeNull();
    const withBattery = buildFlowModel(snap({
      battery: { powerKw: 1.2, stateOfChargePercent: 74, origin: 'observed' },
    }), 'de-DE');
    expect(withBattery.battery?.flow).toBe('charge');
    expect(withBattery.battery?.chargePercent).toBe(74);
  });
});
