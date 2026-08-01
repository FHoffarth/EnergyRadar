import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../context/AppContext';

const bridgeMocks = vi.hoisted(() => ({
  initBridge: vi.fn(),
}));

vi.mock('../lib/bridge', () => ({
  initBridge: bridgeMocks.initBridge,
  getBridge: () => null,
}));

vi.mock('../lib/energyService', () => ({
  nowData$: {
    subscribe: vi.fn(() => () => {}),
    get: vi.fn(() => ({
      power: {
        solar: { state: 'unknown' },
        home: { state: 'unknown' },
        grid: { state: 'unknown' },
        lastUpdated: null,
      },
      status: 'no_data',
    })),
  },
  todayData$: {
    subscribe: vi.fn(() => () => {}),
    get: vi.fn(() => ({
      solarTotal: { state: 'unknown' },
      homeTotal: { state: 'unknown' },
      gridFeedInTotal: { state: 'unknown' },
      gridDrawTotal: { state: 'unknown' },
      selfSufficiency: { state: 'unknown' },
      selfConsumption: { state: 'unknown' },
      history: [],
    })),
  },
  startEnergyService: vi.fn(),
}));

type CallbackMap = Record<string, (...args: any[]) => void>;

function createSignal(callbacks: CallbackMap, name: string) {
  return {
    connect: vi.fn((callback: (...args: any[]) => void) => {
      callbacks[name] = callback;
    }),
  };
}

