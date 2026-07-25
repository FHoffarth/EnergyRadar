/**
 * bridge.ts — QWebChannel Bridge für EnergyRadar
 *
 * Verbindet React mit der Python EnergyBridge via QWebChannel.
 * Ohne Qt-Bridge werden keine Live- oder Beispieldaten erzeugt.
 */

export interface QtBridge {
  nowData: string;
  todayData: string;
  devicesData: string;
  settingsData: string;
  nowDataChanged: { connect: (cb: () => void) => void };
  todayDataChanged: { connect: (cb: () => void) => void };
  devicesDataChanged: { connect: (cb: () => void) => void };
  settingsDataChanged: { connect: (cb: () => void) => void };
  connectionTestStarted: { connect: (cb: (deviceId: string, opId: string) => void) => void };
  connectionTestResult: { connect: (cb: (deviceId: string, opId: string, resultJson: string) => void) => void };
  testConnection: (deviceId: string) => void;
  updateSettings: (patchJson: string) => void;
  saveSettings: (json: string) => void;
  saveFroniusAddress: (address: string) => void;
  chooseExportDirectory: () => void;
  openExportDirectory: () => void;
  validateWeatherConfiguration: () => void;
  searchWeatherLocations: (operationId: string, query: string) => void;
  confirmWeatherLocation: (candidateJson: string) => void;
  removeResolvedLocation: () => void;
  testWeatherConnection: (operationId: string) => void;
  openDiagnosticLog: () => void;
  openLogDirectory: () => void;
  requestExport: (operationId: string, exportKind: string, rangeType: string, startDateStr: string, endDateStr: string) => void;
  requestMailShare: (operationId: string, rangeType: string, startDateStr: string, endDateStr: string) => void;
  exportStarted: { connect: (cb: (operationId: string) => void) => void };
  exportCompleted: { connect: (cb: (payloadJson: string) => void) => void };
  exportFailed: { connect: (cb: (operationId: string, errorMsg: string) => void) => void };
  mailHandoffPrepared: { connect: (cb: (operationId: string) => void) => void };
  settingsSaveSucceeded: { connect: (cb: (resultJson: string) => void) => void };
  settingsSaveFailed: { connect: (cb: (errorJson: string) => void) => void };
  directorySelected: { connect: (cb: (path: string) => void) => void };
  weatherConfigurationResult: { connect: (cb: (resultJson: string) => void) => void };
  systemActionResult: { connect: (cb: (resultJson: string) => void) => void };
  weatherLocationSearchStarted: { connect: (cb: (operationId: string) => void) => void };
  weatherCandidatesResult: { connect: (cb: (operationId: string, resultJson: string) => void) => void };
  weatherLocationConfirmed: { connect: (cb: (resolvedJson: string) => void) => void };
  weatherConnectionTestStarted: { connect: (cb: (operationId: string) => void) => void };
  weatherConnectionTestResult: { connect: (cb: (operationId: string, resultJson: string) => void) => void };
  weatherReportChanged: { connect: (cb: (weatherJson: string) => void) => void };
}

declare global {
  interface Window {
    qt?: { webChannelTransport: unknown };
    QWebChannel?: new (transport: unknown, cb: (channel: { objects: { bridge: QtBridge } }) => void) => void;
  }
}

let _bridge: QtBridge | null = null;
let _initPromise: Promise<QtBridge | null> | null = null;

export function initBridge(): Promise<QtBridge | null> {
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 100; // Poll for up to 5 seconds (50ms interval)

    const tryConnect = () => {
      if (typeof window.qt !== 'undefined' && window.qt.webChannelTransport && window.QWebChannel) {
        try {
          new window.QWebChannel(window.qt.webChannelTransport, (channel) => {
            _bridge = channel.objects.bridge;
            console.info('[bridge] QWebChannel connected successfully!');
            resolve(_bridge);
          });
          return;
        } catch (err) {
          console.warn('[bridge] QWebChannel constructor error:', err);
        }
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryConnect, 50);
      } else {
        console.info('[bridge] No Qt detected after polling — live data remains unavailable');
        resolve(null);
      }
    };

    tryConnect();
  });

  return _initPromise;
}

export function getBridge(): QtBridge | null {
  return _bridge;
}
