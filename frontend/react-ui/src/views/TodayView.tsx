import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Line } from 'recharts';
import { Info } from 'lucide-react';
import { TimelineEntry, TodayData } from '../types';
import { useApp, useNumberLocale } from '../context/AppContext';
import { formatNumber } from '../lib/format';
import { dedupeTickFormatter } from '../lib/chartAxis';
import { CompactHourlyForecast, MultiDayWeatherForecast, WeatherIntelligence } from '../components/WeatherIntelligence';
import { useEffectiveMotionMode } from '../lib/motion';
import { EnergyChartTooltip } from '../components/EnergyChartTooltip';
import { DailySummaryMetrics } from '../components/DailySummaryMetrics';
import { DailyInterpretation } from '../components/DailyInterpretation';
import { DataCoverageStatus } from '../components/DataCoverageStatus';
import { dailyStatements, evaluateCoverage } from '../lib/storytelling';

/** A series needs this many measured points before it is charted or listed. */
const MIN_SERIES_POINTS = 3;

type SeriesKey = 'solarKw' | 'homeLoadKw' | 'batteryPct';

/** Count of points that carry a real measurement. Nulls are not evidence. */
function evidenceCount(timeline: TimelineEntry[], key: SeriesKey): number {
  return timeline.reduce(
    (total, point) => {
      const value = point[key];
      return value !== null && value !== undefined && !Number.isNaN(value) ? total + 1 : total;
    },
    0,
  );
}

