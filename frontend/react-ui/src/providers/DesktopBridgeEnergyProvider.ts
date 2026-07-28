import { EnergySnapshot, EnergyValue, EnergyAssessment, DataQuality, DataOrigin, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, PowerData, SystemStatus } from '../types';
import { EnergyDataProvider, DesktopBridgeEnergyProvider as DesktopBridgeEnergyProviderInterface } from './types';
import { initBridge, QtBridge, getBridge } from '../lib/bridge';
import { nowData$, todayData$ } from '../lib/energyService';

type Subscriber = (snapshot: EnergySnapshot) => void;
type DeviceSubscriber = (devices: DemoDeviceSummary[]) => void;

function powerDataToSnapshot(data: { power: PowerData; status: SystemStatus }): EnergySnapshot {
  const { power, status } = data;

  const dataStateToValue = (state: PowerData['solar']): number | null => {
    if (state.state === 'available') return state.value;
    return null;
  };

  const solarValue = dataStateToValue(power.solar);
  const homeValue = dataStateToValue(power.home);
  const gridValue = dataStateToValue(power.grid);

  const stateToOrigin = (state: PowerData['solar']): DataOrigin => {
    if (state.state === 'available') return 'observed';
    return 'unavailable';
  };

  const solarOrigin = stateToOrigin(power.solar);
  const homeOrigin = stateToOrigin(power.home);
  const gridOrigin = stateToOrigin(power.grid);

  const solar: EnergyValue = {
    valueKw: solarValue !== null ? solarValue / 1000 : null,
    origin: solarOrigin,
    sourceLabel: solarOrigin === 'unavailable' ? undefined : 'Fronius Wechselrichter'
  };

  const homeLoad: EnergyValue = {
    valueKw: homeValue !== null ? homeValue / 1000 : null,
    origin: homeOrigin,
    sourceLabel: homeOrigin === 'unavailable' ? undefined : 'Smart Meter'
  };

  const grid: EnergyValue = {
    valueKw: gridValue !== null ? gridValue / 1000 : null,
    origin: gridOrigin,
    sourceLabel: gridOrigin === 'unavailable' ? undefined : 'Smart Meter'
  };

  const hasLiveData = solarOrigin === 'observed' || homeOrigin === 'observed' || gridOrigin === 'observed';

  let quality: DataQuality;
  if (hasLiveData) {
    quality = 'live';
  } else if (status === 'stale') {
    quality = 'stale';
  } else if (status === 'error') {
    quality = 'error';
  } else {
    quality = 'unavailable';
  }

  let assessment: EnergyAssessment | null = null;
  if (power.verdict && hasLiveData) {
    assessment = {
      verdict: power.verdict,
      kind: power.verdict_kind || null,
      confidence: status === 'stale' ? 'Veraltete Daten (Bridge)' : 'Live-Daten (Bridge)'
    };
  }

  const warnings: string[] = [];
  if (status === 'meter_locked') {
    warnings.push('Zählerdaten nicht verfügbar. Einrichtung optional fortsetzen.');
  }

  return {
    timestamp: power.lastUpdated || null,
    quality,
    solar,
    homeLoad,
    grid,
    battery: null,
    assessment,
    warnings,
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
  private deviceSubscribers = new Set<DeviceSubscriber>();
  /** Raw payload the cache was built from, to skip redundant notifications. */
  private deviceCacheRaw: string | null = null;
  /** Guards against binding the Qt signals twice if init() is called again. */
  private listenersBound = false;
  private boundDevicesHandler: (() => void) | null = null;
  private boundSettingsHandler: (() => void) | null = null;

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
    // init() can run more than once (getBridge() hit vs. awaited initBridge()).
    // Binding twice would deliver every device update to React twice.
    if (this.listenersBound) return;
    this.listenersBound = true;

    this.boundDevicesHandler = () => {
      if (this.destroyed) return;
      this.syncDevices(b);
    };
    b.devicesDataChanged.connect(this.boundDevicesHandler);

    this.boundSettingsHandler = () => {
      if (this.destroyed) return;
      this.syncSettings(b);
    };
    b.settingsDataChanged.connect(this.boundSettingsHandler);

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
        // The bridge re-emits on every poll, mostly with an unchanged payload.
        // Comparing the raw JSON keeps React from re-rendering on no-op updates
        // and stops repeated emissions turning into repeated notifications.
        if (b.devicesData === this.deviceCacheRaw) return;
        const parsed = JSON.parse(b.devicesData);
        if (Array.isArray(parsed)) {
          this.deviceCacheRaw = b.devicesData;
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
          this.notifyDevices();
        }
      }
    } catch {}
  }

  private notifyDevices() {
    this.deviceSubscribers.forEach(cb => cb(this.deviceCache));
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

  subscribeDevices(callback: DeviceSubscriber): () => void {
    this.deviceSubscribers.add(callback);
    // Deliver the current value at once, so a consumer that subscribes after
    // the first payload has already arrived is not left with an empty list.
    callback(this.deviceCache);
    return () => this.deviceSubscribers.delete(callback);
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
    this.deviceSubscribers.clear();
    if (this.unsubNowData) {
      this.unsubNowData();
      this.unsubNowData = null;
    }
    // Detach the Qt signal handlers where the transport supports it, so a
    // replaced provider stops receiving updates instead of leaking a listener.
    if (this.bridge) {
      if (this.boundDevicesHandler) {
        this.bridge.devicesDataChanged.disconnect?.(this.boundDevicesHandler);
      }
      if (this.boundSettingsHandler) {
        this.bridge.settingsDataChanged.disconnect?.(this.boundSettingsHandler);
      }
    }
    this.boundDevicesHandler = null;
    this.boundSettingsHandler = null;
    this.listenersBound = false;
  }
}
