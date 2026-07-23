import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatEnergy } from '../lib/format';
import { Area, Line, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Sun, AlertCircle, Info, ChevronDown, ChevronUp, Zap, Clock, ShieldCheck } from 'lucide-react';

export function TodayView() {
  const { todayData, status, settingsPayload } = useApp();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const getStatement = () => {
    if (status === 'no_data') return 'Es liegen noch keine Daten für heute vor.';
    return 'Heute hast du einen großen Teil deines Stroms selbst erzeugt.';
  };

  const needsPin = status === 'meter_locked';
  const noData = todayData.history.length === 0;
  const forecast = todayData.solar_forecast;

  // Format peak window timestamps if present
  let peakWindowText: string | null = null;
  if (forecast?.peak_window_start && forecast?.peak_window_end) {
    try {
      const s = new Date(forecast.peak_window_start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const e = new Date(forecast.peak_window_end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      peakWindowText = `${s} – ${e} Uhr`;
    } catch {
      peakWindowText = null;
    }
  }

  // Find max expected power across all intervals for range bar scaling
  const maxForecastPower = forecast?.intervals
    ? Math.max(...forecast.intervals.map(i => i.expected_max_w || 0), 1000)
    : 3000;

  return (
    <div className="px-10 py-12 h-full flex flex-col overflow-y-auto">
      <h1 className="text-4xl sm:text-5xl font-medium tracking-tight text-slate-900 dark:text-white max-w-2xl leading-tight mb-12">
        {getStatement()}
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-6 mb-12">
        <MetricCard label="Solarerzeugung" value={todayData.solarTotal.state === 'available' ? formatEnergy(todayData.solarTotal.value) : '–'} />
        <MetricCard label="Verbrauch" value={todayData.homeTotal.state === 'available' ? formatEnergy(todayData.homeTotal.value) : '–'} />
        <MetricCard label="Netzbezug" value={todayData.gridDrawTotal.state === 'available' ? formatEnergy(todayData.gridDrawTotal.value) : '–'} />
        <MetricCard label="Einspeisung" value={todayData.gridFeedInTotal.state === 'available' ? formatEnergy(todayData.gridFeedInTotal.value) : '–'} />
        <MetricCard label="Eigenverbrauch" value={todayData.selfConsumption.state === 'available' ? `${todayData.selfConsumption.value} %` : '–'} />
        <MetricCard label="Autarkie" value={todayData.selfSufficiency.state === 'available' ? `${todayData.selfSufficiency.value} %` : '–'} />
      </div>

      {needsPin && (
        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-4 mb-8">
          <p className="text-slate-700 dark:text-slate-300">
            Solarverlauf verfügbar. Netz- und Verbrauchsverlauf benötigen die MT175-PIN-Freigabe.
          </p>
        </div>
      )}

      {/* TODAY SOLAR FORECAST CARD (Sprint 5E) */}
      {forecast && (
        <section aria-label="Solarprognose Heute" className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm mb-12 space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2.5">
                <Sun className="w-6 h-6 text-amber-500" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Solarprognose Heute</h2>
              </div>
              <p className="text-slate-700 dark:text-slate-300 font-medium text-base leading-relaxed">
                {forecast.headline}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                forecast.confidence.level === 'high'
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : forecast.confidence.level === 'medium'
                  ? 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                  : forecast.confidence.level === 'low'
                  ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
              }`}>
                <ShieldCheck className="w-3.5 h-3.5" />
                {forecast.confidence.level === 'high' && 'Hohe Sicherheit'}
                {forecast.confidence.level === 'medium' && 'Mittlere Sicherheit'}
                {forecast.confidence.level === 'low' && 'Geringe Sicherheit'}
                {forecast.confidence.level === 'uncertain' && 'Prognose derzeit unsicher'}
              </span>
            </div>
          </div>

          {/* Status Fallbacks */}
          {forecast.status === 'disabled' && (
            <p className="text-sm text-slate-500">Wetterdaten sind in den Einstellungen deaktiviert.</p>
          )}

          {forecast.status === 'uncertain' && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm space-y-1">
              <p className="font-semibold">Kein Diagramm verfügbar</p>
              <p>{forecast.confidence.reasons.join(' ')}</p>
            </div>
          )}

          {/* Peak Window Display & Range Bar Chart */}
          {forecast.status === 'available' && forecast.intervals.length > 0 && (
            <div className="space-y-6">
              {peakWindowText && (
                <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-2.5 rounded-xl border border-amber-200/60 dark:border-amber-800/40 w-fit">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span>Erwartetes Peak-Zeitfenster: <strong className="text-amber-600 dark:text-amber-400">{peakWindowText}</strong></span>
                </div>
              )}

              {/* Accessible Text Summary */}
              <div className="sr-only">
                Prognostizierter Tagesverlauf mit Ertragsspannen von 06:00 bis 22:00 Uhr. Maximale Erwartung im Peak-Zeitfenster {peakWindowText || 'am Nachmittag'}.
              </div>

              {/* Responsive Uncertainty Range Bar Grid */}
              <div className="overflow-x-auto pb-2">
                <div className="min-w-[640px] grid grid-cols-16 gap-2 items-end h-40 pt-6 px-2 border-b border-slate-200 dark:border-slate-800">
                  {forecast.intervals.map((interval, idx) => {
                    const minW = interval.expected_min_w || 0;
                    const maxW = interval.expected_max_w || 0;

                    const minPct = (minW / maxForecastPower) * 100;
                    const maxPct = (maxW / maxForecastPower) * 100;

                    const hourStr = new Date(interval.start_time).getHours().toString().padStart(2, '0');
                    const isPeak = forecast.peak_window_start && new Date(interval.start_time).toISOString() === new Date(forecast.peak_window_start).toISOString();

                    return (
                      <div key={idx} className="flex flex-col items-center gap-2 h-full justify-end group relative">
                        {/* Tooltip on Hover */}
                        <div className="absolute -top-12 hidden group-hover:flex flex-col items-center bg-slate-900 text-white text-xs py-1 px-2.5 rounded-lg whitespace-nowrap z-20 shadow-lg border border-slate-700">
                          <span className="font-semibold">{hourStr}:00 Uhr</span>
                          <span>{minW.toFixed(0)} W – {maxW.toFixed(0)} W</span>
                        </div>

                        {/* Range Bar */}
                        <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-t-lg relative flex items-end overflow-hidden" style={{ height: '100%' }}>
                          {maxPct > 0 && (
                            <div
                              className={`w-full rounded-t-md transition-all duration-300 ${
                                isPeak
                                  ? 'bg-gradient-to-t from-amber-500 to-amber-400 dark:from-amber-600 dark:to-amber-500'
                                  : 'bg-gradient-to-t from-sky-400 to-sky-300 dark:from-sky-600 dark:to-sky-500 opacity-80'
                              }`}
                              style={{ height: `${maxPct}%` }}
                            >
                              {/* Inner Min Band Overlay */}
                              {minPct > 0 && (
                                <div
                                  className="w-full bg-amber-600 dark:bg-amber-400 opacity-40 rounded-t-sm"
                                  style={{ height: `${(minPct / maxPct) * 100}%` }}
                                />
                              )}
                            </div>
                          )}
                        </div>

                        {/* X-Axis Hour Label */}
                        <span className={`text-[11px] font-mono ${isPeak ? 'font-bold text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                          {hourStr}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Data Basis & Warnings */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <span>{detailsOpen ? '▸ Datenbasis und Hinweise ausblenden' : '▸ Datenbasis und Hinweise anzeigen'}</span>
              {detailsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {detailsOpen && (
              <div className="mt-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 text-xs space-y-2 border border-slate-200 dark:border-slate-700/60">
                <div>
                  <strong className="text-slate-800 dark:text-slate-200 block mb-1">Berücksichtigte Faktoren:</strong>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400">
                    {forecast.data_basis.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                {forecast.warnings.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60">
                    <strong className="text-amber-600 dark:text-amber-400 block mb-1">Hinweise & Warnungen:</strong>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-700 dark:text-amber-300">
                      {forecast.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TODAY ENERGY HISTORY CHART */}
      {!noData && (
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Heutiger Ertrags- & Verbrauchsverlauf</h2>
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={todayData.history} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSolarToday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" strokeOpacity={0.1} />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 12 }}
                  dy={10}
                  minTickGap={30}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748B', fontSize: 12 }}
                  tickFormatter={(val) => `${val} W`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', backgroundColor: '#1E293B', color: '#F8FAFC', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.3)' }}
                  itemStyle={{ fontSize: '14px' }}
                  labelStyle={{ color: '#94A3B8', marginBottom: '8px' }}
                  formatter={(value: any) => value !== null ? `${value} W` : '–'}
                />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '14px', color: '#64748B' }} />

                <Area
                  type="monotone"
                  dataKey="solar"
                  name="Solar"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSolarToday)"
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="home"
                  name="Verbrauch"
                  stroke="#0EA5E9"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="gridImport"
                  name="Netzbezug"
                  stroke="#EF4444"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="gridExport"
                  name="Einspeisung"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-[#E5E5E3] dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
      <span className="text-slate-500 text-sm font-medium">{label}</span>
      <span className="text-2xl font-semibold text-slate-900 dark:text-white mt-2">{value}</span>
    </div>
  );
}