export function TodayView() {
  const { timeline, sourceType, snapshot } = useEnergyProvider();
  const { settingsPayload, weatherReport, todayData } = useApp();
  const locale = useNumberLocale();
  const requestedMotion = settingsPayload?.effective_settings?.motion_mode ?? 'full';
  const animate = useEffectiveMotionMode(requestedMotion) === 'full';

  const noData = timeline.length === 0;
  const isDemo = sourceType === 'demo';
  const fallbackToday: TodayData = {
    solarTotal: { state: 'unknown' }, homeTotal: { state: 'unknown' },
    gridFeedInTotal: { state: 'unknown' }, gridDrawTotal: { state: 'unknown' },
    selfSufficiency: { state: 'unknown' }, selfConsumption: { state: 'unknown' }, history: [],
  };
  const currentMinute = new Date().getHours() * 60 + new Date().getMinutes();
  const coverage = evaluateCoverage(timeline, 0, currentMinute);
  const statements = dailyStatements(timeline, coverage, snapshot);

  // Per-series evidence thresholds: a series that the devices never
  // delivered must not appear as a flat line or an empty legend entry.
  const series = [
    { key: 'solarKw' as SeriesKey, name: 'Solar', color: '#D97706', dot: 'bg-amber-500/80', axis: 'left' as const },
    { key: 'homeLoadKw' as SeriesKey, name: 'Verbrauch', color: '#4F46E5', dot: 'bg-indigo-500', axis: 'left' as const },
    { key: 'batteryPct' as SeriesKey, name: 'Speicher %', color: '#059669', dot: 'bg-emerald-500', axis: 'right' as const },
  ].filter(entry => evidenceCount(timeline, entry.key) >= MIN_SERIES_POINTS);

  // Axis and tooltip use up to two decimals so low-power days do not
  // collapse into a column of identical "0,1 kW" ticks.
  const formatAxisKw = (value: number) =>
    formatNumber(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  const formatTimeTick = dedupeTickFormatter(timeline, 'time');

  const hasLeftAxis = series.some(entry => entry.axis === 'left');
  const hasRightAxis = series.some(entry => entry.axis === 'right');
  const hasChartableSeries = series.length > 0;

  return (
    <div className="cockpit-page h-full flex flex-col overflow-y-auto" data-testid="today-workspace">
      <header className="mb-6 max-w-3xl">
      <p className="cockpit-eyebrow">Tagesanalyse</p>
      <h1 className="cockpit-title mt-2 text-slate-900 dark:text-white">
        {isDemo
          ? 'Heutiger Energieverlauf (Demo)'
          : noData
          ? 'Tagesverlauf noch nicht verfügbar'
          : 'Heutiger Energieverlauf'}
      </h1>
      </header>

      <DailySummaryMetrics data={todayData ?? fallbackToday} coverage={coverage} locale={locale} />
      <DailyInterpretation statements={statements} />

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
        <section className="cockpit-surface space-y-4 p-5 lg:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="cockpit-section-title">
              {isDemo ? '24-Stunden-Chronik (Demo)' : '24-Stunden-Chronik'}
            </h2>
            <div className="flex items-center gap-3 text-xs">
              {series.map(entry => (
                <div className="flex items-center gap-1.5" key={entry.key}>
                  <span className={`w-2 h-2 rounded-full ${entry.dot} inline-block`} />
                  <span className="text-slate-500 dark:text-slate-400">{entry.name}</span>
                </div>
              ))}
            </div>
          </div>

          {hasChartableSeries ? (
            <div className="h-[clamp(20rem,48vh,34rem)] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timeline} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="solarGradT" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#D97706" stopOpacity={0.16} />
                      <stop offset="95%" stopColor="#D97706" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="homeGradT" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="time" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false}
                    minTickGap={48} tickFormatter={formatTimeTick} />
                  {hasLeftAxis && (
                    <YAxis yAxisId="left" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} unit="kW"
                      tickFormatter={formatAxisKw} />
                  )}
                  {hasRightAxis && (
                    <YAxis yAxisId="right" orientation="right" stroke="#94A3B8" fontSize={10} tickLine={false}
                      axisLine={false} domain={[0, 100]} unit="%"
                      tickFormatter={(value: number) => formatNumber(value, locale)} />
                  )}
                  <Tooltip
                    isAnimationActive={animate}
                    content={<EnergyChartTooltip locale={locale} />}
                    cursor={{ stroke: '#94A3B8', strokeWidth: 1 }}
                    contentStyle={{
                      borderRadius: '0.625rem',
                      border: '1px solid rgba(148,163,184,0.35)',
                      fontSize: '12px',
                      padding: '4px 8px',
                    }} />
                  {series.map(entry => (
                    entry.key === 'batteryPct' ? (
                      <Line key={entry.key} yAxisId="right" type="linear" dataKey={entry.key} name={entry.name}
                        stroke={entry.color} strokeWidth={2} dot={false} connectNulls={false}
                        isAnimationActive={animate} />
                    ) : (
                      <Area key={entry.key} yAxisId="left" type="linear" dataKey={entry.key} name={entry.name}
                        stroke={entry.color} strokeWidth={2} fillOpacity={1} connectNulls={false}
                        fill={entry.key === 'solarKw' ? 'url(#solarGradT)' : 'url(#homeGradT)'}
                        isAnimationActive={animate} />
                    )
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Für heute liegen noch nicht genug Messwerte für eine Verlaufskurve vor.
            </p>
          )}

          {isDemo && (
            <p className="border-t border-slate-200/70 dark:border-slate-800 pt-4 text-xs text-slate-500 dark:text-slate-400">
              Alle Daten in dieser Ansicht sind simuliert und stammen aus dem aktiven Demo-Szenario.
            </p>
          )}
        </section>
      )}
      <div className="mt-6 grid gap-4" aria-label="Wettervorschau">
        <WeatherIntelligence report={weatherReport} locale={locale} compact snapshot={snapshot} />
        <CompactHourlyForecast report={weatherReport} locale={locale} />
        <MultiDayWeatherForecast report={weatherReport} locale={locale} />
      </div>
      <details className="mt-6 text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Datendetails</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <DataCoverageStatus coverage={coverage} scope="Tagesverlauf" />
          <div className="cockpit-surface-muted px-4 py-3 text-xs">
            <p>Gespeicherte Messpunkte: <strong>{formatNumber(timeline.length, locale)}</strong></p>
            <p className="mt-1">Darstellbare Messreihen: <strong>{formatNumber(series.length, locale)}</strong></p>
          </div>
        </div>
      </details>
    </div>
  );
}
