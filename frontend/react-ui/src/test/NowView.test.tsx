import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NowView } from '../views/NowView';
import { EnergySnapshot, TimelineEntry, DemoDeviceSummary } from '../types';

const providerState: {
  snapshot: EnergySnapshot;
  timeline: TimelineEntry[];
  devices: DemoDeviceSummary[];
  sourceType: 'demo' | 'bridge' | 'offline';
} = {
  snapshot: emptySnapshot(),
  timeline: [],
  devices: [],
  sourceType: 'bridge',
};

const appState: any = {
  settingsPayload: null,
  weatherReport: null,
};

vi.mock('../providers/EnergyProviderContext', () => ({
  useEnergyProvider: () => providerState,
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => appState,
  useNumberLocale: () =>
    appState.settingsPayload?.effective_settings?.number_format ?? 'de-DE',
}));

function emptySnapshot(): EnergySnapshot {
  return {
    timestamp: null,
    quality: 'unavailable',
    solar: { valueKw: null, origin: 'unavailable' },
    homeLoad: { valueKw: null, origin: 'unavailable' },
    grid: { valueKw: null, origin: 'unavailable' },
    battery: null,
    assessment: null,
    warnings: [],
  };
}

function solarOnlySnapshot(kw: number): EnergySnapshot {
  return {
    ...emptySnapshot(),
    quality: 'live',
    timestamp: '12:30:00',
    solar: { valueKw: kw, origin: 'observed' },
  };
}

function solarTimeline(values: (number | null)[]): TimelineEntry[] {
  return values.map((value, index) => ({
    time: `0${index}:00`,
    solarKw: value,
    homeLoadKw: null,
    gridKw: null,
    batteryPct: null,
    origin: 'observed',
  }));
}

describe('NowView - top-level statement', () => {
  beforeEach(() => {
    providerState.snapshot = emptySnapshot();
    providerState.timeline = [];
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
    appState.weatherReport = null;
  });

  it('states the measured PV value and names the missing channels', () => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    render(<NowView />);
    expect(
      screen.getByRole('heading', {
        name: 'PV liefert aktuell 0,3 kW. Verbrauch und Netz sind noch nicht verfügbar.',
      }),
    ).toBeTruthy();
  });

  it('names only the single missing channel when one is measured', () => {
    providerState.snapshot = {
      ...solarOnlySnapshot(1.2),
      homeLoad: { valueKw: 0.8, origin: 'observed' },
    };
    render(<NowView />);
    expect(
      screen.getByRole('heading', {
        name: 'PV liefert aktuell 1,2 kW. Netz ist noch nicht verfügbar.',
      }),
    ).toBeTruthy();
  });

  it('reports an unreachable device instead of inventing values', () => {
    providerState.snapshot = { ...emptySnapshot(), quality: 'error' };
    render(<NowView />);
    expect(screen.getByRole('heading', { name: 'Gerät momentan nicht erreichbar.' })).toBeTruthy();
  });

  it('reports a missing data source when nothing is measured', () => {
    render(<NowView />);
    expect(screen.getByRole('heading', { name: 'Keine Datenquelle eingerichtet.' })).toBeTruthy();
  });

  it('renders the heading exactly once — no duplicated statement block', () => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    render(<NowView />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('NowView - unknown values', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    providerState.timeline = [];
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
    appState.weatherReport = null;
  });

  it('shows an unknown marker rather than zero for unmeasured channels', () => {
    render(<NowView />);
    const flow = screen.getByLabelText('Momentane Leistungswerte');
    expect(flow.textContent).toContain('—');
    expect(flow.textContent).not.toContain('0,0');
  });

  it('does not render a "Momentane Leistungsflüsse" duplicate block', () => {
    render(<NowView />);
    expect(screen.queryByText(/Momentane Leistungsflüsse/)).toBeNull();
  });
});

describe('NowView - number format setting', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(1234.5);
    providerState.timeline = [];
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.weatherReport = null;
  });

  it('formats numbers with the German locale by default', () => {
    appState.settingsPayload = null;
    render(<NowView />);
    expect(screen.getByLabelText('Momentane Leistungswerte').textContent).toContain('1.234,5');
  });

  it('formats numbers with the English locale when configured', () => {
    appState.settingsPayload = { effective_settings: { number_format: 'en-US' } };
    render(<NowView />);
    expect(screen.getByLabelText('Momentane Leistungswerte').textContent).toContain('1,234.5');
  });
});

describe('NowView - day trend evidence threshold', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
    appState.weatherReport = null;
  });

  it('hides the trend when too few points were measured', () => {
    providerState.timeline = solarTimeline([0.1, 0.2]);
    render(<NowView />);
    expect(screen.getByText('Noch nicht genug Messpunkte für einen Tagesverlauf.')).toBeTruthy();
  });

  it('does not count null samples towards the evidence threshold', () => {
    providerState.timeline = solarTimeline([0.1, null, null, null]);
    render(<NowView />);
    expect(screen.getByText('Noch nicht genug Messpunkte für einen Tagesverlauf.')).toBeTruthy();
  });

  it('shows the trend once enough points were measured', () => {
    providerState.timeline = solarTimeline([0.1, 0.2, 0.3]);
    render(<NowView />);
    expect(screen.queryByText('Noch nicht genug Messpunkte für einen Tagesverlauf.')).toBeNull();
    expect(screen.getByLabelText('Gemessener PV-Tagesverlauf')).toBeTruthy();
  });
});

describe('NowView - system status row', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    providerState.timeline = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
    appState.weatherReport = null;
  });

  it('summarises devices and weather in a single compact row', () => {
    providerState.devices = [
      { id: 'fronius_primary', name: 'Fronius', status: 'active' } as DemoDeviceSummary,
      { id: 'mt175_primary', name: 'Zähler', status: 'idle' } as DemoDeviceSummary,
    ];
    appState.settingsPayload = { effective_settings: { weather_enabled: true } };
    appState.weatherReport = {
      status: 'available',
      current: { condition: 'clear', temperature_c: 21 },
    };

    render(<NowView />);
    expect(screen.getByTestId('system-status-row').textContent).toBe(
      'Fronius online · Zähler nicht verbunden · Klar 21 °C',
    );
  });

  it('omits weather entirely when the weather feature is off', () => {
    providerState.devices = [
      { id: 'fronius_primary', name: 'Fronius', status: 'active' } as DemoDeviceSummary,
    ];
    render(<NowView />);
    expect(screen.getByTestId('system-status-row').textContent).toBe('Fronius online');
  });
});
