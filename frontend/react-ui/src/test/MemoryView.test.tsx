import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryView } from '../views/MemoryView';
import { PeriodReport } from '../types';

const requestExport = vi.fn();
const appState: any = {
  requestExport, requestMailShare: vi.fn(), exportStatus: { status: 'idle', msg: '' },
  settingsPayload: { effective_settings: { number_format: 'de-DE' }, system: {
    recording_since: '2026-07-01T08:00:00', last_recorded_sample_at: '2026-08-01T10:00:00',
  } },
};

function metric(value: number | null, source = 'stored_sample_counter_delta') {
  return {
    value_kwh: value, state: value === null ? 'unavailable' : 'partial',
    coverage_state: value === null ? 'unavailable' : 'partial',
    source: value === null ? 'unavailable' : source, provenance: value === null ? null : 'stored_sample_counters',
    confidence: value === null ? null : 'legacy_sample', reason: null,
  };
}

function report(overrides: Partial<PeriodReport> = {}): PeriodReport {
  return {
    requested_period: { from: 'a', to: 'b' },
    resolved_period: { from: 'a', to: 'b', state: 'partial' },
    provenance: 'stored_sample_counters',
    freshness: null,
    metrics: {
      pv_generation: metric(18.4), grid_import: metric(6.2), grid_export: metric(9.7),
      house_consumption: metric(14.9), direct_self_consumption: metric(8.7),
    },
    has_records: true,
    has_summary: true,
    ...overrides,
  };
}

const providerState: any = { timeline: [], requestPeriod: vi.fn(() => Promise.resolve(report())) };

vi.mock('../context/AppContext', () => ({ useApp: () => appState, useNumberLocale: () => 'de-DE' }));
vi.mock('../providers/EnergyProviderContext', () => ({ useEnergyProvider: () => providerState }));

describe('MemoryView', () => {
  beforeEach(() => {
    requestExport.mockClear();
    providerState.timeline = [];
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report()));
  });

  it('resolves the selected range through the authoritative period API for every range', async () => {
    render(<MemoryView />);
    // Called for the initial 'today' load.
    await waitFor(() => expect(providerState.requestPeriod).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Letzte 7 Tage' }));
    // A non-today range must ALSO query the API — never a hardcoded empty list.
    await waitFor(() => expect(providerState.requestPeriod).toHaveBeenCalledTimes(2));
  });

  it('shows stored summary totals with provenance, never a false no-data', async () => {
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report()));
    render(<MemoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Letzte 7 Tage' }));
    const summary = await screen.findByTestId('period-summary');
    await waitFor(() => expect(summary.getAttribute('data-availability')).toBe('summary'));
    expect(screen.getByText(/Gespeicherte Zählerstände/)).toBeTruthy();
    // PV is known but no curve in this report → precise summary-without-curve copy.
    expect(screen.getByText(/Solarertrag bekannt, Verlauf unvollständig/)).toBeTruthy();
    expect(screen.queryByText(/keine gespeicherten Messwerte vor/)).toBeNull();
  });

  it('renders a Fronius archive curve with explicit provenance', async () => {
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report({
      provenance: 'fronius_local_archive',
      has_curve: true,
      curve: {
        source: 'fronius_archive', mixed_source: false, segments: [],
        n_points: 2, n_local: 0, n_archive: 2, first: 'a', last: 'b', unavailable_reason: null,
        points: [
          { t: '2026-08-02T09:00:00Z', solar_w: 6000, grid_w: null, source: 'fronius_archive' },
          { t: '2026-08-02T09:05:00Z', solar_w: 6500, grid_w: null, source: 'fronius_archive' },
        ],
      },
    } as any)));
    render(<MemoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestern' }));
    const curve = await screen.findByTestId('history-curve');
    await waitFor(() => expect(curve.getAttribute('data-curve-source')).toBe('fronius_archive'));
    expect(screen.getByText('Verlauf aus dem Fronius-Datalogger')).toBeTruthy();
    expect(screen.getByText(/Solarertrag vom Fronius-Datalogger bestätigt/)).toBeTruthy();
    expect(screen.queryByText(/kein Verlauf vor/)).toBeNull();
  });

  it('labels a mixed local+archive curve as mixed-source', async () => {
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report({
      has_curve: true,
      curve: {
        source: 'mixed', mixed_source: true, segments: [],
        n_points: 2, n_local: 1, n_archive: 1, first: 'a', last: 'b', unavailable_reason: null,
        points: [
          { t: '2026-08-02T09:00:00Z', solar_w: 5900, grid_w: null, source: 'local' },
          { t: '2026-08-02T12:00:00Z', solar_w: 8000, grid_w: null, source: 'fronius_archive' },
        ],
      },
    } as any)));
    render(<MemoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Gestern' }));
    const curve = await screen.findByTestId('history-curve');
    await waitFor(() => expect(curve.getAttribute('data-curve-source')).toBe('mixed'));
    expect(screen.getByText(/Gemischter Verlauf/)).toBeTruthy();
  });

  it('distinguishes records-only from genuinely unavailable', async () => {
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report({ has_summary: false, has_records: true })));
    render(<MemoryView />);
    const summary = await screen.findByTestId('period-summary');
    await waitFor(() => expect(summary.getAttribute('data-availability')).toBe('records_only'));
    expect(screen.getByText(/keine belastbare Summe/)).toBeTruthy();
  });

  it('only reports genuinely unavailable when no records, summary or curve exist', async () => {
    providerState.requestPeriod = vi.fn(() => Promise.resolve(report({ has_summary: false, has_records: false, provenance: null })));
    render(<MemoryView />);
    const summary = await screen.findByTestId('period-summary');
    await waitFor(() => expect(summary.getAttribute('data-availability')).toBe('unavailable'));
    expect(screen.getByText(/keine gespeicherten Messwerte vor/)).toBeTruthy();
  });

  it('uses the selected range for the real export action', async () => {
    render(<MemoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
    fireEvent.click(screen.getByText('Export und Sicherung'));
    fireEvent.click(screen.getByRole('button', { name: 'Export speichern' }));
    expect(requestExport).toHaveBeenCalledWith('pdf', 'today', expect.any(String), expect.any(String));
  });
});
