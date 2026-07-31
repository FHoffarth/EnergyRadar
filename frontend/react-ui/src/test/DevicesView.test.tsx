import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DevicesView } from '../views/DevicesView';
import { DemoDeviceSummary } from '../types';

const provider: any = { devices: [], sourceType: 'bridge', testConnection: vi.fn() };
vi.mock('../providers/EnergyProviderContext', () => ({ useEnergyProvider: () => provider }));
vi.mock('../context/AppContext', () => ({ useApp: () => ({ setView: vi.fn() }) }));

const device = (overrides: Partial<DemoDeviceSummary> = {}): DemoDeviceSummary => ({
  id: 'mt175_primary', name: 'Tasmota SmartMeterReader', category: 'smart_meter',
  status: 'idle', powerWatts: null, origin: 'unavailable', lastSeen: '',
  smartShedEnabled: false, notes: '', iconName: 'Server', ...overrides,
});

describe('DevicesView trustworthy controls and states', () => {
  it('does not infer online state from a configured device and qualifies unavailable power', () => {
    provider.devices = [device()];
    render(<DevicesView />);
    expect(screen.getByText('Noch nicht geprüft')).toBeInTheDocument();
    expect(screen.getByText('Nicht verfügbar')).toBeInTheDocument();
    expect(screen.queryByText('Aktiv')).toBeNull();
  });

  it('downgrades an allegedly active device with unavailable power to partial', () => {
    provider.devices = [device({ status: 'active', powerWatts: null })];
    render(<DevicesView />);
    expect(screen.getByText('Teilweise verfügbar')).toBeInTheDocument();
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('renders a genuine fresh zero but hides stale numeric values', () => {
    provider.devices = [device({ status: 'active', powerWatts: 0 })];
    const { rerender } = render(<DevicesView />);
    expect(screen.getByText('0 Watt')).toBeInTheDocument();
    provider.devices = [device({ status: 'last_known', powerWatts: 3557 })];
    rerender(<DevicesView />);
    expect(screen.getAllByText('Veraltet')).toHaveLength(2);
    expect(screen.queryByText('3557 Watt')).toBeNull();
  });

  it('invokes the backend once, shows loading, and announces success', async () => {
    let resolve!: (value: any) => void;
    provider.devices = [device({ status: 'partial' })];
    provider.testConnection = vi.fn(() => new Promise(r => { resolve = r; }));
    render(<DevicesView />);
    const button = screen.getByRole('button', { name: 'Jetzt prüfen' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(provider.testConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Verbindung wird geprüft/ })).toBeDisabled();
    resolve({ ok: true, status: 'success', message: 'Antwort erhalten.', latencyMs: 8, testedAt: new Date().toISOString(), capabilities: ['Power'] });
    expect(await screen.findByRole('status')).toHaveTextContent('Verbindung erfolgreich');
    expect(screen.getByText(/Letzte Antwort: vor 0 s/)).toBeInTheDocument();
    expect(screen.getByText('Verfügbar: Power')).toBeInTheDocument();
  });

  it.each([
    [{ ok: true, status: 'partial', message: 'Leistung fehlt.', latencyMs: 9 }, 'status', 'Teilweise verfügbar'],
    [{ ok: false, status: 'failure', message: 'Nicht erreichbar.', latencyMs: null }, 'alert', 'Verbindung fehlgeschlagen'],
  ])('announces partial and failure results', async (result, role, expected) => {
    provider.devices = [device({ status: 'offline' })];
    provider.testConnection = vi.fn().mockResolvedValue(result);
    render(<DevicesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    expect(await screen.findByRole(role)).toHaveTextContent(expected);
  });
});
