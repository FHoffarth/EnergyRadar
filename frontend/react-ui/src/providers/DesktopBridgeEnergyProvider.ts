import { EnergySnapshot, EnergyValue, EnergyAssessment, DataQuality, DataOrigin, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, PowerData, SystemStatus } from '../types';
import { EnergyDataProvider, DesktopBridgeEnergyProvider as DesktopBridgeEnergyProviderInterface } from './types';
import { initBridge, QtBridge, getBridge } from '../lib/bridge';
import { nowData$, todayData$ } from '../lib/energyService';

type Subscriber = (snapshot: EnergySnapshot) => void;

function powerDataToSnapshot(data: { power: PowerData; status: SystemStatus }): EnergySnapshot {
  const { power, status } = data;

  const dataStateToOrigin = (state: PowerData['solar'], quality: SystemStatus): DataOrigin => {
    if (state.state === 'loading' || state.state === 'unknown') return 'unavailable';
    if (state.state === 'error') return 'unavailable';
    if (state.state === 'available') {
      if (quality === 'live') return 'estimated';
      if (quality === 'stale') return 'estimated';
      return 'estimated';
    }
    return 'unavailable';
  };

  const dataStateToValue = (state: PowerData['solar']): number | null => {
    if (state.state === 'available') return state.value;
    return null;
  };

  const qualityMap: Record<SystemStatus, DataQuality> = {
    live: 'live',
    stale: 'stale',
    error: 'unavailable',
    no_data: 'unavailable',
    meter_locked: 'partial'
  };

  const solarValue = dataStateToValue(power.solar);
  const homeValue = dataStateToValue(power.home);
  const gridValue = dataStateToValue(power.grid);

  const solarOrigin = dataStateToOrigin(power.solar, status);
  const homeOrigin = dataStateToOrigin(power.home, status);
  const gridOrigin = dataStateToOrigin(power.grid, status);

  const solar: EnergyValue = {
    valueKw: solarValue !== null ? solarValue / 1000 : null,
    origin: solarOrigin,
    sourceLabel: solarOrigin === 'unavailable' ? undefined : 'Bridge'
  };

  const homeLoad: EnergyValue = {
    valueKw: homeValue !== null ? homeValue / 1000 : null,
    origin: homeOrigin,
    sourceLabel: homeOrigin === 'unavailable' ? undefined : 'Bridge'
  };

  const grid: EnergyValue = {
    valueKw: gridValue !== null ? gridValue / 1000 : null,
    origin: gridOrigin,
    sourceLabel: gridOrigin === 'unavailable' ? undefined : 'Bridge'
  };

  let assessment: EnergyAssessment | null = null;
  if (power.verdict && (status === 'live' || status === 'stale' || status === 'meter_locked')) {
    assessment = {
      verdict: power.verdict,
      kind: power.verdict_kind || null,
      confidence: status === 'live' ? 'Live-Daten (Bridge)' : status === 'stale' ? 'Veraltete Daten (Bridge)' : undefined
    };
  }

  return {
    timestamp: power.lastUpdated || null,
    quality: qualityMap[status] || 'unavailable',
    solar,
    homeLoad,
    grid,
    battery: null,
    assessment,
    warnings: [],
    solarForecast: power.solar_forecast || null
  };
}

export class DesktopBridgeEnergyProviderImpl implements DesktopBridgeEnergyProviderInterface {
  readonly type = 'bridge' as const;
  private bridge: QtBridge | null = null;
  private subscribers = new Set<Subscriber>();
  private destroyed = false;
  private currentSnapshot: EnergySnapshot = {
    timestamp: null,
    quality: 'unavailable',
    solar: { valueKw: null, origin: 'unavailable' },
    homeLoad: { valueKw: null, origin: 'unavailable' },
    grid: { valueKw: null, origin: 'unavailable' },
    battery: null,
    assessment: null,
    warnings: ['Keine Bridge-Verbindung']
  };
  private bridgeConnected = false;
  private deviceCache: DemoDeviceSummary[] = [];
  private settingsCache: RawSettings | null = null;
  private unsubNowData: (() => void) | null = null;

