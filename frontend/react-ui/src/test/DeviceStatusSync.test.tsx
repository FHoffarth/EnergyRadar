/**
 * Regression cover for device connection status synchronisation.
 *
 * The bridge re-emits devicesDataChanged on every poll, but the provider only
 * refreshed a private cache: React's device list was read once during setup —
 * while bridge.devicesData was still "[]" — and never again. The Now status row
 * therefore claimed "Keine Geräte verbunden" for the whole session even while
 * Fronius and MT175 were connected and delivering.
 */
import React, { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import { EnergyProviderRoot, useEnergyProvider } from '../providers/EnergyProviderContext';

type Handler = () => void;

/** Mock Qt bridge whose device payload can be changed and re-emitted. */
function createMockQtBridge() {
  const handlers: Record<string, Handler[]> = {};
  const signal = (name: string) => ({
    connect: vi.fn((cb: Handler) => {
      (handlers[name] ||= []).push(cb);
    }),
    disconnect: vi.fn((cb: Handler) => {
      handlers[name] = (handlers[name] || []).filter(h => h !== cb);
    }),
  });

  const bridge: any = {
    // Python starts with an empty list until the first poll completes.
    nowData: '{}',
    todayData: '{}',
    devicesData: '[]',
    settingsData: '{}',
    nowDataChanged: signal('now'),
    todayDataChanged: signal('today'),
    devicesDataChanged: signal('devices'),
    settingsDataChanged: signal('settings'),
    connectionTestStarted: signal('testStarted'),
    connectionTestResult: signal('testResult'),
    testConnection: vi.fn(),
    updateSettings: vi.fn(),
    saveSettings: vi.fn(),
    saveFroniusAddress: vi.fn(),
    chooseExportDirectory: vi.fn(),
    openExportDirectory: vi.fn(),
    validateWeatherConfiguration: vi.fn(),
    searchWeatherLocations: vi.fn(),
    confirmWeatherLocation: vi.fn(),
    removeResolvedLocation: vi.fn(),
    requestWeatherReport: vi.fn(),
    testWeatherConnection: vi.fn(),
    openDiagnosticLog: vi.fn(),
    openLogDirectory: vi.fn(),
    requestExport: vi.fn(),
    requestMailShare: vi.fn(),
    exportStarted: signal('exportStarted'),
    exportCompleted: signal('exportCompleted'),
    exportFailed: signal('exportFailed'),
    mailHandoffPrepared: signal('mail'),
    settingsSaveSucceeded: signal('saveOk'),
    settingsSaveFailed: signal('saveFail'),
    directorySelected: signal('dir'),
    weatherConfigurationResult: signal('weatherCfg'),
    systemActionResult: signal('sysAction'),
    weatherLocationSearchStarted: signal('searchStart'),
    weatherCandidatesResult: signal('candidates'),
    weatherLocationConfirmed: signal('confirmed'),
    weatherConnectionTestStarted: signal('wTestStart'),
    weatherConnectionTestResult: signal('wTestResult'),
    weatherReportChanged: signal('weather'),
  };

  bridge.__handlers = handlers;
  /** Simulate a poll delivering a new device payload. */
  bridge.__emitDevices = (payload: unknown) => {
    bridge.devicesData = JSON.stringify(payload);
    (handlers['devices'] || []).forEach(h => h());
  };
  /** Re-emit without changing the payload, as a real poll cycle does. */
  bridge.__reemitDevices = () => {
    (handlers['devices'] || []).forEach(h => h());
  };
  bridge.__deviceHandlerCount = () => (handlers['devices'] || []).length;
  return bridge;
}

const CONNECTED_DEVICES = [
  {
    device_id: 'fronius_primary',
    display_name: 'Fronius Wechselrichter',
    device_type: 'inverter',
    connection_status: 'connected',
    user_message: 'Der Wechselrichter liefert aktuelle Energiedaten.',
    last_measurement_at: '17:33',
  },
  {
    device_id: 'mt175_primary',
    display_name: 'ISKRA MT175',
    device_type: 'smart_meter',
    connection_status: 'connected',
    user_message: 'Zählerstände sind verfügbar.',
    last_measurement_at: '17:33',
  },
];

const mockInitBridge = vi.fn();
const mockGetBridge = vi.fn(() => null);
vi.mock('../lib/bridge', () => ({
  initBridge: () => mockInitBridge(),
  getBridge: () => mockGetBridge(),
}));

vi.mock('../lib/energyService', () => ({
  nowData$: { subscribe: vi.fn(() => () => {}), get: vi.fn(() => ({ power: {}, status: 'no_data' })) },
  todayData$: { subscribe: vi.fn(() => () => {}), get: vi.fn(() => ({ history: [] })) },
  startEnergyService: vi.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <EnergyProviderRoot>{children}</EnergyProviderRoot>
);

describe('device status synchronisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBridge.mockReturnValue(null);
  });

  // 1 + 2: empty at setup, later update must reach the consumer.
  it('delivers device data that arrives after provider setup', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    const { result } = renderHook(() => useEnergyProvider(), { wrapper });
    // Listener bound => init() finished. Emitting earlier would be absorbed by
    // the initial read and would not test propagation.
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(result.current.sourceType).toBe('bridge');

    // Setup happened while devicesData was still "[]".
    expect(result.current.devices).toEqual([]);

    await act(async () => bridge.__emitDevices(CONNECTED_DEVICES));

    expect(result.current.devices).toHaveLength(2);
    expect(result.current.devices.map(d => d.name)).toEqual([
      'Fronius Wechselrichter',
      'ISKRA MT175',
    ]);
  });

  // 3: the visible Now status row must stop claiming no devices.
  it('stops reporting "Keine Geräte verbunden" once devices connect', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    function StatusRow() {
      const { devices } = useEnergyProvider();
      return (
        <p data-testid="row">
          {devices.length === 0
            ? 'Keine Geräte verbunden'
            : devices
                .map(d => `${d.name} ${d.status === 'active' ? 'online' : 'nicht verbunden'}`)
                .join(' · ')}
        </p>
      );
    }

    render(<EnergyProviderRoot><StatusRow /></EnergyProviderRoot>);
    // Wait until the provider has finished init and bound its listener,
    // otherwise the payload would be picked up by the initial read and this
    // would not exercise the update path at all.
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(screen.getByTestId('row').textContent).toBe('Keine Geräte verbunden');

    await act(async () => bridge.__emitDevices(CONNECTED_DEVICES));

    expect(screen.getByTestId('row').textContent).toBe(
      'Fronius Wechselrichter online · ISKRA MT175 online');
    expect(screen.getByTestId('row').textContent).not.toContain('Keine Geräte verbunden');
  });

  // 4: an unreachable device stays honestly represented, not silently "online".
  it('represents unreachable and configured devices honestly', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    const { result } = renderHook(() => useEnergyProvider(), { wrapper });
    // Listener bound => init() finished. Emitting earlier would be absorbed by
    // the initial read and would not test propagation.
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(result.current.sourceType).toBe('bridge');

    await act(async () => bridge.__emitDevices([
      { device_id: 'fronius_primary', display_name: 'Fronius', connection_status: 'error' },
      { device_id: 'mt175_primary', display_name: 'ISKRA MT175', connection_status: 'offline' },
      { device_id: 'x', display_name: 'Stale', connection_status: 'stale' },
    ]));

    const byName = Object.fromEntries(result.current.devices.map(d => [d.name, d.status]));
    expect(byName['Fronius']).toBe('unknown');       // error -> unknown, not active
    expect(byName['ISKRA MT175']).toBe('idle');      // offline -> idle, not active
    expect(byName['Stale']).toBe('last_known');      // stale -> last_known
    expect(Object.values(byName)).not.toContain('active');
  });

  // 5: an unchanged re-emission must not notify again.
  it('does not notify subscribers when a poll repeats the same payload', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    const { result } = renderHook(() => useEnergyProvider(), { wrapper });
    // Listener bound => init() finished. Emitting earlier would be absorbed by
    // the initial read and would not test propagation.
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(result.current.sourceType).toBe('bridge');

    await act(async () => bridge.__emitDevices(CONNECTED_DEVICES));
    const firstRef = result.current.devices;

    await act(async () => bridge.__reemitDevices());
    await act(async () => bridge.__reemitDevices());

    // Same array instance => no state update was pushed for the no-op polls.
    expect(result.current.devices).toBe(firstRef);
    expect(result.current.devices).toHaveLength(2);
  });

  // 5b: a genuine change after a repeat still propagates.
  it('still propagates a genuine change after repeated identical polls', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    const { result } = renderHook(() => useEnergyProvider(), { wrapper });
    // Listener bound => init() finished. Emitting earlier would be absorbed by
    // the initial read and would not test propagation.
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(result.current.sourceType).toBe('bridge');

    await act(async () => bridge.__emitDevices(CONNECTED_DEVICES));
    await act(async () => bridge.__reemitDevices());
    await act(async () => bridge.__emitDevices([
      { device_id: 'fronius_primary', display_name: 'Fronius', connection_status: 'error' },
    ]));

    expect(result.current.devices).toHaveLength(1);
    expect(result.current.devices[0].status).toBe('unknown');
  });

  // 6: no duplicate listeners, and cleanup on unmount.
  it('binds one device listener and releases it on unmount', async () => {
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);
    // getBridge() returning a bridge makes init() take the early-return path;
    // combined with the awaited path this would double-bind without a guard.
    mockGetBridge.mockReturnValue(bridge);

    const { result, unmount } = renderHook(() => useEnergyProvider(), { wrapper });
    await vi.waitFor(() => expect(result.current.sourceType).toBe('bridge'));

    expect(bridge.__deviceHandlerCount()).toBe(1);

    unmount();

    expect(bridge.__deviceHandlerCount()).toBe(0);
    expect(bridge.devicesDataChanged.disconnect).toHaveBeenCalled();
  });

  // 7: browser/mock (demo) mode keeps working.
  it('keeps demo mode functional and populated', async () => {
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot demoMode>{children}</EnergyProviderRoot>
      ),
    });

    await vi.waitFor(() => expect(result.current.sourceType).toBe('demo'));
    expect(result.current.devices.length).toBeGreaterThan(0);
  });
});

