import React, { useState } from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { useApp } from '../context/AppContext';
import { Cpu, Zap, Thermometer, Sun, BatteryCharging, Server, ToggleLeft, ToggleRight, AlertCircle, Info, RefreshCw, Loader2 } from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  Sun, Zap: Zap, Thermometer, BatteryCharging, Server
};

export function DevicesView() {
  const { devices, sourceType, testConnection } = useEnergyProvider();
  const { setView } = useApp();
  const [testingId, setTestingId] = useState<string | null>(null);

  const isDemo = sourceType === 'demo';
  const hasBridgeDevices = sourceType === 'bridge' && devices.length > 0;

  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Server;
    return <Icon className="w-5 h-5 text-slate-500" />;
  };

  const handleTestConnection = async (deviceId: string) => {
    setTestingId(deviceId);
    await testConnection(deviceId);
    setTestingId(null);
  };

  return (
    <div className="flex flex-col h-full pt-12 pb-8 overflow-y-auto">
      <header className="px-12 pb-8">
        <h1 className="text-4xl font-semibold text-[#1C1C1E] dark:text-white leading-tight max-w-2xl">
          {isDemo
            ? 'Demo-Geräte (Simuliert)'
            : hasBridgeDevices
            ? `${devices.length} Gerät${devices.length > 1 ? 'e' : ''} verbunden`
            : 'Keine Geräte verbunden'}
        </h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-3 text-lg">
          {isDemo
            ? 'Demo-Geräte, Status- und Leistungswerte sind Teil des aktiven Testszenarios.'
            : hasBridgeDevices
            ? 'Gerätestatus aus der Desktop-Bridge.'
            : 'Verbinde EnergyRadar in den Einstellungen mit deinem lokalen Energiesystem.'}
        </p>
      </header>

      {isDemo && (
        <div className="mx-12 mb-8 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-xl p-3 px-4 text-xs flex items-center gap-2 text-sky-800 dark:text-sky-300">
          <Info className="w-4 h-4 shrink-0" />
          <span>Alle Geräte-, Status- und Leistungswerte in dieser Ansicht sind simuliert.</span>
        </div>
      )}

      {!hasBridgeDevices && !isDemo && (
        <section className="px-12">
          <div className="bg-white dark:bg-slate-800/90 rounded-3xl border border-[#E5E5E3] dark:border-slate-700 p-8">
            <p className="text-slate-700 dark:text-slate-300">
              Es werden keine erfundenen Messwerte angezeigt. Echte Gerätedaten sind verfügbar, sobald die Desktop-Bridge verbundene Geräte meldet.
            </p>
            <button type="button" onClick={() => setView('settings')}
              className="mt-5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors">
              Datenquelle einrichten
            </button>
          </div>
        </section>
      )}

      <section className="px-12 space-y-6 pb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {devices.map((device) => {
            const isUnknown = device.status === 'unknown';
            const isLastKnown = device.status === 'last_known';
            const isTesting = testingId === device.id;

            return (
              <div key={device.id}
                className="bg-white dark:bg-slate-800/90 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 p-5 space-y-4 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
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
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded capitalize ${
                    device.status === 'active'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/40'
                      : isLastKnown
                      ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-400 dark:border-amber-800/40'
                      : isUnknown
                      ? 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/80 dark:text-rose-400 dark:border-rose-800/40'
                      : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {device.status === 'active' ? 'Aktiv' :
                     device.status === 'idle' ? 'Standby' :
                     device.status === 'last_known' ? 'Zuletzt bekannt' : 'Unbekannt'}
                  </span>
                </div>

                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 border border-[#E5E5E3] dark:border-slate-600 p-3 rounded-xl">
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {isDemo ? 'Simulierte Leistung' : 'Aktuelle Leistung'}
                  </span>
                  <span className="tabular-nums text-base font-bold text-[#1C1C1E] dark:text-white">
                    {device.powerWatts !== null ? `${device.powerWatts} Watt` : '— (Unbekannt)'}
                  </span>
                </div>

                {device.notes && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5 leading-relaxed">
                    <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>{device.notes}</span>
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
                    <button
                      onClick={() => handleTestConnection(device.id)}
                      disabled={isTesting}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Verbindung testen
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
