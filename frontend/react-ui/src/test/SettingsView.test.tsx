import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  settingsSaveState: { status: 'idle' as const },
  devices: [],
};

vi.mock('../context/AppContext', () => ({
  useApp: () => mockAppContext,
  useNumberLocale: () =>
    mockAppContext.settingsPayload?.effective_settings?.number_format ?? 'de-DE',
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
    mockAppContext.settingsSaveState = { status: 'idle' };
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
    expect(screen.getByText('Darstellung')).toBeInTheDocument();
  });

  it('renders Standort & Wetter section', () => {
    render(<SettingsView />);
    expect(screen.getByText('Standort & Wetter')).toBeInTheDocument();
  });

  it('renders Geräte-IP-Adressen section', () => {
    render(<SettingsView />);
    expect(screen.getByText('Geräte')).toBeInTheDocument();
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
    expect(screen.getByText('Wetterstatus aktualisieren')).toBeInTheDocument();
    expect(screen.queryByText('Teste...')).toBeNull();
    expect(screen.getByText(/Zeitüberschreitung/)).toBeInTheDocument();
  });
});

describe('SettingsView - save confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppContext.settingsPayload = null;
    mockAppContext.weatherSearchState = { status: 'idle', requestId: null, candidates: [] };
    mockAppContext.savedLocationState = 'absent';
    mockAppContext.weatherTestState = { status: 'idle', requestId: null };
    mockAppContext.settingsSaveState = { status: 'idle' };
  });

  it('shows no success badge while the backend has not answered', () => {
    mockAppContext.settingsSaveState = { status: 'saving' };
    render(<SettingsView />);
    expect(screen.queryByText('Gespeichert')).toBeNull();
    expect(screen.getByText('Wird gespeichert…')).toBeInTheDocument();
  });

  it('shows the success badge only after the backend confirms', () => {
    mockAppContext.settingsSaveState = { status: 'saved' };
    render(<SettingsView />);
    expect(screen.getByText('Gespeichert')).toBeInTheDocument();
  });

  it('reports a failed save instead of claiming success', () => {
    mockAppContext.settingsSaveState = { status: 'error', message: 'Schreibfehler.' };
    render(<SettingsView />);
    expect(screen.queryByText('Gespeichert')).toBeNull();
    expect(screen.getByText('Schreibfehler.')).toBeInTheDocument();
  });
});

describe('SettingsView - number format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppContext.weatherSearchState = { status: 'idle', requestId: null, candidates: [] };
    mockAppContext.savedLocationState = 'saved';
    mockAppContext.weatherTestState = { status: 'idle', requestId: null };
    mockAppContext.settingsSaveState = { status: 'idle' };
  });

  const payloadWithLocale = (numberFormat: 'de-DE' | 'en-US') => ({
    settings: {
      resolved_location: {
        provider_id: '2937591',
        display_name: 'Dieburg',
        latitude: 49.89738,
        longitude: 8.84613,
        timezone: 'Europe/Berlin',
        provider: 'open_meteo',
        original_query: 'Dieburg',
        resolved_at: '2026-07-26T10:00:00Z',
      },
    },
    effective_settings: { number_format: numberFormat, weather_enabled: true },
    system: {},
  });

  it('formats coordinates with the German locale', () => {
    mockAppContext.settingsPayload = payloadWithLocale('de-DE');
    render(<SettingsView />);
    expect(screen.getByText(/49,8974/)).toBeInTheDocument();
  });

  it('formats coordinates with the English locale when configured', () => {
    mockAppContext.settingsPayload = payloadWithLocale('en-US');
    render(<SettingsView />);
    expect(screen.getByText(/49\.8974/)).toBeInTheDocument();
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

describe('SettingsView - persisted dirty state', () => {
  const payload = {
    settings: { preferred_name: 'Flo', greeting_enabled: true, theme: 'dark' },
    effective_settings: {
      preferred_name: 'Flo', greeting_enabled: true, theme: 'dark', dynamic_bg_enabled: true,
      motion_mode: 'full', text_size: 'normal', number_format: 'de-DE', weather_enabled: false,
      fronius_address: '192.0.2.1', mt175_address: '',
    },
    system: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppContext.settingsPayload = payload;
    mockAppContext.settingsSaveState = { status: 'idle' };
    mockAppContext.devices = [];
  });

  it('disables save and discard while clean, then persists the complete draft', () => {
    render(<SettingsView />);
    const save = screen.getByRole('button', { name: /Änderungen speichern/ });
    const discard = screen.getByRole('button', { name: /Verwerfen/ });
    expect(save).toBeDisabled();
    expect(discard).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Bevorzugter Name'), { target: { value: 'Florian' } });
    expect(save).toBeEnabled();
    expect(discard).toBeEnabled();
    fireEvent.click(save);
    expect(mockAppContext.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ preferred_name: 'Florian' }));
  });

  it('keeps edits after a failed save and discard restores persisted values', () => {
    const { rerender } = render(<SettingsView />);
    const input = screen.getByLabelText('Bevorzugter Name');
    fireEvent.change(input, { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: /Änderungen speichern/ }));

    mockAppContext.settingsSaveState = { status: 'error', message: 'Nicht gespeichert.' };
    rerender(<SettingsView />);
    expect(screen.getByDisplayValue('Unsaved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Änderungen speichern/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Verwerfen/ }));
    expect(screen.getByDisplayValue('Flo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Änderungen speichern/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Verwerfen/ })).toBeDisabled();
  });

  it('requires changed device addresses to be saved before checking', () => {
    render(<SettingsView />);
    const address = screen.getByDisplayValue('192.0.2.1');
    const check = screen.getByRole('button', { name: 'Verbindung prüfen' });
    fireEvent.change(address, { target: { value: '192.0.2.2' } });
    expect(check).toBeDisabled();
    expect(check).toHaveAttribute('title', 'Änderungen zuerst speichern');
    fireEvent.click(check);
    expect(mockAppContext.testConnection).not.toHaveBeenCalled();
  });

  it('programmatically labels both device address fields', () => {
    render(<SettingsView />);
    expect(screen.getByLabelText('Fronius Wechselrichter')).toHaveValue('192.0.2.1');

    fireEvent.click(screen.getByRole('button', { name: /Iskra MT631/ }));
    expect(screen.getByLabelText('IP oder Hostname des SmartMeterReaders')).toBeInTheDocument();
  });
});
