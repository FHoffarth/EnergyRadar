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
  });

  it('replaces the chart with an explanation when no series qualifies', () => {
    providerState.timeline = timeline([{ solar: 0.1 }, { solar: null }]);
    render(<TodayView />);
    expect(
      screen.getByText('Für heute liegen noch nicht genug Messwerte für eine Verlaufskurve vor.'),
    ).toBeTruthy();
  });
});
