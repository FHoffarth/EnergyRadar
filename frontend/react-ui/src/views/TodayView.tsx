import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Line, ReferenceArea, ReferenceLine } from 'recharts';
import { Info } from 'lucide-react';
import { TimelineEntry, TodayData } from '../types';
import { useApp, useNumberLocale } from '../context/AppContext';
import { formatNumber } from '../lib/format';
import { MultiDayWeatherForecast, WeatherIntelligence, nearTermSolarOutlook } from '../components/WeatherIntelligence';
import { usePrefersReducedMotion } from '../lib/motion';
import { EnergyChartTooltip } from '../components/EnergyChartTooltip';
import { DailySummaryMetrics } from '../components/DailySummaryMetrics';
import { DailyVerdict } from '../components/decision/DailyVerdict';
import { AutarkieGauge } from '../components/decision/AutarkieGauge';
import { EconomicHero } from '../components/decision/EconomicHero';
import { EnergyBalanceStory } from '../components/decision/EnergyBalanceStory';
import { LivePvGauge } from '../components/decision/LivePvGauge';
import { LiveEnergyStrip } from '../components/decision/LiveEnergyStrip';
import { verdictTone, livePvState } from '../lib/decisionView';
import { DataCoverageStatus } from '../components/DataCoverageStatus';
import { RecordingHeartbeat } from '../components/energy/RecordingHeartbeat';
import { describeRecording } from '../lib/freshness';
import { evaluateCoverage } from '../lib/storytelling';
import { DEFAULT_RECORDING_CADENCE_SECONDS, formatTimelineTime, timelineGaps, todayCoverageBoundaries, withVisibleTimelineGaps } from '../lib/timelineIntegrity';

// Recharts 3 omits standard SVG fill props from this generic component's
// public TypeScript surface even though the runtime component supports them.
const GapReferenceArea = ReferenceArea as React.ComponentType<React.ComponentProps<'rect'> & {
  x1: number; x2: number; yAxisId?: 'left' | 'right'; ifOverflow?: 'hidden';
}>;

/** A series needs this many measured points before it is charted or listed. */
const MIN_SERIES_POINTS = 2;

