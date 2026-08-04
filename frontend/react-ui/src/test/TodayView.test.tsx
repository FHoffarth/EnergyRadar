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

function timeline(
  points: { solar?: number | null; home?: number | null; battery?: number | null }[],
): TimelineEntry[] {
  return points.map((point, index) => ({
    time: `0${index}:00`,
    solarKw: point.solar ?? null,
    homeLoadKw: point.home ?? null,
    gridKw: null,
    batteryPct: point.battery ?? null,
    origin: 'observed',
  }));
}

describe('TodayView - per-series evidence thresholds', () => {
  beforeEach(() => {
    providerState.timeline = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
  });

  it('hides a legend entry for a series that has no measurements', () => {
    providerState.timeline = timeline([
      { solar: 0.1 }, { solar: 0.2 }, { solar: 0.3 },
    ]);
    render(<TodayView />);
    expect(screen.getByText('Solar')).toBeTruthy();
    expect(screen.queryByText('Verbrauch')).toBeNull();
    expect(screen.queryByText('Speicher %')).toBeNull();
  });

  it('hides a series that stays below the evidence threshold', () => {
    providerState.timeline = timeline([
      { solar: 0.1, home: 0.4 }, { solar: 0.2 }, { solar: 0.3 },
    ]);
    render(<TodayView />);
    expect(screen.getByText('Solar')).toBeTruthy();
    expect(screen.queryByText('Verbrauch')).toBeNull();
  });

  it('shows a series once it reaches the evidence threshold', () => {
    providerState.timeline = timeline([
      { solar: 0.1, home: 0.4 }, { solar: 0.2, home: 0.5 }, { solar: 0.3, home: 0.6 },
    ]);
    render(<TodayView />);
    expect(screen.getByText('Solar')).toBeTruthy();
    expect(screen.getByText('Verbrauch')).toBeTruthy();
    expect(screen.getByTestId('today-workspace').className).toContain('cockpit-page');
    const chartFrame = screen.getByText('24-Stunden-Chronik')
      .closest('section')
      ?.querySelector('.recharts-responsive-container')
      ?.parentElement;
    expect(chartFrame?.className).toContain('h-[clamp(20rem,48vh,34rem)]');
  });

  it('replaces the chart with an explanation when no series qualifies', () => {
    providerState.timeline = timeline([{ solar: 0.1 }, { solar: null }]);
    render(<TodayView />);
    expect(
      screen.getByText('Für heute liegen noch nicht genug Messwerte für eine Verlaufskurve vor.'),
    ).toBeTruthy();
  });

  it('announces the same visible timestamp gap used by the shared chart adapter', () => {
    appState.settingsPayload = { system: { recording_interval_seconds: 5 } };
    providerState.timeline = [
      { time: '12:00:00', timestampMs: 0, solarKw: 0, homeLoadKw: null, gridKw: null, batteryPct: null, origin: 'observed' },
      { time: '12:00:20', timestampMs: 20_000, solarKw: 1, homeLoadKw: null, gridKw: null, batteryPct: null, origin: 'observed' },
    ];
    render(<TodayView />);
    expect(screen.getByRole('img', { name: /1 sichtbaren Datenlücke/ })).toBeTruthy();
    expect(screen.getByText(/Datenlücke \(keine Messwerte\)/)).toBeTruthy();
    // Gaps are shown as gaps, never bridged by an artificial line.
    expect(screen.getByText(/nicht überbrückt/)).toBeTruthy();
  });

  it('uses persisted recording cadence instead of the faster live polling cadence', () => {
    appState.settingsPayload = {
      effective_settings: { refresh_seconds: 5 },
      system: { recording_interval_seconds: 60 },
    };
    providerState.timeline = [
      { time: '12:00:00', timestampMs: 0, solarKw: 0, homeLoadKw: null, gridKw: null, batteryPct: null, origin: 'observed' },
      { time: '12:01:00', timestampMs: 60_000, solarKw: 1, homeLoadKw: null, gridKw: null, batteryPct: null, origin: 'observed' },
    ];
    render(<TodayView />);
    expect(screen.getByRole('img', { name: /0 sichtbaren Datenlücken/ })).toBeTruthy();
    expect(screen.queryByText(/Datenlücke \(keine Messwerte\)/)).toBeNull();
  });
});
