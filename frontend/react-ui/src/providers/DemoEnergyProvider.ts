import { EnergySnapshot, EnergyValue, EnergyAssessment, DataQuality, DataOrigin, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, DemoPresetId } from '../types';
import { EnergyDataProvider, DemoEnergyProvider as DemoEnergyProviderInterface } from './types';
import { DEMO_PRESETS, DEMO_TIMELINE, DEMO_DEVICES, DEMO_ASSESSMENT_VERDICTS } from '../demo/constants';

type Subscriber = (snapshot: EnergySnapshot) => void;

export class DemoEnergyProviderImpl implements DemoEnergyProviderInterface {
  readonly type = 'demo' as const;
  private currentPresetId: DemoPresetId = 'sunny_midday';
  private jitterEnabled = false;
  private subscribers = new Set<Subscriber>();
  private jitterInterval: ReturnType<typeof setInterval> | null = null;
  private jitterOffset = 0;

  constructor() {
    this.startJitterIfEnabled();
  }

  private getPreset() {
    const base = DEMO_PRESETS[this.currentPresetId];
    if (!this.jitterEnabled || this.jitterOffset === 0) return base;
    return {
      ...base,
      solarKw: base.solarKw !== null ? Math.max(0, Number((base.solarKw + this.jitterOffset).toFixed(2))) : null,
      homeLoadKw: base.homeLoadKw !== null ? Math.max(0.1, Number((base.homeLoadKw - this.jitterOffset).toFixed(2))) : null,
    };
  }

  private buildSnapshot(): EnergySnapshot {
    const preset = this.getPreset();

    const solar: EnergyValue = {
      valueKw: preset.solarKw,
      origin: 'simulated',
      sourceLabel: 'Demo-Szenario'
    };

    const homeLoad: EnergyValue = {
      valueKw: preset.homeLoadKw,
      origin: 'simulated',
      sourceLabel: 'Demo-Szenario'
    };

    const grid: EnergyValue = {
      valueKw: preset.gridKw,
      origin: preset.gridKw !== null ? 'simulated' : 'unavailable',
      sourceLabel: preset.gridKw !== null ? 'Demo-Szenario' : undefined
    };

    const battery = preset.batteryPct !== null ? {
      powerKw: preset.batteryFlowKw ?? null,
      stateOfChargePercent: preset.batteryPct,
      origin: (preset.batteryFlowKw !== null ? 'simulated' : 'unavailable') as DataOrigin
    } : null;

    const verdict = DEMO_ASSESSMENT_VERDICTS[this.currentPresetId];
    const quality: DataQuality = 'live';

    let assessment: EnergyAssessment | null = null;
    if (verdict) {
      assessment = {
        verdict: verdict.headline,
        kind: this.currentPresetId,
        confidence: 'Gering (Demo-Daten)'
      };
    }

    return {
      timestamp: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      quality,
      solar,
      homeLoad,
      grid,
      battery,
      assessment,
      warnings: [],
      solarForecast: null
    };
  }

  getCurrentSnapshot(): EnergySnapshot {
    return this.buildSnapshot();
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    callback(this.buildSnapshot());
    return () => this.subscribers.delete(callback);
  }

  private notify() {
    const snapshot = this.buildSnapshot();
    this.subscribers.forEach(cb => cb(snapshot));
  }

  getTimeline(): TimelineEntry[] {
    return DEMO_TIMELINE;
  }

  getDevices(): DemoDeviceSummary[] {
    return DEMO_DEVICES;
  }

  /**
   * The demo device list is a fixed fixture, so the value is delivered once and
   * never changes. The unsubscribe function exists to satisfy the contract.
   */
  subscribeDevices(callback: (devices: DemoDeviceSummary[]) => void): () => void {
    callback(DEMO_DEVICES);
    return () => {};
  }

  getSettings(): RawSettings | null {
    return null;
  }

  updateSettings(_patch: Partial<RawSettings>): void {}

  async testConnection(_deviceId: string): Promise<ConnectionTestResult> {
    return { ok: false, message: 'Verbindungstest im Demo-Modus nicht verfügbar. Wechseln Sie zu Live-Datenquellen.', latencyMs: null };
  }

  selectPreset(presetId: DemoPresetId): void {
    this.currentPresetId = presetId;
    this.notify();
  }

  getAvailablePresets() {
    return Object.values(DEMO_PRESETS).map(p => ({
      id: p.id as DemoPresetId,
      name: p.name,
      description: p.description
    }));
  }

  toggleJitter(enabled: boolean): void {
    this.jitterEnabled = enabled;
    if (enabled) {
      this.startJitterIfEnabled();
    } else {
      this.stopJitter();
    }
  }

  private startJitterIfEnabled() {
    if (!this.jitterEnabled) return;
    this.stopJitter();
    this.jitterInterval = setInterval(() => {
      const base = DEMO_PRESETS[this.currentPresetId];
      if (base.solarKw === null || base.homeLoadKw === null) return;
      this.jitterOffset = (Math.random() - 0.5) * 0.06;
      this.notify();
    }, 4000);
  }

  private stopJitter() {
    if (this.jitterInterval) {
      clearInterval(this.jitterInterval);
      this.jitterInterval = null;
    }
  }

  destroy() {
    this.stopJitter();
    this.subscribers.clear();
  }
}
