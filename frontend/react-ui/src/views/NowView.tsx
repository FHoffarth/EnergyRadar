import React from 'react';
import { useApp } from '../context/AppContext';
import { Sun, Home, Zap, ArrowRight, ArrowLeft, Info } from 'lucide-react';
import { DataState } from '../types';

export function NowView() {
  const { powerData, status, todayData, devices } = useApp();

  const isGenerating = powerData.solar.state === 'available' && powerData.solar.value > 0;
  const isFeeding = powerData.grid.state === 'available' && powerData.grid.value < 0;
  const isDrawing = powerData.grid.state === 'available' && powerData.grid.value > 0;
  const history = todayData.history.filter(point => typeof point.solar === 'number');
  const maximumSolar = Math.max(0, ...history.map(point => point.solar ?? 0));
  const selfSufficiency = todayData.selfSufficiency.state === 'available'
    ? `${todayData.selfSufficiency.value.toLocaleString('de-DE', { maximumFractionDigits: 0 })}% Eigenversorgung`
    : null;
  const configuredDevices = devices.filter(device => device.configuration_status === 'configured');
  const lockedDevice = configuredDevices.find(device => device.pin_status === 'locked');

  const deviceDotClass = (connectionStatus: string) => {
    if (connectionStatus === 'connected') return 'bg-emerald-500';
    if (connectionStatus === 'stale') return 'bg-amber-500';
    if (connectionStatus === 'error' || connectionStatus === 'offline') return 'bg-rose-500';
    return 'bg-slate-400';
  };

  const qualityLabel = () => {
    if (status === 'live') return powerData.lastUpdated || 'Live';
    if (status === 'stale') return `Veraltet · ${powerData.lastUpdated || ''}`;
    if (status === 'meter_locked') return 'Teilweise verfügbar';
    if (status === 'error') return 'Nicht erreichbar';
    return 'Keine Daten';
  };

  let mainStatement: string;
  if (powerData.verdict && (status === 'live' || status === 'stale')) {
    mainStatement = powerData.verdict;
  } else if (status === 'no_data') {
    mainStatement = 'Keine Datenquelle eingerichtet.';
  } else if (status === 'meter_locked') {
    mainStatement = 'Der Stromzähler ist noch nicht PIN-entsperrt.';
  } else if (status === 'error') {
    mainStatement = 'Gerät momentan nicht erreichbar.';
  } else if (status === 'stale' && !powerData.verdict) {
    mainStatement = 'Veraltete Messwerte – erneute Verbindung wird versucht.';
  } else if (status === 'live' || status === 'stale') {
    mainStatement = 'Live-Daten sind verfügbar.';
  } else {
    mainStatement = 'Verbindung wird hergestellt …';
  }

  const renderCard = (title: string, state: DataState<number>, unit: string, subtitle: string, icon: React.ReactNode, colors: string, active: boolean) => {
    const isUnknown = state.state === 'unknown' || state.state === 'loading';
    const val = state.state === 'available' ? Math.abs(state.value) : null;

    return (
      <div className={`flex-1 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm transition-all duration-300 ${active ? `ring-2 ${colors.split(' ')[0]}` : ''}`}>
        <div className="flex items-center gap-2.5 mb-4">
          <div className={`p-1.5 rounded-lg ${colors.split(' ')[1]} dark:bg-slate-700`}>
            {icon}
          </div>
          <span className="text-sm text-[#6E6E6E] dark:text-slate-400 font-medium">{title}</span>
        </div>
        <div className="text-3xl font-bold mb-1 text-[#1C1C1E] dark:text-white">
          {isUnknown ? '–' : (val! / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          <span className="text-xl font-medium text-[#8E8E8E] dark:text-slate-500 ml-1">{unit}</span>
        </div>
        <p className={`text-xs font-medium ${isUnknown ? 'text-slate-400' : colors.split(' ')[2]}`}>{subtitle}</p>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full pt-10 pb-6">
      {/* Header */}
      <header className="px-10 pb-6">
        <h1 className="text-3xl font-semibold text-[#1C1C1E] dark:text-white leading-snug max-w-2xl">
          {mainStatement}
        </h1>
        <p className="text-sm text-[#8E8E8E] dark:text-slate-500 mt-2 font-medium">
          {qualityLabel()}
        </p>
      </header>

      {/* Energy Flow Cards */}
      <section className="px-10 flex items-stretch gap-4 mb-10">
        {renderCard(
          "Solaranlage",
          powerData.solar,
          "kW",
          powerData.solar.state === 'unknown' ? "Unbekannt" : isGenerating ? "Wird gerade erzeugt" : "Keine Erzeugung",
          <Sun className="w-5 h-5 text-amber-500" />,
          "ring-amber-500/10 bg-amber-50 text-amber-600",
          isGenerating
        )}

        <div className="flex items-center justify-center flex-shrink-0 w-6 text-[#E5E5E3] dark:text-slate-700">
          <ArrowRight className={`w-6 h-6 transition-colors duration-300 ${isGenerating ? 'text-amber-500/40' : ''}`} />
        </div>

        {renderCard(
          "Hausverbrauch",
          powerData.home,
          "kW",
          powerData.home.state === 'available' ? "Wird im Haus genutzt" : "Unbekannt",
          <Home className="w-5 h-5 text-sky-500" />,
          "ring-sky-500/10 bg-sky-50 text-sky-600",
          powerData.home.state === 'available' && powerData.home.value > 0
        )}

        <div className="flex items-center justify-center flex-shrink-0 w-6 text-[#E5E5E3] dark:text-slate-700">
          {isFeeding ? (
            <ArrowRight className="w-6 h-6 text-emerald-500/50" />
          ) : isDrawing ? (
            <ArrowLeft className="w-6 h-6 text-rose-500/50" />
          ) : (
            <ArrowRight className="w-6 h-6" />
          )}
        </div>

        {renderCard(
          "Stromnetz",
          powerData.grid,
          "kW",
          powerData.grid.state === 'unknown' ? "Unbekannt" : isFeeding ? "Einspeisung ins Netz" : isDrawing ? "Bezug aus dem Netz" : "Kein Austausch",
          <Zap className={`w-5 h-5 ${isFeeding ? 'text-emerald-500' : 'text-rose-500'}`} />,
          isFeeding ? "ring-emerald-500/10 bg-emerald-50 text-emerald-600" : "ring-rose-500/10 bg-rose-50 text-rose-600",
          isFeeding || isDrawing
        )}
      </section>

      {/* Bottom panels */}
      <section className="px-10 flex-1 flex min-h-0 gap-6 pb-4">
        {/* System Status — more prominent */}
        <div className="flex-[3] bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <h3 className="text-base font-semibold text-[#1C1C1E] dark:text-white mb-4">Systemstatus</h3>
            <div className="space-y-3">
              {configuredDevices.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Keine Datenquelle eingerichtet.
                </p>
              ) : configuredDevices.map(device => (
                <div className="flex items-center gap-3" key={device.device_id}>
                  <div className={`w-2 h-2 rounded-full ${deviceDotClass(device.connection_status)}`}></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1C1C1E] dark:text-white truncate">{device.display_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{device.user_message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {lockedDevice && (
            <div className="flex gap-2.5 p-3.5 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl border border-amber-200/80 dark:border-amber-800/60 mt-4">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200 font-medium">
                <strong>Hinweis:</strong> {lockedDevice.pin_instructions || lockedDevice.user_message}
              </p>
            </div>
          )}

          {selfSufficiency && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Eigenversorgung: <span className="font-semibold text-slate-800 dark:text-slate-200">{selfSufficiency}</span>
              </p>
            </div>
          )}
        </div>

        {/* Daily Mini Chart */}
        <div className="flex-[2] bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 p-6 flex flex-col shadow-sm">
          <h3 className="text-base font-semibold text-[#1C1C1E] dark:text-white mb-4">Tagesverlauf</h3>
          {history.length > 0 && maximumSolar > 0 ? (
            <>
              <div className="flex-1 flex items-end gap-0.5" aria-label="Gemessener Tagesverlauf">
                {history.map((point, index) => (
                  <div
                    key={`${point.time}-${index}`}
                    className="flex-1 min-w-0 bg-amber-500 dark:bg-amber-500/80 rounded-t-sm"
                    style={{ height: `${Math.max(2, ((point.solar ?? 0) / maximumSolar) * 100)}%` }}
                    title={`${point.time}: ${point.solar?.toLocaleString('de-DE')} W`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-3 text-xs text-[#8E8E8E] dark:text-slate-500 font-mono font-medium">
                <span>{history[0]?.time}</span>
                <span>{history[Math.floor(history.length / 2)]?.time}</span>
                <span>{history[history.length - 1]?.time}</span>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Noch keine Tageswerte verfügbar.
            </div>
          )}
        </div>
      </section>

      {/* Solar Forecast Card */}
      {powerData.solar_forecast && (
        <div className="px-10 pt-5">
          <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <Sun className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Solar-Prognose</h3>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  powerData.solar_forecast.confidence.level === 'high'
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    : powerData.solar_forecast.confidence.level === 'medium'
                    ? 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                    : powerData.solar_forecast.confidence.level === 'low'
                    ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600'
                }`}>
                  {powerData.solar_forecast.confidence.level === 'high' && 'Hohe Sicherheit'}
                  {powerData.solar_forecast.confidence.level === 'medium' && 'Mittlere Sicherheit'}
                  {powerData.solar_forecast.confidence.level === 'low' && 'Geringe Sicherheit'}
                  {powerData.solar_forecast.confidence.level === 'uncertain' && 'Prognose derzeit unsicher'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-sm">
                {powerData.solar_forecast.headline}
              </p>
            </div>

            {powerData.solar_forecast.installed_kwp && (
              <div className="text-right border-l border-slate-200 dark:border-slate-700 pl-5 flex-shrink-0">
                <span className="text-[11px] text-slate-400 block font-medium">Anlagenleistung</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">
                  {powerData.solar_forecast.installed_kwp} kWp
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
