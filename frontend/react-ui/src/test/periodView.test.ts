import { describe, it, expect } from 'vitest';
import { classifyPeriod, provenanceLabel, memoryTopStatus } from '../lib/periodView';
import { PeriodReport } from '../types';

function report(over: Partial<PeriodReport>): PeriodReport {
  const m = { value_kwh: null, state: null, coverage_state: null, source: null, provenance: null, confidence: null, reason: null };
  return {
    requested_period: null, resolved_period: null, provenance: null, freshness: null,
    metrics: { pv_generation: m, grid_import: m, grid_export: m, house_consumption: m, direct_self_consumption: m },
    has_records: false, has_summary: false, ...over,
  };
}

describe('classifyPeriod', () => {
  it('is loading while the request is in flight', () => {
    expect(classifyPeriod(null, true)).toBe('loading');
  });
  it('is summary when a factual value exists', () => {
    expect(classifyPeriod(report({ has_summary: true, has_records: true }), false)).toBe('summary');
  });
  it('is records_only when records exist but no summary', () => {
    expect(classifyPeriod(report({ has_summary: false, has_records: true }), false)).toBe('records_only');
  });
  it('is unavailable only when nothing exists', () => {
    expect(classifyPeriod(report({ has_summary: false, has_records: false }), false)).toBe('unavailable');
    expect(classifyPeriod(null, false)).toBe('unavailable');
  });
});

describe('memoryTopStatus — never contradicts summary/curve', () => {
  const withCurve = (source: string) => report({ has_curve: true, curve: { source } as any });
  it('never says unavailable when a curve exists', () => {
    expect(memoryTopStatus(withCurve('fronius_archive'), false)).toEqual({ label: 'Verlauf aus dem Fronius-Datalogger verfügbar', unavailable: false });
    expect(memoryTopStatus(withCurve('mixed'), false).unavailable).toBe(false);
  });
  it('is partial when summary exists without a full curve', () => {
    expect(memoryTopStatus(report({ has_summary: true, has_records: true }), false)).toEqual({ label: 'Teilweise verfügbar', unavailable: false });
  });
  it('is genuinely unavailable only when nothing exists', () => {
    expect(memoryTopStatus(report({ has_summary: false, has_records: false }), false).unavailable).toBe(true);
  });
  it('shows a calm loading label instead of a false empty state', () => {
    expect(memoryTopStatus(null, true)).toEqual({ label: 'Zeitraum wird geladen …', unavailable: false });
  });
});

describe('provenanceLabel', () => {
  it('maps backend enums to human labels and never leaks raw enums', () => {
    expect(provenanceLabel('counter_anchors')).toMatch(/Synchronisierte/);
    expect(provenanceLabel('stored_sample_counters')).toMatch(/eingeschränkte/);
    expect(provenanceLabel('demo')).toBe('Demodaten');
    expect(provenanceLabel('some_raw_enum')).toBeNull();
  });
});
