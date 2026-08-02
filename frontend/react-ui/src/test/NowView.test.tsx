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

describe('NowView - greeting preference', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    providerState.timeline = [];
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.weatherReport = null;
  });

  it('shows the locally configured preferred name', () => {
    appState.settingsPayload = { effective_settings: { greeting_enabled: true, preferred_name: 'Florian' } };
    render(<NowView />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Florian');
  });

  it('retains the factual home headline when the greeting is disabled', () => {
    appState.settingsPayload = { effective_settings: { greeting_enabled: false, preferred_name: 'Florian' } };
    render(<NowView />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('Florian');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('PV');
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

describe('NowView - one story, present tense', () => {
  beforeEach(() => {
    providerState.snapshot = solarOnlySnapshot(0.3);
    providerState.devices = [];
    providerState.sourceType = 'bridge';
    appState.settingsPayload = null;
    appState.weatherReport = null;
  });

  it('does not carry the day-history chart — that is Heute\'s story', () => {
    render(<NowView />);
    expect(screen.queryByLabelText('Gemessener PV-Tagesverlauf')).toBeNull();
    expect(screen.queryByText(/Messpunkte für einen Tagesverlauf/)).toBeNull();
    expect(screen.getByTestId('now-workspace').className).toContain('cockpit-page');
  });

  it('provides a non-visual summary of the live energy state', () => {
    providerState.snapshot = {
      ...solarOnlySnapshot(2.4),
      homeLoad: { valueKw: 1.1, origin: 'observed' },
      grid: { valueKw: -1.3, origin: 'observed' },
    };
    render(<NowView />);
    const summary = screen.getByTestId('flow-summary').textContent ?? '';
    expect(summary).toContain('Solar erzeugt 2,4 kW');
    expect(summary).toContain('das Haus verbraucht 1,1 kW');
    expect(summary).toContain('1,3 kW werden ins Netz eingespeist');
  });

  it('does not render a raw ISO observed-at timestamp on the primary surface', () => {
    providerState.snapshot = { ...solarOnlySnapshot(0.3), timestamp: '2026-08-02T11:14:56.803858+00:00' };
    render(<NowView />);
    expect(screen.queryByText(/2026-08-02T11:14:56/)).toBeNull();
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

  it('keeps device status technical and renders weather separately', () => {
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
      'Fronius online · Zähler nicht verbunden',
    );
    expect(screen.getByRole('region', { name: 'Wetter und Solarbedingungen' })).toBeTruthy();
    expect(screen.getByTestId('system-status-row').textContent).not.toContain('21 °C');
  });

  it('omits weather entirely when the weather feature is off', () => {
    providerState.devices = [
      { id: 'fronius_primary', name: 'Fronius', status: 'active' } as DemoDeviceSummary,
    ];
    render(<NowView />);
    expect(screen.getByTestId('system-status-row').textContent).toBe('Fronius online');
  });
});
