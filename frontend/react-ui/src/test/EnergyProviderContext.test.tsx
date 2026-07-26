import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { EnergyProviderRoot, useEnergyProvider } from '../providers/EnergyProviderContext';

// Factory for a minimal Qt bridge object that satisfies DesktopBridgeEnergyProviderImpl
function createMockQtBridge() {
  return {
    nowData: '{}',
    todayData: '{}',
    devicesData: '[]',
    settingsData: '{}',
    nowDataChanged: { connect: vi.fn() },
    todayDataChanged: { connect: vi.fn() },
    devicesDataChanged: { connect: vi.fn() },
    settingsDataChanged: { connect: vi.fn() },
    connectionTestStarted: { connect: vi.fn() },
    connectionTestResult: { connect: vi.fn() },
    testConnection: vi.fn(),
    updateSettings: vi.fn(),
    saveFroniusAddress: vi.fn(),
    saveSettings: vi.fn(),
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
    exportStarted: { connect: vi.fn() },
    exportCompleted: { connect: vi.fn() },
    exportFailed: { connect: vi.fn() },
    mailHandoffPrepared: { connect: vi.fn() },
    settingsSaveSucceeded: { connect: vi.fn() },
    settingsSaveFailed: { connect: vi.fn() },
    directorySelected: { connect: vi.fn() },
    weatherConfigurationResult: { connect: vi.fn() },
    systemActionResult: { connect: vi.fn() },
    weatherLocationSearchStarted: { connect: vi.fn() },
    weatherCandidatesResult: { connect: vi.fn() },
    weatherLocationConfirmed: { connect: vi.fn() },
    weatherConnectionTestStarted: { connect: vi.fn() },
    weatherConnectionTestResult: { connect: vi.fn() },
    weatherReportChanged: { connect: vi.fn() },
  };
}

// Mock bridge module to control initBridge() return value
const mockInitBridge = vi.fn();
vi.mock('../lib/bridge', () => ({
  initBridge: () => mockInitBridge(),
  getBridge: () => null,
}));

// Mock energyService observables
vi.mock('../lib/energyService', () => ({
  nowData$: { subscribe: vi.fn(() => () => {}), get: vi.fn(() => ({ power: {}, status: 'no_data' })) },
  todayData$: { subscribe: vi.fn(() => () => {}), get: vi.fn(() => ({ history: [] })) },
  startEnergyService: vi.fn(),
}));

function renderInContext(ui: React.ReactElement, demoMode?: boolean) {
  return render(
    <EnergyProviderRoot demoMode={demoMode}>
      {ui}
    </EnergyProviderRoot>
  );
}

describe('EnergyProviderContext - bridge availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses bridge provider when bridge is available', async () => {
    mockInitBridge.mockResolvedValue(createMockQtBridge());
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.sourceType).toBe('bridge');
    });
  });

  it('uses offline state when bridge is unavailable', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.sourceType).toBe('offline');
    });
  });

  it('does NOT default to demo', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.sourceType).not.toBe('demo');
    });
  });
});

describe('EnergyProviderContext - demo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates demo when demoMode prop is true', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot demoMode={true}>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.sourceType).toBe('demo');
    });
  });

  it('activates demo regardless of bridge availability', async () => {
    mockInitBridge.mockResolvedValue(createMockQtBridge());
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot demoMode={true}>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      // demoMode takes priority over bridge
      expect(result.current.sourceType).toBe('demo');
    });
  });
});

describe('EnergyProviderContext - isBridgeConnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true when bridge is connected', async () => {
    mockInitBridge.mockResolvedValue(createMockQtBridge());
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.isBridgeConnected).toBe(true);
    });
  });

  it('is false when offline', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.isBridgeConnected).toBe(false);
    });
  });

  it('is false in demo mode', async () => {
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot demoMode={true}>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.isBridgeConnected).toBe(false);
    });
  });
});

describe('EnergyProviderContext - offline behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows offline snapshot when not connected', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect(result.current.snapshot.quality).toBe('unavailable');
      expect(result.current.snapshot.warnings.length).toBeGreaterThan(0);
      expect(result.current.snapshot.solar.valueKw).toBeNull();
      expect(result.current.timeline).toEqual([]);
      expect(result.current.devices).toEqual([]);
    });
  });
});

describe('EnergyProviderContext - no providerType in public API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose providerType', async () => {
    mockInitBridge.mockResolvedValue(null);
    const { result } = renderHook(() => useEnergyProvider(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <EnergyProviderRoot>{children}</EnergyProviderRoot>
      ),
    });
    await vi.waitFor(() => {
      expect('providerType' in result.current).toBe(false);
      expect('setProviderType' in result.current).toBe(false);
      expect('selectDemoPreset' in result.current).toBe(false);
      expect('toggleDemoJitter' in result.current).toBe(false);
      expect('getAvailableDemoPresets' in result.current).toBe(false);
    });
  });
});
