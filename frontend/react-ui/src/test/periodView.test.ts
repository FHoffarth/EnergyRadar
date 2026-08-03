import { describe, it, expect } from 'vitest';
import { classifyPeriod, provenanceLabel } from '../lib/periodView';
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

describe('provenanceLabel', () => {
  it('maps backend enums to human labels and never leaks raw enums', () => {
    expect(provenanceLabel('counter_anchors')).toMatch(/Synchronisierte/);
    expect(provenanceLabel('stored_sample_counters')).toMatch(/eingeschränkte/);
    expect(provenanceLabel('demo')).toBe('Demodaten');
    expect(provenanceLabel('some_raw_enum')).toBeNull();
  });
});
