import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsView } from '../views/SettingsView';

// Mock AppContext
const mockAppContext: any = {
  settingsPayload: null,
  chooseExportDirectory: vi.fn(),
  openExportDirectory: vi.fn(),
  searchWeatherLocations: vi.fn(),
  weatherSearchState: {
    status: 'idle' as const,
    requestId: null,
    candidates: [],
  },
  savedLocationState: 'absent' as const,
  confirmWeatherLocation: vi.fn(),
  removeResolvedLocation: vi.fn(),
  testWeatherConnection: vi.fn(),
  weatherTestState: { status: 'idle' as const, requestId: null },
  weatherReport: null,
  openDiagnosticLog: vi.fn(),
  openLogDirectory: vi.fn(),
  setTheme: vi.fn(),
  saveFroniusAddress: vi.fn(),
  testConnection: vi.fn(),
  testConnectionStatus: {},
  updateSettings: vi.fn(),
};

vi.mock('../context/AppContext', () => ({
  useApp: () => mockAppContext,
}));

// SetupWizardModal has a reference to useApp, etc.
vi.mock('../components/SetupWizardModal', () => ({
  SetupWizardModal: () => null,
}));

describe('SettingsView - no provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppContext.settingsPayload = null;
    mockAppContext.weatherSearchState = {
      status: 'idle',
      requestId: null,
      candidates: [],
    };
    mockAppContext.savedLocationState = 'absent';
    mockAppContext.weatherTestState = { status: 'idle', requestId: null };
  });

  it('does not render "Datenanbieter" section', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Datenanbieter')).toBeNull();
  });

  it('does not render "Demo-Modus" radio', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Demo-Modus')).toBeNull();
  });

  it('does not render "Desktop-Bridge" radio', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Desktop-Bridge')).toBeNull();
  });

  it('does not render demo preset selector', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Demo-Szenario')).toBeNull();
  });

  it('does not render Telemetrie-Jitter', () => {
    render(<SettingsView />);
    expect(screen.queryByText('Telemetrie-Jitter')).toBeNull();
  });

  it('renders Fronius Wechselrichter configuration', () => {
    render(<SettingsView />);
    expect(screen.getByText('Fronius Wechselrichter')).toBeInTheDocument();
  });

  it('renders Theme section', () => {
    render(<SettingsView />);
    expect(screen.getByText('Darstellung & Theme')).toBeInTheDocument();
  });

  it('renders Standort & Wetter section', () => {
    render(<SettingsView />);
    expect(screen.getByText('Standort & Wetter')).toBeInTheDocument();
  });

  it('renders Geräte-IP-Adressen section', () => {
    render(<SettingsView />);
    expect(screen.getByText('Geräte-IP-Adressen')).toBeInTheDocument();
  });

  it('never shows an empty search message beside a saved location', () => {
    mockAppContext.settingsPayload = {
      settings: {
        resolved_location: {
          provider_id: '2937591',
          display_name: 'Dieburg, Hessen, Deutschland',
          latitude: 49.89738,
          longitude: 8.84613,
          timezone: 'Europe/Berlin',
          provider: 'open_meteo',
          original_query: 'Dieburg',
          resolved_at: '2026-07-26T10:00:00Z',
        },
      },
      effective_settings: {
        theme: 'dark',
        dynamic_bg_enabled: true,
        motion_mode: 'full',
        text_size: 'normal',
        number_format: 'de-DE',
        weather_enabled: true,
      },
      system: {},
    };
    mockAppContext.savedLocationState = 'saved';
    mockAppContext.weatherSearchState = {
      status: 'empty',
      requestId: 'old-search',
      candidates: [],
    };

    render(<SettingsView />);
    expect(screen.getByText('Dieburg, Hessen, Deutschland')).toBeInTheDocument();
    expect(screen.queryByText(/Keine Standorte gefunden/)).toBeNull();
  });

  it('returns the weather-test button from loading after a timeout', () => {
    mockAppContext.weatherTestState = {
      status: 'timeout',
      requestId: 'weather-test-1',
      result: {
        ok: false,
        message: 'Zeitüberschreitung — Wetterdienst antwortet nicht.',
      },
    };

    render(<SettingsView />);
    expect(screen.getByText('Wetterverbindung testen')).toBeInTheDocument();
    expect(screen.queryByText('Teste...')).toBeNull();
    expect(screen.getByText(/Zeitüberschreitung/)).toBeInTheDocument();
  });
});

// Verify SettingsView does not import useEnergyProvider
describe('SettingsView - no dual wiring', () => {
  it('does not use EnergyProviderContext', () => {
    // Read the source file to verify no useEnergyProvider import
    const fs = require('fs');
    const source = fs.readFileSync(__filename.replace(/\\/g, '/').replace('/test/', '/views/').replace('.test.tsx', '.tsx'), 'utf-8');
    expect(source).not.toContain('useEnergyProvider');
    expect(source).not.toContain('EnergyProviderContext');
  });
});