/**
 * The app mounts EnergyProviderRoot under React.StrictMode (main.tsx), which in
 * development mounts, tears down, then mounts again on the same instance. Setup
 * and teardown must therefore pair up: an "already initialised" guard combined
 * with a separate cleanup effect destroys the providers and never rebuilds them.
 */
describe('provider lifecycle under StrictMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBridge.mockReturnValue(null);
  });

  /** Captures the live context so it can be probed after everything settles. */
  let captured: ReturnType<typeof useEnergyProvider> | null = null;
  function Capture() {
    captured = useEnergyProvider();
    return null;
  }

  it('leaves the demo provider alive after the double-mount', async () => {
    captured = null;
    mockInitBridge.mockResolvedValue(null);

    render(
      <StrictMode>
        <EnergyProviderRoot demoMode><Capture /></EnergyProviderRoot>
      </StrictMode>
    );
    await vi.waitFor(() => expect(captured?.sourceType).toBe('demo'));

    // A destroyed provider falls through to the "no bridge" branch instead.
    const res = await captured!.testConnection('fronius_primary');
    expect(res.message).toContain('Demo-Modus');
    expect(captured!.devices.length).toBeGreaterThan(0);
  });

  it('keeps the bridge provider live and still propagates devices', async () => {
    captured = null;
    const bridge = createMockQtBridge();
    mockInitBridge.mockResolvedValue(bridge);

    render(
      <StrictMode>
        <EnergyProviderRoot><Capture /></EnergyProviderRoot>
      </StrictMode>
    );
    await vi.waitFor(() => expect(bridge.__deviceHandlerCount()).toBe(1));
    expect(captured?.sourceType).toBe('bridge');

    await act(async () => bridge.__emitDevices(CONNECTED_DEVICES));

    expect(captured!.devices).toHaveLength(2);
  });
});
