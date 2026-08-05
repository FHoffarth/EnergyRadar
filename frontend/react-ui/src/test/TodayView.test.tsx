import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayView } from '../views/TodayView';
import { TimelineEntry } from '../types';

const providerState: { timeline: TimelineEntry[]; sourceType: 'demo' | 'bridge' | 'offline' } = {
  timeline: [],
  sourceType: 'bridge',
};

const appState: any = { settingsPayload: null };

vi.mock('../providers/EnergyProviderContext', () => ({
  useEnergyProvider: () => providerState,
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => appState,
  useNumberLocale: () =>
    appState.settingsPayload?.effective_settings?.number_format ?? 'de-DE',
}));

const DAY = new Date(); DAY.setHours(0, 0, 0, 0);
/** Build today-dated timeline points at explicit hh:mm (aggregation needs timestampMs). */
function at(entries: [number, number, number | null, number | null][]): TimelineEntry[] {
  return entries.map(([hh, mm, solar, home]) => ({
    time: `${hh}:${mm}`,
    timestampMs: DAY.getTime() + (hh * 60 + mm) * 60_000,
    solarKw: solar, homeLoadKw: home, gridKw: null, batteryPct: null, origin: 'observed',
  }));
}

describe('TodayView - 24-hour chronicle (aggregated)', () => {
  beforeEach(() => {
    providerState.timeline = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
  });

  it('renders the PV area + consumption line legend when both series exist', () => {
    providerState.timeline = at([[10, 0, 0.2, 0.4], [10, 20, 0.3, 0.5], [10, 40, 0.4, 0.6]]);
    render(<TodayView />);
    expect(screen.getByText('Solarerzeugung')).toBeTruthy();       // unique chart legend
    expect(screen.getAllByText('Hausverbrauch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('img', { name: /24-Stunden-Chronik/ })).toBeTruthy();
    // Old per-series vocabulary is gone.
    expect(screen.queryByText('Speicher %')).toBeNull();
  });

  it('reports complete data when there are no interior gaps', () => {
    providerState.timeline = at([[10, 0, 0.2, 0.4], [10, 15, 0.3, 0.5]]);
    render(<TodayView />);
    expect(screen.getByTestId('chart-data-quality').textContent).toMatch(/vollständig/);
  });

  it('marks interior gaps compactly and never bridges them', () => {
    providerState.timeline = at([[10, 0, 0.2, 0.4], [12, 0, 0.3, 0.5]]); // 11:00 hour is a gap
    render(<TodayView />);
    expect(screen.getByText('Datenlücke')).toBeTruthy();
    expect(screen.getByTestId('chart-data-quality').textContent).toMatch(/unvollständig/);
    expect(screen.getByText(/nicht.*überbrückt/)).toBeTruthy();
  });

  it('discloses spikes above the visible scale instead of a needle forest', () => {
    // A calm ~0.3 kW day with one brief consumption spike inside a bucket.
    const pts: TimelineEntry[] = [];
    for (let h = 9; h < 16; h++) for (let m = 0; m < 60; m += 15) pts.push(...at([[h, m, 0.3, 0.3]]));
    pts.push(...at([[12, 3, 0.3, 2.6]]));
    providerState.timeline = pts;
    render(<TodayView />);
    expect(screen.getByTestId('chart-peak-note').textContent).toMatch(/über der sichtbaren Skala/);
    expect(screen.getByTestId('chart-peak-note').textContent).toMatch(/2,6/);
  });

  it('shows the empty state when there is no data at all', () => {
    providerState.timeline = [];
    render(<TodayView />);
    expect(screen.getByText(/Der Tagesverlauf steht zur Verfügung/)).toBeTruthy();
  });
});