  async init() {
    const b = getBridge();
    if (b) {
      this.bridge = b;
      this.bridgeConnected = true;
      this.setupBridgeListeners(b);
      this.readInitialData(b);
      return;
    }

    const bridge = await initBridge();
    if (!bridge) {
      this.bridgeConnected = false;
      return;
    }

    this.bridge = bridge;
    this.bridgeConnected = true;
    this.setupBridgeListeners(bridge);
    this.readInitialData(bridge);
  }

  private setupBridgeListeners(b: QtBridge) {
    b.devicesDataChanged.connect(() => {
      if (this.destroyed) return;
      this.syncDevices(b);
    });

    b.settingsDataChanged.connect(() => {
      if (this.destroyed) return;
      this.syncSettings(b);
    });

    this.unsubNowData = nowData$.subscribe(state => {
      if (this.destroyed) return;
      this.currentSnapshot = powerDataToSnapshot(state);
      this.notify();
    });
  }

  private readInitialData(b: QtBridge) {
    this.syncDevices(b);
    this.syncSettings(b);
  }

  private syncDevices(b: QtBridge) {
    try {
      if (b.devicesData) {
        const parsed = JSON.parse(b.devicesData);
        if (Array.isArray(parsed)) {
          this.deviceCache = parsed.map((d: any) => ({
            id: d.device_id || 'unknown',
            name: d.display_name || 'Unbekannt',
            category: d.device_type || 'unknown',
            status: (d.connection_status === 'connected' ? 'active' : d.connection_status === 'stale' ? 'last_known' : d.connection_status === 'error' ? 'unknown' : 'idle') as DemoDeviceSummary['status'],
            powerWatts: null,
            origin: 'calculated' as DataOrigin,
            lastSeen: d.last_measurement_at || 'Unbekannt',
            smartShedEnabled: false,
            notes: d.user_message || '',
            iconName: d.device_type === 'inverter' ? 'Sun' : 'Server'
          }));
        }
      }
    } catch {}
  }

  private syncSettings(b: QtBridge) {
    try {
      if (b.settingsData) {
        this.settingsCache = JSON.parse(b.settingsData);
      }
    } catch {}
  }

  isConnected(): boolean {
    return this.bridgeConnected;
  }

  getCurrentSnapshot(): EnergySnapshot {
    return this.currentSnapshot;
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    callback(this.currentSnapshot);
    return () => this.subscribers.delete(callback);
  }

  private notify() {
    this.subscribers.forEach(cb => cb(this.currentSnapshot));
  }

  getTimeline(): TimelineEntry[] {
    const td = todayData$.get();
    if (td.history.length === 0) return [];

    return td.history.map(pt => ({
      time: pt.time,
      solarKw: pt.solar !== null ? pt.solar / 1000 : null,
      homeLoadKw: pt.home !== null ? pt.home / 1000 : null,
      gridKw: pt.gridImport !== null ? pt.gridImport / 1000 : pt.gridExport !== null ? -(pt.gridExport / 1000) : null,
      batteryPct: null,
      origin: 'estimated' as DataOrigin
    }));
  }

  getDevices(): DemoDeviceSummary[] {
    return this.deviceCache;
  }

  getSettings(): RawSettings | null {
    return this.settingsCache;
  }

  updateSettings(patch: Partial<RawSettings>): void {
    if (this.bridge) {
      this.bridge.updateSettings(JSON.stringify(patch));
    }
  }

  async testConnection(deviceId: string): Promise<ConnectionTestResult> {
    if (!this.bridge) {
      return { ok: false, message: 'Desktop-Bridge nicht verbunden.', latencyMs: null };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, message: 'Verbindungstest zeitlich ausgelaufen.', latencyMs: null });
      }, 15000);

      this.bridge!.connectionTestResult.connect((devId, _, resJson) => {
        if (devId === deviceId) {
          clearTimeout(timeout);
          try {
            const res = JSON.parse(resJson);
            resolve({ ok: res.ok || false, message: res.message || '', latencyMs: res.latency_ms ?? null });
          } catch {
            resolve({ ok: false, message: 'Ungültige Antwort vom Bridge.', latencyMs: null });
          }
        }
      });

      this.bridge!.testConnection(deviceId);
    });
  }

  destroy() {
    this.destroyed = true;
    this.subscribers.clear();
    if (this.unsubNowData) {
      this.unsubNowData();
      this.unsubNowData = null;
    }
  }
}