function createMockBridge(callbacks: CallbackMap) {
  return {
    nowData: '{}',
    todayData: '{}',
    devicesData: '[]',
    settingsData: JSON.stringify({
      settings: {},
      effective_settings: { theme: 'dark' },
    }),
    nowDataChanged: createSignal(callbacks, 'nowDataChanged'),
    todayDataChanged: createSignal(callbacks, 'todayDataChanged'),
    devicesDataChanged: createSignal(callbacks, 'devicesDataChanged'),
    settingsDataChanged: createSignal(callbacks, 'settingsDataChanged'),
    connectionTestStarted: createSignal(callbacks, 'connectionTestStarted'),
    connectionTestResult: createSignal(callbacks, 'connectionTestResult'),
    weatherCandidatesResult: createSignal(callbacks, 'weatherCandidatesResult'),
    weatherConnectionTestStarted: createSignal(callbacks, 'weatherConnectionTestStarted'),
    weatherConnectionTestResult: createSignal(callbacks, 'weatherConnectionTestResult'),
    weatherReportChanged: createSignal(callbacks, 'weatherReportChanged'),
    exportStarted: createSignal(callbacks, 'exportStarted'),
    exportCompleted: createSignal(callbacks, 'exportCompleted'),
    exportFailed: createSignal(callbacks, 'exportFailed'),
    mailHandoffPrepared: createSignal(callbacks, 'mailHandoffPrepared'),
    directorySelected: createSignal(callbacks, 'directorySelected'),
    settingsSaveSucceeded: createSignal(callbacks, 'settingsSaveSucceeded'),
    settingsSaveFailed: createSignal(callbacks, 'settingsSaveFailed'),
    weatherConfigurationResult: createSignal(callbacks, 'weatherConfigurationResult'),
    systemActionResult: createSignal(callbacks, 'systemActionResult'),
    weatherLocationSearchStarted: createSignal(callbacks, 'weatherLocationSearchStarted'),
    weatherLocationConfirmed: createSignal(callbacks, 'weatherLocationConfirmed'),
    searchWeatherLocations: vi.fn(),
    confirmWeatherLocation: vi.fn(),
    removeResolvedLocation: vi.fn(),
    requestWeatherReport: vi.fn(),
    testWeatherConnection: vi.fn(),
    testConnection: vi.fn(),
    updateSettings: vi.fn(),
    saveSettings: vi.fn(),
    saveFroniusAddress: vi.fn(),
    chooseExportDirectory: vi.fn(),
    openExportDirectory: vi.fn(),
    validateWeatherConfiguration: vi.fn(),
    openDiagnosticLog: vi.fn(),
    openLogDirectory: vi.fn(),
    requestExport: vi.fn(),
    requestMailShare: vi.fn(),
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('AppContext weather state machines', () => {
  let callbacks: CallbackMap;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    callbacks = {};
    bridge = createMockBridge(callbacks);
    bridgeMocks.initBridge.mockReset();
    bridgeMocks.initBridge.mockResolvedValue(bridge);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects stale search responses and accepts the current result', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.searchWeatherLocations('Dieburg'));
    const firstId = bridge.searchWeatherLocations.mock.calls[0][0];
    act(() => result.current.searchWeatherLocations('64807'));
    const secondId = bridge.searchWeatherLocations.mock.calls[1][0];

    act(() => {
      callbacks.weatherCandidatesResult(
        firstId,
        JSON.stringify({
          ok: true,
          operation_id: firstId,
          candidates: [{ provider_id: 'old', display_name: 'Alt' }],
        }),
      );
    });
    expect(result.current.weatherSearchState.status).toBe('loading');
    expect(result.current.weatherSearchState.candidates).toEqual([]);

    const dieburg = {
      provider_id: '2937591',
      display_name: 'Dieburg, Hessen, Deutschland',
      name: 'Dieburg',
      latitude: 49.89738,
      longitude: 8.84613,
      timezone: 'Europe/Berlin',
      provider: 'open_meteo',
    };
    act(() => {
      callbacks.weatherCandidatesResult(
        secondId,
        JSON.stringify({
          ok: true,
          operation_id: secondId,
          candidates: [dieburg],
        }),
      );
    });
    expect(result.current.weatherSearchState.status).toBe('results');
    expect(result.current.weatherSearchState.candidates).toEqual([dieburg]);
  });

  it('reports a settings save as saved only after the backend confirms', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.updateSettings({ number_format: 'en-US' }));
    expect(result.current.settingsSaveState.status).toBe('saving');

    act(() => callbacks.settingsSaveSucceeded(JSON.stringify({ ok: true })));
    expect(result.current.settingsSaveState.status).toBe('saved');
  });

  it('surfaces a failed settings save instead of a success message', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.updateSettings({ number_format: 'en-US' }));
    act(() =>
      callbacks.settingsSaveFailed(JSON.stringify({ ok: false, message: 'Einstellungen konnten nicht gespeichert werden.' })),
    );

    expect(result.current.settingsSaveState.status).toBe('error');
    expect(result.current.settingsSaveState.message).toBe('Einstellungen konnten nicht gespeichert werden.');
  });

  it('does not expose a raw backend exception from a failed settings save', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.updateSettings({ number_format: 'en-US' }));
    act(() => callbacks.settingsSaveFailed(JSON.stringify({ ok: false, error: "name 'os' is not defined" })));

    expect(result.current.settingsSaveState).toEqual({
      status: 'error',
      message: 'Einstellungen konnten nicht gespeichert werden.',
    });
  });

  it('wires every system action and blocks duplicate clicks until its result arrives', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    const actions = [
      ['chooseExportDirectory', bridge.chooseExportDirectory],
      ['openExportDirectory', bridge.openExportDirectory],
      ['openDiagnosticLog', bridge.openDiagnosticLog],
      ['openLogDirectory', bridge.openLogDirectory],
    ] as const;

    for (const [action, method] of actions) {
      act(() => {
        result.current[action]();
        result.current[action]();
      });
      expect(method).toHaveBeenCalledTimes(1);
      expect(result.current.systemActionState).toEqual(expect.objectContaining({ status: 'loading', action }));
      act(() => callbacks.systemActionResult(JSON.stringify({
        ok: true, status: 'success', action, message: 'Ausgeführt.',
      })));
      expect(result.current.systemActionState).toEqual(expect.objectContaining({ status: 'success', action }));
    }
  });

  it('keeps folder-picker cancellation unchanged and exposes a selected path as draft state', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));
    const settingsBefore = result.current.settingsPayload;

    act(() => result.current.chooseExportDirectory());
    act(() => callbacks.systemActionResult(JSON.stringify({
      ok: true, status: 'cancelled', action: 'chooseExportDirectory', message: 'Ordnerauswahl abgebrochen.',
    })));
    expect(result.current.settingsPayload).toBe(settingsBefore);
    expect(result.current.systemActionState.status).toBe('cancelled');

    act(() => result.current.chooseExportDirectory());
    act(() => callbacks.directorySelected('C:\\Users\\Flo\\Export Daten'));
    expect(result.current.settingsPayload).toBe(settingsBefore);
    expect(result.current.systemActionState).toEqual(expect.objectContaining({
      status: 'success',
      action: 'chooseExportDirectory',
      path: 'C:\\Users\\Flo\\Export Daten',
    }));
  });

  it('renders only a friendly system-action failure message', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.openExportDirectory());
    act(() => callbacks.systemActionResult(JSON.stringify({
      ok: false,
      action: 'openExportDirectory',
      error: "NameError: name 'os' is not defined",
    })));

    expect(result.current.systemActionState.message).toBe('Aktion konnte nicht ausgeführt werden.');
    expect(result.current.systemActionState.message).not.toContain('NameError');
  });

  it('runs one connection check at a time and exposes the backend result', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => {
      result.current.testConnection('mt175_primary');
      result.current.testConnection('mt175_primary');
    });
    expect(bridge.testConnection).toHaveBeenCalledTimes(1);

    act(() => callbacks.connectionTestStarted('mt175_primary', 'op-1'));
    expect(result.current.testConnectionStatus.mt175_primary.testing).toBe(true);

    act(() => callbacks.connectionTestResult('mt175_primary', 'op-1', JSON.stringify({
      ok: true, status: 'partial', message: 'Leistung fehlt.',
      tested_at: '2026-07-31T20:00:00Z', capabilities: ['ImportActive'],
    })));
    expect(result.current.testConnectionStatus.mt175_primary).toEqual(expect.objectContaining({
      testing: false,
      result: expect.objectContaining({ status: 'partial', tested_at: '2026-07-31T20:00:00Z' }),
    }));
  });

  it('requests the persisted weather report after the desktop bridge connects', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));
    expect(bridge.requestWeatherReport).toHaveBeenCalledTimes(1);
  });

  it('replaces successful weather with an unavailable refresh result', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => callbacks.weatherReportChanged(JSON.stringify({
      status: 'available',
      current: { condition: 'clear', temperature_c: 22 },
    })));
    expect(result.current.weatherReport?.status).toBe('available');

    act(() => callbacks.weatherReportChanged(JSON.stringify({
      status: 'unreachable',
      current: null,
      hourly: [],
    })));
    expect(result.current.weatherReport?.status).toBe('unreachable');
    expect(result.current.weatherReport?.current).toBeNull();
  });

  it('clears search feedback and invalidates an in-flight request when a location is selected', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.searchWeatherLocations('Dieburg'));
    const requestId = bridge.searchWeatherLocations.mock.calls[0][0];
    const candidate = {
      provider_id: '2937591',
      display_name: 'Dieburg, Hessen, Deutschland',
      name: 'Dieburg',
      latitude: 49.89738,
      longitude: 8.84613,
      timezone: 'Europe/Berlin',
      provider: 'open_meteo',
    };
    act(() => result.current.confirmWeatherLocation(candidate));

    expect(result.current.weatherSearchState).toEqual({
      status: 'idle',
      requestId: null,
      candidates: [],
    });
    act(() => {
      callbacks.weatherCandidatesResult(
        requestId,
        JSON.stringify({ ok: true, operation_id: requestId, candidates: [] }),
      );
    });
    expect(result.current.weatherSearchState.status).toBe('idle');
  });

  it('replaces a prior empty state with successful results', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.searchWeatherLocations('does-not-exist'));
    const emptyId = bridge.searchWeatherLocations.mock.calls[0][0];
    act(() => {
      callbacks.weatherCandidatesResult(
        emptyId,
        JSON.stringify({ ok: true, operation_id: emptyId, candidates: [] }),
      );
    });
    expect(result.current.weatherSearchState.status).toBe('empty');

    act(() => result.current.searchWeatherLocations('Dieburg'));
    const successId = bridge.searchWeatherLocations.mock.calls[1][0];
    act(() => {
      callbacks.weatherCandidatesResult(
        successId,
        JSON.stringify({
          ok: true,
          operation_id: successId,
          candidates: [{
            provider_id: '2937591',
            display_name: 'Dieburg, Hessen, Deutschland',
            name: 'Dieburg',
            latitude: 49.89738,
            longitude: 8.84613,
            timezone: 'Europe/Berlin',
            provider: 'open_meteo',
          }],
        }),
      );
    });
    expect(result.current.weatherSearchState.status).toBe('results');
    expect(result.current.weatherSearchState.candidates).toHaveLength(1);
  });

  it('rejects a late weather-test response after a newer request', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));

    act(() => result.current.testWeatherConnection());
    const firstId = bridge.testWeatherConnection.mock.calls[0][0];
    act(() => result.current.testWeatherConnection());
    const secondId = bridge.testWeatherConnection.mock.calls[1][0];

    act(() => {
      callbacks.weatherConnectionTestResult(
        firstId,
        JSON.stringify({ ok: true, operation_id: firstId, message: 'Alt' }),
      );
    });
    expect(result.current.weatherTestState.status).toBe('loading');

    act(() => {
      callbacks.weatherConnectionTestResult(
        secondId,
        JSON.stringify({
          ok: true,
          operation_id: secondId,
          message: 'Wetterdienst erreichbar.',
          latency_ms: 42,
        }),
      );
    });
    expect(result.current.weatherTestState.status).toBe('success');
    expect(result.current.weatherTestState.result?.message).toBe('Wetterdienst erreichbar.');
  });

  it('terminates a weather test with an explicit timeout', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));
    vi.useFakeTimers();

    act(() => result.current.testWeatherConnection());
    expect(result.current.weatherTestState.status).toBe('loading');
    act(() => vi.advanceTimersByTime(15000));

    expect(result.current.weatherTestState.status).toBe('timeout');
    expect(result.current.weatherTestState.result?.message).toContain('Zeitüberschreitung');
  });

  it('reports an explicit error when the desktop bridge is unavailable', async () => {
    bridgeMocks.initBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(false));

    act(() => result.current.testWeatherConnection());
    expect(result.current.weatherTestState.status).toBe('error');
    expect(result.current.weatherTestState.result?.message).toBe(
      'Desktop-Verbindung ist nicht verfügbar.',
    );
  });
});
