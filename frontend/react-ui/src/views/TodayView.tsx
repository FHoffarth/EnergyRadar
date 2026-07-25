import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Line } from 'recharts';
import { Sun, Info } from 'lucide-react';

export function TodayView() {
  const { timeline, providerType } = useEnergyProvider();

  const noData = timeline.length === 0;
  const isDemo = providerType === 'demo';

  return (
    <div className="px-10 py-12 h-full flex flex-col overflow-y-auto">
      <h1 className="text-4xl sm:text-5xl font-medium tracking-tight text-slate-900 dark:text-white max-w-2xl leading-tight mb-6">
        {isDemo
          ? 'Heutiger Energieverlauf (Demo)'
          : noData
          ? 'Tagesverlauf noch nicht verfügbar'
          : 'Heutiger Energieverlauf'}
      </h1>

      {isDemo && (
        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-xl p-3 px-4 text-xs flex items-center gap-2 text-sky-800 dark:text-sky-300 mb-8">
          <Info className="w-4 h-4 shrink-0" />
          <span>Verlauf und Ereignisse stammen aus dem aktiven Demo-Szenario. Bridge-Modus zeigt echte Tagesdaten.</span>
        </div>
      )}

      {noData && !isDemo && (
        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-6 mb-8">
          <p className="text-slate-700 dark:text-slate-300">
            Der Tagesverlauf steht erst zur Verfügung, wenn eine Datenquelle über die Desktop-Bridge verbunden ist und Tagesdaten liefert.
          </p>
        </div>
      )}

      {noData && isDemo && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-6 mb-8">
          <p className="text-amber-800 dark:text-amber-300">
            Demo-Daten werden geladen. Bitte wählen Sie ein Demo-Szenario in den Einstellungen.
          </p>
        </div>
      )}

      {!noData && (
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {isDemo ? '24-Stunden-Chronik (Demo)' : '24-Stunden-Chronik'}
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                <span className="text-slate-600 dark:text-slate-400">Solar</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />
                <span className="text-slate-600 dark:text-slate-400">Verbrauch</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
                <span className="text-slate-600 dark:text-slate-400">Speicher</span>
              </div>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="solarGradT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D97706" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#D97706" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="homeGradT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" vertical={false} className="dark:stroke-slate-700" />
                <XAxis dataKey="time" stroke="#64748B" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#64748B" fontSize={11} tickLine={false} unit="kW" />
                <YAxis yAxisId="right" orientation="right" stroke="#64748B" fontSize={11} tickLine={false} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  borderRadius: '0.75rem',
                  fontSize: '12px',
                  color: '#0F172A'
                }} />
                <Area yAxisId="left" type="monotone" dataKey="solarKw" name="Solar" stroke="#D97706" strokeWidth={2} fillOpacity={1} fill="url(#solarGradT)" />
                <Area yAxisId="left" type="monotone" dataKey="homeLoadKw" name="Verbrauch" stroke="#4F46E5" strokeWidth={2} fillOpacity={1} fill="url(#homeGradT)" />
                <Line yAxisId="right" type="monotone" dataKey="batteryPct" name="Speicher %" stroke="#059669" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {isDemo && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Alle Daten in dieser Ansicht sind simuliert und stammen aus dem aktiven Demo-Szenario.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
