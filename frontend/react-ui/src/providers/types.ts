import { EnergySnapshot, ProviderType, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, DemoPresetId, PeriodReport } from '../types';

export interface EnergyDataProvider {
  readonly type: ProviderType;
  getCurrentSnapshot(): EnergySnapshot;
  subscribe(callback: (snapshot: EnergySnapshot) => void): () => void;
  getTimeline(): TimelineEntry[];
  getDevices(): DemoDeviceSummary[];
  /**
   * Observe the device list. The callback fires immediately with the current
   * value and again whenever the provider learns of a change, so a consumer
   * that mounts before the first device payload arrives still renders it.
   * Returns an unsubscribe function.
   */
  subscribeDevices(callback: (devices: DemoDeviceSummary[]) => void): () => void;
  getSettings(): RawSettings | null;
  updateSettings(patch: Partial<RawSettings>): void;
  testConnection(deviceId: string): Promise<ConnectionTestResult>;
  /**
   * Resolve the authoritative period result for a range (Memory/Reports). The
   * same contract backs Today, so surfaces cannot disagree for identical bounds.
   */
  requestPeriod(fromIso: string, toIso: string): Promise<PeriodReport>;
}

/** An "everything absent" period result — used when no backend can answer. */
export function unavailablePeriodReport(fromIso: string, toIso: string): PeriodReport {
  const metric = {
    value_kwh: null, state: 'unavailable', coverage_state: 'unavailable',
    source: 'unavailable', provenance: null, confidence: null, reason: 'provider_unavailable',
  };
  return {
    requested_period: { from: fromIso, to: toIso },
    resolved_period: null,
    provenance: null,
    freshness: null,
    metrics: {
      pv_generation: { ...metric },
      grid_import: { ...metric },
      grid_export: { ...metric },
      house_consumption: { ...metric },
      direct_self_consumption: { ...metric },
    },
    has_records: false,
    has_summary: false,
  };
}

export interface DemoEnergyProvider extends EnergyDataProvider {
  readonly type: 'demo';
  selectPreset(presetId: DemoPresetId): void;
  getAvailablePresets(): Array<{ id: DemoPresetId; name: string; description: string }>;
  toggleJitter(enabled: boolean): void;
}

export interface DesktopBridgeEnergyProvider extends EnergyDataProvider {
  readonly type: 'bridge';
  isConnected(): boolean;
}
