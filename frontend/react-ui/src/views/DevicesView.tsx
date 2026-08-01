import React, { useState } from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { useApp } from '../context/AppContext';
import { Zap, Thermometer, Sun, BatteryCharging, Server, ToggleRight, AlertCircle, Info, RefreshCw, Loader2 } from 'lucide-react';
import { deviceStatusPresentation, relativeResponseTime } from '../lib/deviceStatus';
import { ConnectionTestResult } from '../types';

const iconMap: Record<string, React.ElementType> = {
  Sun, Zap: Zap, Thermometer, BatteryCharging, Server
};

export function DevicesView() {
  const { devices, sourceType, testConnection } = useEnergyProvider();
  const { setView } = useApp();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});

  const isDemo = sourceType === 'demo';
  const hasBridgeDevices = sourceType === 'bridge' && devices.length > 0;

  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Server;
    return <Icon className="w-5 h-5 text-slate-500" />;
  };

  const handleRefreshConnection = async (deviceId: string) => {
    const device = devices.find(candidate => candidate.id === deviceId);
    if (device?.status === 'unconfigured') {
      setView('settings');
      return;
    }
    if (testingId === deviceId) return;
    setTestingId(deviceId);
    try {
      const result = await testConnection(deviceId);
      setTestResults(previous => ({ ...previous, [deviceId]: result }));
    } finally {
      setTestingId(current => current === deviceId ? null : current);
    }
  };

  return (
    <div className="cockpit-page flex flex-col h-full overflow-y-auto" data-testid="devices-workspace">
      <header className="pb-7 max-w-3xl">
        <p className="cockpit-eyebrow">Verbindungen</p>
        <h1 className="cockpit-title mt-2 text-[#1C1C1E] dark:text-white">
          {isDemo
            ? 'Demo-Geräte (Simuliert)'
            : hasBridgeDevices
            ? `${devices.length} Gerät${devices.length > 1 ? 'e' : ''}`
            : 'Keine Geräte verbunden'}
        </h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-2 text-base">
          {isDemo
            ? 'Demo-Geräte, Status- und Leistungswerte sind Teil des aktiven Testszenarios.'
            : hasBridgeDevices
            ? 'Gerätestatus aus der Desktop-Bridge.'
            : 'Verbinde EnergyRadar in den Einstellungen mit deinem lokalen Energiesystem.'}
        </p>
      </header>

      {isDemo && (
        <div className="cockpit-surface-muted mb-6 p-3 px-4 text-xs flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <Info className="w-4 h-4 shrink-0" />
          <span>Alle Geräte-, Status- und Leistungswerte in dieser Ansicht sind simuliert.</span>
        </div>
      )}

      {!hasBridgeDevices && !isDemo && (
        <section>
          <div className="cockpit-surface p-8">
            <p className="text-slate-700 dark:text-slate-300">
              Es werden keine erfundenen Messwerte angezeigt. Echte Gerätedaten sind verfügbar, sobald die Desktop-Bridge verbundene Geräte meldet.
            </p>
            <button type="button" onClick={() => setView('settings')}
              className="mt-5 px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-semibold transition-colors">
              Datenquelle einrichten
            </button>
          </div>
        </section>
      )}

      <section className="space-y-6 pb-8">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {devices.map((device) => {
            const isTesting = testingId === device.id;
            const testResult = testResults[device.id];
            const testedStatus = testResult
              ? testResult.status === 'partial' || (testResult.ok && device.powerWatts === null)
                ? 'partial'
                : testResult.ok ? 'active' : 'offline'
              : device.status;
            const honestStatus = testedStatus === 'active' && device.powerWatts === null ? 'partial' : testedStatus;
            const presentation = deviceStatusPresentation(honestStatus);
            const lastResponse = relativeResponseTime(testResult?.testedAt || device.lastSeen);
            const capabilities = testResult?.capabilities ?? device.capabilities ?? [];

            return (
              <div key={device.id}
                className="cockpit-surface p-6 space-y-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 border border-[#E5E5E3] dark:border-slate-600">
                      {getIcon(device.iconName)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#1C1C1E] dark:text-white text-sm">{device.name}</h3>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{device.category}</span>
                    </div>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                    presentation.online
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/40'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-400 dark:border-amber-800/40'
                  }`}>
                    {presentation.label}
                  </span>
                </div>

                {!isDemo && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Letzte Antwort: {lastResponse ? `vor ${lastResponse}` : 'noch nicht verfügbar'}
                  </p>
                )}

                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 border border-[#E5E5E3] dark:border-slate-600 p-3 rounded-xl">
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {isDemo ? 'Simulierte Leistung' : 'Aktuelle Leistung'}
                  </span>
                  <span className="tabular-nums text-base font-bold text-[#1C1C1E] dark:text-white">
                    {(honestStatus === 'active' || honestStatus === 'partial') && device.powerWatts !== null
                      ? `${device.powerWatts} Watt`
                      : presentation.label === 'Veraltet' ? 'Veraltet' : 'Nicht verfügbar'}
                  </span>
                </div>

                {device.notes && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5 leading-relaxed">
                    <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>{device.notes}</span>
                  </p>
                )}

                {!isDemo && capabilities.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Verfügbar: {capabilities.join(', ')}
                  </p>
                )}

                {isDemo && device.smartShedEnabled !== undefined && (
                  <div className="pt-3 border-t border-[#E5E5E3] dark:border-slate-700/60 flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300 font-medium">PV-Optimierung erlaubt</span>
                    <div className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
                      <span className="text-[11px] font-semibold">Aktiv</span>
                      <ToggleRight className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                    </div>
                  </div>
                )}

                {!isDemo && (
                  <div className="pt-3 border-t border-[#E5E5E3] dark:border-slate-700/60">
                    {testResult && (
                      <p
                        role={testResult.ok ? 'status' : 'alert'}
                        aria-live="polite"
                        className={`mb-3 text-xs ${testResult.ok && testResult.status !== 'partial' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-400'}`}
                      >
                        {testResult.status === 'partial' ? 'Teilweise verfügbar: ' : testResult.ok ? 'Verbindung erfolgreich: ' : 'Verbindung fehlgeschlagen: '}
                        {testResult.message}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRefreshConnection(device.id)}
                      disabled={isTesting}
                      aria-busy={isTesting}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                        presentation.online
                          ? 'bg-sky-700 hover:bg-sky-800 text-white'
                          : 'bg-amber-500 hover:bg-amber-600 text-white'
                      }`}
                    >
                      {isTesting ? <Loader2 className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      {isTesting ? 'Verbindung wird geprüft …' : presentation.action}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
