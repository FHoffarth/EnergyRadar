import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Sun, Home, Zap, ArrowRight, ArrowLeft, Info, ShieldCheck } from 'lucide-react';
import { EnergyFlow } from '../components/EnergyFlow';
import { useApp } from '../context/AppContext';

export function NowView() {
  const { snapshot, timeline, devices, sourceType } = useEnergyProvider();
  const { settingsPayload, weatherReport } = useApp();

  const isGenerating = snapshot.solar.valueKw !== null && snapshot.solar.valueKw > 0;
  const isFeeding = snapshot.grid.valueKw !== null && snapshot.grid.valueKw < 0;
  const isDrawing = snapshot.grid.valueKw !== null && snapshot.grid.valueKw > 0;

  const history = timeline.filter(t => t.solarKw !== null);
  const maximumSolar = Math.max(0, ...history.map(t => t.solarKw ?? 0));
  const weatherEnabled = Boolean(settingsPayload?.effective_settings?.weather_enabled);
  const weatherSummary = (() => {
    if (!weatherEnabled) return null;
    if (!weatherReport) return 'Wetterdaten werden geladen…';
    if (weatherReport.status === 'available') {
      const place = weatherReport.location?.display_name;
      const temperature = weatherReport.current?.temperature_c;
      const conditionLabels: Record<string, string> = {
        clear: 'Klar',
        partly_cloudy: 'Teilweise bewölkt',
        cloudy: 'Bewölkt',
        rain: 'Regen',
        heavy_rain: 'Starker Regen',
        snow: 'Schnee',
        fog: 'Nebel',
        thunderstorm: 'Gewitter',
      };
      const condition = weatherReport.current?.condition
        ? conditionLabels[weatherReport.current.condition] || 'Wetter verfügbar'
        : 'Wetter verfügbar';
      return [
        place,
        typeof temperature === 'number' ? `${temperature.toLocaleString('de-DE')} °C` : null,
        condition,
      ].filter(Boolean).join(' · ');
    }
    return weatherReport.warnings?.[0]?.message || 'Wetterdaten momentan nicht erreichbar.';
  })();

  const hasSolar = snapshot.solar.valueKw !== null && snapshot.solar.origin === 'observed';
  const hasHome = snapshot.homeLoad.valueKw !== null && snapshot.homeLoad.origin === 'observed';
  const hasGrid = snapshot.grid.valueKw !== null && snapshot.grid.origin === 'observed';
  const solarOnly = hasSolar && !hasHome && !hasGrid;

  const qualityLabel = () => {
    if (solarOnly) return snapshot.timestamp ? `Solar live · ${snapshot.timestamp}` : 'Solar live';
    switch (snapshot.quality) {
      case 'live': return snapshot.timestamp ? `Live · ${snapshot.timestamp}` : 'Live';
      case 'stale': return `Veraltet · ${snapshot.timestamp || ''}`;
      case 'error': return 'Nicht erreichbar';
      case 'unavailable': default: return 'Keine Daten';
    }
  };

  const qualityDotClass = () => {
    if (solarOnly) return 'bg-emerald-500';
    switch (snapshot.quality) {
      case 'live': return 'bg-emerald-500';
      case 'stale': return 'bg-amber-500';
      case 'error': return 'bg-rose-500';
      default: return 'bg-slate-400';
    }
  };

  let mainStatement: string;
  if (solarOnly) {
    mainStatement = 'Solardaten sind live.';
  } else if (snapshot.assessment?.verdict && snapshot.quality === 'live') {
    mainStatement = snapshot.assessment.verdict;
  } else if (snapshot.quality === 'unavailable') {
    mainStatement = 'Keine Datenquelle eingerichtet.';
  } else if (snapshot.quality === 'error') {
    mainStatement = 'Gerät momentan nicht erreichbar.';
  } else if (snapshot.quality === 'stale') {
    mainStatement = 'Veraltete Messwerte – erneute Verbindung wird versucht.';
  } else {
    mainStatement = 'Live-Daten sind verfügbar.';
  }

  const originLabel = () => {
    if (sourceType === 'demo') return 'Demo-Daten · Simuliert';
    if (sourceType === 'bridge') {
      if (hasSolar && !hasHome && !hasGrid) return 'Solar live · Fronius';
      if (hasSolar) return 'Live · Bridge';
      return 'Bridge verbunden';
    }
    return 'Keine Daten';
  };

  return (
    <div className="flex flex-col h-full pt-8 pb-4">
      <header className="px-8 pb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/40">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Was jetzt zählt</span>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${sourceType === 'demo' ? 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/40' : sourceType === 'offline' ? 'bg-slate-50 text-slate-600 border border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700' : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/40'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${sourceType === 'demo' ? 'bg-sky-500' : sourceType === 'offline' ? 'bg-slate-400' : 'bg-emerald-500'}`} />
            {originLabel()}
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-[#1C1C1E] dark:text-white leading-snug max-w-2xl">
          {mainStatement}
        </h1>
        <div className="flex items-center gap-1.5 text-sm text-[#8E8E8E] dark:text-slate-500 mt-1.5 font-medium">
          <div className={`w-2 h-2 rounded-full ${qualityDotClass()}`} />
          <span>{qualityLabel()}</span>
        </div>
        {solarOnly && (
          <p className="text-sm text-[#8E8E8E] dark:text-slate-500 mt-1">
            Verbrauch und Netzfluss sind derzeit nicht verfügbar.
          </p>
        )}
        {weatherSummary && (
          <p data-testid="weather-status" className="text-xs text-[#6E6E6E] dark:text-slate-400 mt-1.5">
            {weatherSummary}
          </p>
        )}
      </header>

      <section className="px-8 flex items-stretch gap-3 mb-6">
        {(() => {
          const val = (v: number | null) => v !== null ? Math.abs(v) : null;
          const isUk = (v: number | null) => v === null;
          return (
            <>
              <div className={`flex-1 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm transition-all duration-300 ${isGenerating ? 'ring-2 ring-amber-500/10' : ''}`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-slate-700">
                    <Sun className="w-5 h-5 text-amber-500" />
                  </div>
                  <span className="text-sm text-[#6E6E6E] dark:text-slate-400 font-medium">Solaranlage</span>
                </div>
                <div className="text-2xl font-bold mb-1 text-[#1C1C1E] dark:text-white">
                  {isUk(snapshot.solar.valueKw) ? '–' : (val(snapshot.solar.valueKw)!).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  <span className="text-lg font-medium text-[#8E8E8E] dark:text-slate-500 ml-1">kW</span>
                </div>
                <p className={`text-xs font-medium ${isUk(snapshot.solar.valueKw) ? 'text-slate-400' : 'text-amber-600'}`}>
                  {isUk(snapshot.solar.valueKw) ? 'Nicht verfügbar' : isGenerating ? 'Wird gerade erzeugt' : 'Keine Erzeugung'}
                </p>
              </div>
              <div className="flex items-center justify-center flex-shrink-0 w-4 text-[#E5E5E3] dark:text-slate-700">
                <ArrowRight className={`w-5 h-5 transition-colors duration-300 ${isGenerating ? 'text-amber-500/40' : ''}`} />
              </div>
              <div className={`flex-1 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm transition-all duration-300 ${snapshot.homeLoad.valueKw !== null && snapshot.homeLoad.valueKw > 0 ? 'ring-2 ring-sky-500/10' : ''}`}>
                <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-sky-50 dark:bg-slate-700">
                        <Home className="w-5 h-5 text-sky-500" />
                      </div>
                      <span className="text-sm text-[#6E6E6E] dark:text-slate-400 font-medium">Hausverbrauch</span>
                    </div>
                    <div className="text-2xl font-bold mb-1 text-[#1C1C1E] dark:text-white">
                      {isUk(snapshot.homeLoad.valueKw) ? '–' : (val(snapshot.homeLoad.valueKw)!).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      <span className="text-lg font-medium text-[#8E8E8E] dark:text-slate-500 ml-1">kW</span>
                    </div>
                    <p className={`text-xs font-medium ${isUk(snapshot.homeLoad.valueKw) ? 'text-slate-400' : 'text-sky-600'}`}>
                      {isUk(snapshot.homeLoad.valueKw) ? 'Nicht verfügbar' : 'Wird im Haus genutzt'}
                    </p>
                  </div>
                  <div className="flex items-center justify-center flex-shrink-0 w-4 text-[#E5E5E3] dark:text-slate-700">
                    {isFeeding ? <ArrowRight className="w-5 h-5 text-emerald-500/50" /> :
                     isDrawing ? <ArrowLeft className="w-5 h-5 text-rose-500/50" /> :
                     <ArrowRight className="w-5 h-5" />}
                  </div>
                  <div className={`flex-1 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm transition-all duration-300 ${isFeeding || isDrawing ? 'ring-2 ring-rose-500/10' : ''}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`p-1.5 rounded-lg ${isFeeding ? 'bg-emerald-50' : 'bg-rose-50'} dark:bg-slate-700`}>
                        <Zap className={`w-5 h-5 ${isFeeding ? 'text-emerald-500' : 'text-rose-500'}`} />
                      </div>
                      <span className="text-sm text-[#6E6E6E] dark:text-slate-400 font-medium">Stromnetz</span>
                    </div>
                    <div className="text-2xl font-bold mb-1 text-[#1C1C1E] dark:text-white">
                      {isUk(snapshot.grid.valueKw) ? '–' : (val(snapshot.grid.valueKw)!).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      <span className="text-lg font-medium text-[#8E8E8E] dark:text-slate-500 ml-1">kW</span>
                    </div>
                    <p className={`text-xs font-medium ${isUk(snapshot.grid.valueKw) ? 'text-slate-400' : isFeeding ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {isUk(snapshot.grid.valueKw) ? 'Nicht verfügbar' : isFeeding ? 'Einspeisung ins Netz' : isDrawing ? 'Bezug aus dem Netz' : 'Kein Austausch'}
                    </p>
              </div>
            </>
          );
        })()}
      </section>

      <section className="px-8 flex-1 flex min-h-0 gap-4 pb-3">
        <div className="flex-[3] bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 p-5 flex flex-col shadow-sm">
          <div>
            <h3 className="text-sm font-semibold text-[#1C1C1E] dark:text-white mb-3">Systemstatus</h3>
            <div className="space-y-2.5">
              {devices.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {sourceType === 'demo' ? 'Demo-Modus: Simulierte Geräte sind aktiv.' : 'Keine Geräte verbunden.'}
                </p>
              ) : devices.map(device => (
                <div className="flex items-center gap-3" key={device.id}>
                  <div className={`w-2 h-2 rounded-full ${device.status === 'active' ? 'bg-emerald-500' : device.status === 'last_known' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1C1C1E] dark:text-white truncate">{device.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{device.notes}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {snapshot.assessment?.confidence && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Bewertung: <span className="font-semibold text-slate-800 dark:text-slate-200">{snapshot.assessment.confidence}</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex-[2] bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 p-5 flex flex-col shadow-sm min-h-0">
          <h3 className="text-sm font-semibold text-[#1C1C1E] dark:text-white mb-3">Tagesverlauf</h3>
          {history.length > 0 && maximumSolar > 0 ? (
            <>
              <div className="flex-1 flex items-end gap-0.5" aria-label="Gemessener Tagesverlauf">
                {history.map((point, index) => (
                  <div key={`${point.time}-${index}`}
                    className="flex-1 min-w-0 bg-amber-500 dark:bg-amber-500/80 rounded-t-sm"
                    style={{ height: `${Math.max(2, ((point.solarKw ?? 0) / maximumSolar) * 100)}%` }}
                    title={`${point.time}: ${point.solarKw?.toLocaleString('de-DE')} kW`} />
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
              {sourceType === 'demo' ? 'Demo-Daten laden...' : 'Noch keine Tageswerte verfügbar.'}
            </div>
          )}
        </div>
      </section>

      {snapshot.solarForecast && (
        <div className="px-8 pt-3">
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <Sun className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Solar-Prognose</h3>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  snapshot.solarForecast.confidence.level === 'high'
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                    : snapshot.solarForecast.confidence.level === 'medium'
                    ? 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                    : snapshot.solarForecast.confidence.level === 'low'
                    ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-600'
                }`}>
                  {snapshot.solarForecast.confidence.level === 'high' && 'Hohe Sicherheit'}
                  {snapshot.solarForecast.confidence.level === 'medium' && 'Mittlere Sicherheit'}
                  {snapshot.solarForecast.confidence.level === 'low' && 'Geringe Sicherheit'}
                  {snapshot.solarForecast.confidence.level === 'uncertain' && 'Prognose derzeit unsicher'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-sm">{snapshot.solarForecast.headline}</p>
            </div>
            {snapshot.solarForecast.installed_kwp && (
              <div className="text-right border-l border-slate-200 dark:border-slate-700 pl-5 flex-shrink-0">
                <span className="text-[11px] text-slate-400 block font-medium">Anlagenleistung</span>
                <span className="text-base font-bold text-slate-900 dark:text-white">{snapshot.solarForecast.installed_kwp} kWp</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-8 pt-4">
        <EnergyFlow snapshot={snapshot} />
      </div>
    </div>
  );
}
