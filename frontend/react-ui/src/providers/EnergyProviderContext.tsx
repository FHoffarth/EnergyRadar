import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { EnergySnapshot, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, DataOrigin } from '../types';
import { EnergyDataProvider } from './types';
import { DemoEnergyProviderImpl } from './DemoEnergyProvider';
import { DesktopBridgeEnergyProviderImpl } from './DesktopBridgeEnergyProvider';
import { initBridge } from '../lib/bridge';
import { todayData$ } from '../lib/energyService';

export type SourceType = 'bridge' | 'offline' | 'demo';

interface EnergyProviderContextType {
  snapshot: EnergySnapshot;
  timeline: TimelineEntry[];
  devices: DemoDeviceSummary[];
  sourceType: SourceType;
  testConnection: (deviceId: string) => Promise<ConnectionTestResult>;
  updateSettings: (patch: Partial<RawSettings>) => void;
  getSettings: () => RawSettings | null;
  isBridgeConnected: boolean;
}

const offlineSnapshot: EnergySnapshot = {
  timestamp: null,
  quality: 'unavailable',
  solar: { valueKw: null, origin: 'unavailable' },
  homeLoad: { valueKw: null, origin: 'unavailable' },
  grid: { valueKw: null, origin: 'unavailable' },
  battery: null,
  assessment: null,
  warnings: ['Desktop-Bridge nicht verbunden – keine Live-Daten verfügbar.']
};

const EnergyProviderContext = createContext<EnergyProviderContextType | undefined>(undefined);

interface EnergyProviderRootProps {
  children: ReactNode;
  demoMode?: boolean;
}

export function EnergyProviderRoot({ children, demoMode = false }: EnergyProviderRootProps) {
  const [sourceType, setSourceType] = useState<SourceType>('offline');
  const [snapshot, setSnapshot] = useState<EnergySnapshot>(offlineSnapshot);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [devices, setDevices] = useState<DemoDeviceSummary[]>([]);
  const bridgeRef = useRef<DesktopBridgeEnergyProviderImpl | null>(null);
  const demoRef = useRef<DemoEnergyProviderImpl | null>(null);
  const initialisedRef = useRef(false);

  const destroyProviders = useCallback(() => {
    if (bridgeRef.current) {
      bridgeRef.current.destroy();
      bridgeRef.current = null;
    }
    if (demoRef.current) {
      demoRef.current.destroy();
      demoRef.current = null;
    }
  }, []);

  const goOffline = useCallback(() => {
    destroyProviders();
    setSourceType('offline');
    setSnapshot(offlineSnapshot);
    setTimeline([]);
    setDevices([]);
  }, [destroyProviders]);

  const setupDemo = useCallback(() => {
    destroyProviders();
    const provider = new DemoEnergyProviderImpl();
    demoRef.current = provider;
    setSourceType('demo');
    setSnapshot(provider.getCurrentSnapshot());
    setTimeline(provider.getTimeline());
    setDevices(provider.getDevices());
    provider.subscribe(setSnapshot);
  }, [destroyProviders]);

  const setupBridge = useCallback(async () => {
    destroyProviders();
    const provider = new DesktopBridgeEnergyProviderImpl();
    bridgeRef.current = provider;
    setSourceType('bridge');
    setSnapshot(provider.getCurrentSnapshot());
    setDevices(provider.getDevices());
    setTimeline(provider.getTimeline());
    provider.subscribe(setSnapshot);
    await provider.init();
    setDevices(provider.getDevices());
    setTimeline(provider.getTimeline());
  }, [destroyProviders]);

  useEffect(() => {
    if (initialisedRef.current) return;
    initialisedRef.current = true;

    if (demoMode) {
      setupDemo();
      return;
    }

    initBridge().then((bridge) => {
      if (bridge) {
        setupBridge();
      } else {
        goOffline();
      }
    });
  }, [demoMode, setupDemo, setupBridge, goOffline]);

  // Subscribe to timeline updates in bridge mode
  useEffect(() => {
    if (sourceType !== 'bridge' || !bridgeRef.current) return;
    const unsub = todayData$.subscribe(() => {
      if (bridgeRef.current) {
        setTimeline(bridgeRef.current.getTimeline());
      }
    });
    return unsub;
  }, [sourceType]);

  const testConnection = useCallback(async (deviceId: string): Promise<ConnectionTestResult> => {
    if (bridgeRef.current) {
      return bridgeRef.current.testConnection(deviceId);
    }
    if (demoRef.current) {
      return demoRef.current.testConnection(deviceId);
    }
    return { ok: false, message: 'Desktop-Bridge nicht verbunden.', latencyMs: null };
  }, []);

  const updateSettings = useCallback((patch: Partial<RawSettings>) => {
    if (bridgeRef.current) {
      bridgeRef.current.updateSettings(patch);
    }
  }, []);

  const getSettings = useCallback((): RawSettings | null => {
    return bridgeRef.current ? bridgeRef.current.getSettings() : null;
  }, []);

  return (
    <EnergyProviderContext.Provider value={{
      snapshot,
      timeline,
      devices,
      sourceType,
      testConnection,
      updateSettings,
      getSettings,
      isBridgeConnected: sourceType === 'bridge'
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