function isDemoSource(sourceType: string): boolean {
  return sourceType === 'demo';
}

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
  const animate = !usePrefersReducedMotion();
  const expectedCadenceSeconds = isDemoSource(sourceType)
    ? 2 * 60 * 60
    : settingsPayload?.system?.recording_interval_seconds ?? DEFAULT_RECORDING_CADENCE_SECONDS;

  const noData = timeline.length === 0;
  const isDemo = sourceType === 'demo';
  const fallbackToday: TodayData = {
    solarTotal: { state: 'unknown' }, homeTotal: { state: 'unknown' },
    gridFeedInTotal: { state: 'unknown' }, gridDrawTotal: { state: 'unknown' },
    selfSufficiency: { state: 'unknown' }, selfConsumption: { state: 'unknown' }, history: [],
  };
  const coverage = evaluateCoverage(timeline, {
    expectedCadenceSeconds,
    ...todayCoverageBoundaries(timeline),
  });
  const chartTimeline = withVisibleTimelineGaps(timeline, expectedCadenceSeconds);
  const gaps = timelineGaps(timeline, expectedCadenceSeconds);
  const chartGapCount = gaps.length;

  // Per-series evidence thresholds: a series that the devices never
  // delivered must not appear as a flat line or an empty legend entry.
  const series = [
    { key: 'solarKw' as SeriesKey, name: 'Solar', color: '#D97706', legendDot: 'bg-amber-500/80', axis: 'left' as const },
    { key: 'homeLoadKw' as SeriesKey, name: 'Verbrauch', color: '#4F46E5', legendDot: 'bg-indigo-500', axis: 'left' as const },
    { key: 'batteryPct' as SeriesKey, name: 'Speicher %', color: '#059669', legendDot: 'bg-emerald-500', axis: 'right' as const },
  ].filter(entry => evidenceCount(timeline, entry.key) >= MIN_SERIES_POINTS);

  // Axis and tooltip use up to two decimals so low-power days do not
  // collapse into a column of identical "0,1 kW" ticks.
  const formatAxisKw = (value: number) =>
    formatNumber(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  const hasLeftAxis = series.some(entry => entry.axis === 'left');
  const hasRightAxis = series.some(entry => entry.axis === 'right');
  const hasChartableSeries = series.length > 0;

  // Decision-cockpit hero values (evidence stays below).
  const today: TodayData = todayData ?? fallbackToday;
  const assessment = today.assessment ?? null;
  const autarkiePct = today.selfSufficiency.state === 'available' ? today.selfSufficiency.value : null;
  const autarkieTone = verdictTone(assessment?.assessment_class ?? null);
  const capacityKwp = settingsPayload?.effective_settings?.pv_installed_kwp ?? null;
  const pvPowerKw = snapshot?.solar?.origin === 'observed' ? snapshot.solar.valueKw : null;
  const pvGaugeState = livePvState(pvPowerKw, snapshot?.solar?.origin, snapshot?.quality, new Date());

  const recording = describeRecording(settingsPayload?.system, { locale });
  const coverageLabel = { complete: 'Vollständig', partial: 'Teilweise', sparse: 'Wenige Daten', unavailable: 'Nicht verfügbar' }[coverage.level];
  const weatherEnabled = Boolean(settingsPayload?.effective_settings?.weather_enabled);
  // Cautious near-term outlook that binds the forecast to the day arc.
  const nearTermOutlook = weatherEnabled ? nearTermSolarOutlook(weatherReport ?? null) : null;

  return (
    <div className="cockpit-page h-full flex flex-col overflow-y-auto gap-8" data-testid="today-workspace">
      {/* Unified surface: one compact live strip + the day's judgement. On
          desktop the live flow reads first; on mobile the verdict leads. */}
      <div className="flex flex-col gap-4">
        <div className="order-2 lg:order-1">
          <LiveEnergyStrip snapshot={snapshot} locale={locale} />
        </div>
        {/* Decision cockpit: verdict · autonomy · economic value (first viewport). */}
        <section aria-label="Tagesentscheidung" className="order-1 cockpit-surface p-5 lg:order-2 lg:p-6" data-testid="decision-cockpit">
        <DailyVerdict assessment={assessment} />
        <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-center">
          <div className="flex flex-col items-center gap-3">
            <AutarkieGauge pct={autarkiePct} tone={autarkieTone} animate={animate} />
            {autarkiePct !== null && (
              <p className="max-w-xs text-center text-sm text-slate-600 dark:text-slate-300">
                Heute wurden <strong className="text-slate-800 dark:text-slate-100">{autarkiePct}&nbsp;%</strong> deines
                {' '}Strombedarfs ohne Netzbezug gedeckt.
              </p>
            )}
            <LivePvGauge powerKw={pvPowerKw} capacityKwp={capacityKwp} state={pvGaugeState} locale={locale} />
          </div>
          <EconomicHero report={today.economy} locale={locale} />
        </div>
        <div className="mt-6 border-t border-slate-200/70 pt-5 dark:border-slate-800">
          <EnergyBalanceStory data={today} locale={locale} />
        </div>
        </section>
      </div>

      {isDemo && (
        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-xl p-3 px-4 text-xs flex items-center gap-2 text-sky-800 dark:text-sky-300">
          <Info className="w-4 h-4 shrink-0" />
          <span>Verlauf und Ereignisse stammen aus dem aktiven Demo-Szenario. Im verbundenen Modus werden echte Tagesdaten angezeigt.</span>
        </div>
      )}

      {noData && !isDemo && (
        <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-6">
          <p className="text-slate-700 dark:text-slate-300">
            Der Tagesverlauf steht zur Verfügung, sobald eine lokale Datenquelle verbunden ist und Tagesdaten liefert.
          </p>
        </div>
      )}

      {noData && isDemo && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-6">
          <p className="text-amber-800 dark:text-amber-300">
            Demo-Daten werden geladen. Bitte wählen Sie ein Demo-Szenario in den Einstellungen.
          </p>
        </div>
      )}

      {/* 2 — Day arc */}
      {!noData && (
        <section className="cockpit-surface space-y-4 p-5 lg:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="cockpit-section-title">
              {isDemo ? '24-Stunden-Chronik (Demo)' : '24-Stunden-Chronik'}
            </h2>
            <div className="flex items-center gap-3 text-xs">
              {series.map(entry => (
                <div className="flex items-center gap-1.5" key={entry.key}>
                  <span className={`w-2 h-2 rounded-full ${entry.legendDot} inline-block`} />
                  <span className="text-slate-500 dark:text-slate-400">{entry.name}</span>
                </div>
              ))}
              {chartGapCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t border-dashed border-slate-500" />
                  <span className="text-slate-500 dark:text-slate-400">Datenlücke (keine Messwerte)</span>
                </div>
              )}
            </div>
          </div>

          {hasChartableSeries ? (
            <div className="h-[clamp(20rem,48vh,34rem)] w-full" role="img"
              aria-label={`Energieverlauf mit ${chartGapCount} sichtbaren ${chartGapCount === 1 ? 'Datenlücke' : 'Datenlücken'}. Solar und Verbrauch in Kilowatt.`}>
              <p className="sr-only">Fehlende Messperioden sind schattiert und nur durch eine gestrichelte, nicht gemessene Orientierungshilfe überbrückt. Gültige Nullwerte bleiben Teil der Kurve.</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartTimeline} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
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
                  <XAxis dataKey="timestampMs" type="number" scale="time" domain={['dataMin', 'dataMax']}
                    stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false}
                    minTickGap={48} tickFormatter={value => formatTimelineTime(value, locale)} />
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
                  {gaps.map((gap, index) => (
                    <GapReferenceArea key={`gap-area-${index}`} x1={gap.before.timestampMs} x2={gap.after.timestampMs}
                      yAxisId={hasLeftAxis ? 'left' : 'right'} fill="#64748B" fillOpacity={0.09}
                      stroke="none" ifOverflow="hidden" />
                  ))}
                  {gaps.flatMap((gap, gapIndex) => series.map(entry => {
                    const before = gap.before[entry.key];
                    const after = gap.after[entry.key];
                    if (typeof before !== 'number' || !Number.isFinite(before) || typeof after !== 'number' || !Number.isFinite(after)) return null;
                    return <ReferenceLine key={`gap-bridge-${gapIndex}-${entry.key}`} yAxisId={entry.axis}
                      segment={[{ x: gap.before.timestampMs, y: before }, { x: gap.after.timestampMs, y: after }]}
                      stroke={entry.color} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 4" ifOverflow="hidden" />;
                  }))}
                  {series.map(entry => (
                    entry.key === 'batteryPct' ? (
                      <Line key={entry.key} yAxisId="right" type="linear" dataKey={entry.key} name={entry.name}
                        stroke={entry.color} strokeWidth={2}
                        dot={evidenceCount(timeline, entry.key) <= 3 ? { r: 2, strokeWidth: 0 } : false}
                        connectNulls={false}
                        isAnimationActive={animate} />
                    ) : (
                      <Area key={entry.key} yAxisId="left" type="linear" dataKey={entry.key} name={entry.name}
                        stroke={entry.color} strokeWidth={2} fillOpacity={1}
                        dot={evidenceCount(timeline, entry.key) <= 3 ? { r: 2, strokeWidth: 0 } : false}
                        connectNulls={false}
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
          {nearTermOutlook && (
            <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="near-term-outlook">
              <span className="font-medium text-slate-700 dark:text-slate-200">Ausblick:</span> {nearTermOutlook}
            </p>
          )}
          {/* One compact data-quality footer. Detailed reasons live only in
              Technical Details — the chart is evidence, not a second Today page. */}
          <div data-testid="chart-data-quality"
            className="border-t border-slate-200/70 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              Datenabdeckung {coverageLabel.toLowerCase()}
              {chartGapCount > 0 ? ` · ${formatNumber(chartGapCount, locale)} ${chartGapCount === 1 ? 'Lücke' : 'Lücken'}` : ''}
            </span>
            {chartGapCount > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">Warum fehlen Daten?</summary>
                <p className="mt-1">Für einzelne Abschnitte liegen keine Messwerte vor. Abdeckung, Quellen und Details stehen unten unter „Technische Details“.</p>
              </details>
            )}
          </div>
        </section>
      )}

      {/* Weather as energy context: one surface (current + hourly, current
          hour reads 'Jetzt', expired hours drop at the boundary), with the
          multi-day outlook secondary behind its own disclosure. */}
      {weatherEnabled && (
        <section aria-label="Wetter als Energie-Kontext" className="flex flex-col gap-3">
          <WeatherIntelligence report={weatherReport} locale={locale} snapshot={snapshot} />
          {/* Multi-day forecast is secondary — behind a disclosure so weather
              never competes with the day's energy story. */}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">Mehrtägige Vorhersage</summary>
            <div className="mt-3">
              <MultiDayWeatherForecast report={weatherReport} locale={locale} />
            </div>
          </details>
        </section>
      )}

      {/* Recording state — one heartbeat, no second data-quality line (that
          lives once in the chart footer above). */}
      <section aria-label="Aufzeichnung" className="flex flex-col gap-2">
        {recording && <RecordingHeartbeat descriptor={recording} />}
      </section>

      {/* 7 — Technical details */}
      <details className="text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Technische Details</summary>
        <div className="mt-4 lg:max-w-3xl">
          <DailySummaryMetrics data={today} coverage={coverage} locale={locale} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <DataCoverageStatus coverage={coverage} scope="Tagesverlauf" />
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <p>Gespeicherte Messpunkte: <strong className="text-slate-700 dark:text-slate-200">{formatNumber(timeline.length, locale)}</strong></p>
            <p className="mt-1">Darstellbare Messreihen: <strong className="text-slate-700 dark:text-slate-200">{formatNumber(series.length, locale)}</strong></p>
          </div>
        </div>
      </details>
    </div>
  );
}
