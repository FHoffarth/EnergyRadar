import { EnergySnapshot, ProviderType, TimelineEntry, DemoDeviceSummary, ConnectionTestResult, RawSettings, DemoPresetId } from '../types';

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
