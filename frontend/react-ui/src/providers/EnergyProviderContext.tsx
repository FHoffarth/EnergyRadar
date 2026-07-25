import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { EnergySnapshot, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, ProviderType, DemoPresetId } from '../types';
import { EnergyDataProvider } from './types';
import { DemoEnergyProviderImpl } from './DemoEnergyProvider';
import { DesktopBridgeEnergyProviderImpl } from './DesktopBridgeEnergyProvider';

interface EnergyProviderContextType {
  provider: EnergyDataProvider | null;
  providerType: ProviderType;
  snapshot: EnergySnapshot;
  timeline: TimelineEntry[];
  devices: DemoDeviceSummary[];
  setProviderType: (type: ProviderType) => void;
  selectDemoPreset: (presetId: DemoPresetId) => void;
  toggleDemoJitter: (enabled: boolean) => void;
  getAvailableDemoPresets: () => Array<{ id: DemoPresetId; name: string; description: string }>;
  testConnection: (deviceId: string) => Promise<ConnectionTestResult>;
  updateSettings: (patch: Partial<RawSettings>) => void;
  getSettings: () => RawSettings | null;
}

const defaultSnapshot: EnergySnapshot = {
  timestamp: null,
  quality: 'unavailable',
  solar: { valueKw: null, origin: 'unavailable' },
  homeLoad: { valueKw: null, origin: 'unavailable' },
  grid: { valueKw: null, origin: 'unavailable' },
  battery: null,
  assessment: null,
  warnings: ['Kein Datenanbieter aktiv']
};

const EnergyProviderContext = createContext<EnergyProviderContextType | undefined>(undefined);

export function EnergyProviderRoot({ children }: { children: ReactNode }) {
  const [providerType, setProviderTypeState] = useState<ProviderType>('demo');
  const [snapshot, setSnapshot] = useState<EnergySnapshot>(defaultSnapshot);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [devices, setDevices] = useState<DemoDeviceSummary[]>([]);
  const demoRef = useRef<DemoEnergyProviderImpl | null>(null);
  const bridgeRef = useRef<DesktopBridgeEnergyProviderImpl | null>(null);

  const destroyCurrent = useCallback(() => {
    if (demoRef.current) {
      demoRef.current.destroy();
      demoRef.current = null;
    }
    if (bridgeRef.current) {
      bridgeRef.current.destroy();
      bridgeRef.current = null;
    }
  }, []);

  const createDemo = useCallback(() => {
    destroyCurrent();
    const provider = new DemoEnergyProviderImpl();
    demoRef.current = provider;
    setSnapshot(provider.getCurrentSnapshot());
    setTimeline(provider.getTimeline());
    setDevices(provider.getDevices());
    provider.subscribe(setSnapshot);
    return provider;
  }, [destroyCurrent]);

  const createBridge = useCallback(async () => {
    destroyCurrent();
    const provider = new DesktopBridgeEnergyProviderImpl();
    bridgeRef.current = provider;
    setSnapshot(provider.getCurrentSnapshot());
    setDevices(provider.getDevices());
    provider.subscribe(setSnapshot);
    await provider.init();
    setDevices(provider.getDevices());
    return provider;
  }, [destroyCurrent]);

  const setProviderType = useCallback((type: ProviderType) => {
    setProviderTypeState(type);
    if (type === 'demo') {
      createDemo();
    } else if (type === 'bridge') {
      createBridge();
    }
  }, [createDemo, createBridge]);

  const selectDemoPreset = useCallback((presetId: DemoPresetId) => {
    const p = demoRef.current;
    if (p) {
      p.selectPreset(presetId);
      setSnapshot(p.getCurrentSnapshot());
    }
  }, []);

  const toggleDemoJitter = useCallback((enabled: boolean) => {
    const p = demoRef.current;
    if (p) p.toggleJitter(enabled);
  }, []);

  const getAvailableDemoPresets = useCallback(() => {
    const p = demoRef.current;
    return p ? p.getAvailablePresets() : [];
  }, []);

  const testConnection = useCallback(async (deviceId: string): Promise<ConnectionTestResult> => {
    const p = providerType === 'bridge' ? bridgeRef.current : demoRef.current;
    if (!p) return { ok: false, message: 'Kein Datenanbieter aktiv.', latencyMs: null };
    return p.testConnection(deviceId);
  }, [providerType]);

  const updateSettings = useCallback((patch: Partial<RawSettings>) => {
    const p = providerType === 'bridge' ? bridgeRef.current : demoRef.current;
    if (p) p.updateSettings(patch);
  }, [providerType]);

  const getSettings = useCallback((): RawSettings | null => {
    const p = providerType === 'bridge' ? bridgeRef.current : demoRef.current;
    return p ? p.getSettings() : null;
  }, [providerType]);

  const currentProvider: EnergyDataProvider | null =
    providerType === 'demo' ? demoRef.current :
    providerType === 'bridge' ? bridgeRef.current :
    null;

  return (
    <EnergyProviderContext.Provider value={{
      provider: currentProvider,
      providerType,
      snapshot,
      timeline,
      devices,
      setProviderType,
      selectDemoPreset,
      toggleDemoJitter,
      getAvailableDemoPresets,
      testConnection,
      updateSettings,
      getSettings
    }}>
      {children}
    </EnergyProviderContext.Provider>
  );
}

export function useEnergyProvider() {
  const context = useContext(EnergyProviderContext);
  if (context === undefined) {
    throw new Error('useEnergyProvider must be used within an EnergyProviderRoot');
  }
  return context;
}
