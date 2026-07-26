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

  it('requests the persisted weather report after the desktop bridge connects', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    await waitFor(() => expect(result.current.bridgeConnected).toBe(true));
    expect(bridge.requestWeatherReport).toHaveBeenCalledTimes(1);
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
