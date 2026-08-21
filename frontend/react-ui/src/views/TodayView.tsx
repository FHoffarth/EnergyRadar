import React, { useMemo } from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Line, ReferenceArea, ReferenceDot } from 'recharts';
import { Info } from 'lucide-react';
import { TodayData } from '../types';
import { useApp, useNumberLocale } from '../context/AppContext';
import { formatNumber } from '../lib/format';
import { CockpitWeather } from '../components/WeatherIntelligence';
import { usePrefersReducedMotion } from '../lib/motion';
import { ChronikTooltip } from '../components/ChronikTooltip';
import { aggregateTimeline, gapBuckets, robustYCap, timelinePeaks } from '../lib/chartAggregation';
import { DailySummaryMetrics } from '../components/DailySummaryMetrics';
import { DailyVerdict } from '../components/decision/DailyVerdict';
import { AutarkieBar } from '../components/decision/AutarkieBar';
import { EconomicHero } from '../components/decision/EconomicHero';
import { SolarBalanceBlock, HouseBalanceBlock } from '../components/decision/EnergyBalanceStory';
import { LivePvGauge } from '../components/decision/LivePvGauge';
import { LiveEnergyStrip } from '../components/decision/LiveEnergyStrip';
import { livePvState } from '../lib/decisionView';
import { greetingTitle } from '../lib/greeting';
import { DataCoverageStatus } from '../components/DataCoverageStatus';
import { RecordingHeartbeat } from '../components/energy/RecordingHeartbeat';
import { describeRecording } from '../lib/freshness';
import { evaluateCoverage } from '../lib/storytelling';
import { DEFAULT_RECORDING_CADENCE_SECONDS, formatTimelineTime, todayCoverageBoundaries } from '../lib/timelineIntegrity';

// Recharts 3 omits standard SVG fill props from this generic component's
// public TypeScript surface even though the runtime component supports them.
const GapReferenceArea = ReferenceArea as React.ComponentType<React.ComponentProps<'rect'> & {
  x1: number; x2: number; yAxisId?: 'left' | 'right'; ifOverflow?: 'hidden';
}>;

/** Peak marker: a small downward chevron whose tip sits on the exact time at the
 *  top of the plot. Uniform size, no circles, no full-height rule, no animation. */
function PeakChevron(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx, cy, fill } = props;
  if (cx == null || cy == null) return null;
  return (
    <path d={`M ${cx - 5} ${cy - 8} L ${cx + 5} ${cy - 8} L ${cx} ${cy - 1} Z`}
      fill={fill} className="drop-shadow-none" aria-hidden="true" />
  );
}

function isDemoSource(sourceType: string): boolean {
  return sourceType === 'demo';
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
  // Fixed 24-hour local axis: even 4-hour ticks (fewer on mobile), independent of
  // where samples or gaps fall, so the day always has a stable, readable shape.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;
  const dayTicks = [0, 4, 8, 12, 16, 20, 24].map(h => dayStartMs + h * 3600 * 1000);

  // Overview: 15-minute display aggregation of the raw samples (factual totals
  // are computed elsewhere and untouched). Empty buckets stay null — no
  // interpolation, no zero-fill, no line across real gaps.
  const buckets = useMemo(() => aggregateTimeline(timeline, dayStartMs, dayEndMs), [timeline, dayStartMs, dayEndMs]);
  const yCap = useMemo(() => robustYCap(buckets), [buckets]);
  const peaks = useMemo(() => timelinePeaks(buckets, yCap), [buckets, yCap]);
  const gapList = useMemo(() => gapBuckets(buckets), [buckets]);
  const chartGapCount = gapList.length;
  const maxPeak = peaks.reduce((m, p) => Math.max(m, p.valueKw), 0);
  const hasSolar = buckets.some(b => b.solarKw !== null);
  const hasHome = buckets.some(b => b.homeLoadKw !== null);
  const hasChartableSeries = hasSolar || hasHome;
  const renderedPointCount = buckets.filter(b => b.hasData).length;

  const formatAxisKw = (value: number) =>
    formatNumber(value, locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  // Decision-cockpit hero values (evidence stays below).
  const today: TodayData = todayData ?? fallbackToday;
  const assessment = today.assessment ?? null;
  const autarkiePct = today.selfSufficiency.state === 'available' ? today.selfSufficiency.value : null;
  const capacityKwp = settingsPayload?.effective_settings?.pv_installed_kwp ?? null;
  const pvPowerKw = snapshot?.solar?.origin === 'observed' ? snapshot.solar.valueKw : null;
  const pvGaugeState = livePvState(pvPowerKw, snapshot?.solar?.origin, snapshot?.quality, new Date());

  const recording = describeRecording(settingsPayload?.system, { locale });
  const coverageLabel = { complete: 'Vollständig', partial: 'Teilweise', sparse: 'Wenige Daten', unavailable: 'Nicht verfügbar' }[coverage.level];
  const weatherEnabled = Boolean(settingsPayload?.effective_settings?.weather_enabled);

  // Personal, quiet greeting by local time of day — a warm entry before the
  // factual verdict. Never a second h1, never a competing hero.
  const greetingEnabled = settingsPayload?.effective_settings?.greeting_enabled ?? true;
  const preferredName = settingsPayload?.effective_settings?.preferred_name ?? null;
  const greeting = greetingEnabled ? greetingTitle(new Date().getHours(), preferredName) : null;

  // Autonomy relation for the bar: self-consumed PV (covering the house) vs grid.
  const balSolar = today.solarTotal.state === 'available' ? today.solarTotal.value : null;
  const balExport = today.gridFeedInTotal.state === 'available' ? today.gridFeedInTotal.value : null;
  const autarkieSolarKwh = balSolar !== null && balExport !== null ? Math.max(0, balSolar - balExport) : null;
  const autarkieGridKwh = today.gridDrawTotal.state === 'available' ? today.gridDrawTotal.value : null;

  return (
    <div className="cockpit-page mx-auto flex h-full w-full max-w-7xl flex-col gap-6 overflow-y-auto" data-testid="today-workspace">
      {/* Unified surface: one compact live strip + the day's judgement. On
          desktop the live flow reads first; on mobile the verdict leads. */}
      <div className="flex flex-col gap-4">
        <div className="order-2 lg:order-1">
          <LiveEnergyStrip snapshot={snapshot} locale={locale} />
        </div>
        {/* Decision cockpit: verdict · autonomy · economic value · balance · weather.
            Content is width-capped so wide desktops stay a closed cockpit. */}
        <section aria-label="Tagesentscheidung" className="order-1 cockpit-surface p-5 lg:order-2 lg:p-6" data-testid="decision-cockpit">
          {greeting && (
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200" data-testid="greeting">
              {greeting}
            </p>
          )}
          <div className="mt-2">
            <DailyVerdict assessment={assessment} autarkiePct={autarkiePct} />
          </div>
          {/* One shared 12-column grid so every block sits on the same axes:
              Autarkie 1–6 · Wirtschaft 7–12; Solarenergie 1–3 · Haushalt 4–6 ·
              Wetter 7–12. No per-block margins or ad-hoc offsets — spacing is the
              grid gap only. */}
          <div className="mt-4 grid grid-cols-12 gap-x-6 gap-y-6">
            <div className="col-span-12 flex flex-col gap-3 lg:col-span-6">
              <AutarkieBar pct={autarkiePct} solarKwh={autarkieSolarKwh} gridKwh={autarkieGridKwh} locale={locale} />
              <LivePvGauge powerKw={pvPowerKw} capacityKwp={capacityKwp} state={pvGaugeState} locale={locale} />
            </div>
            <div className="col-span-12 lg:col-span-6">
              <EconomicHero report={today.economy} locale={locale} />
            </div>

            {/* Full-width divider between upper and lower zones. */}
            <div className="col-span-12 border-t border-slate-200/70 dark:border-slate-800" />

            <SolarBalanceBlock data={today} locale={locale} className="col-span-12 md:col-span-6 lg:col-span-3" />
            <HouseBalanceBlock data={today} locale={locale} className="col-span-12 md:col-span-6 lg:col-span-3" />
            {weatherEnabled && (
              <div className="col-span-12 lg:col-span-6">
                <CockpitWeather report={weatherReport} locale={locale} snapshot={snapshot} />
              </div>
            )}
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

      {/* 2 — 24-hour chronicle: PV as a calm area, consumption as a clear line. */}
      {!noData && (
        <section className="cockpit-surface space-y-3 p-5 lg:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <h2 className="cockpit-section-title">
              {isDemo ? '24-Stunden-Chronik (Demo)' : '24-Stunden-Chronik'}
            </h2>
            {/* Primary legend: only the two series. Data-quality lives in the footer. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded-full bg-amber-500" />Solarerzeugung</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded-full bg-indigo-500" />Hausverbrauch</span>
            </div>
          </div>

          {hasChartableSeries ? (
            <div className="h-[clamp(15rem,32vh,22rem)] w-full" role="img"
              aria-label={
                `24-Stunden-Chronik. ${hasSolar ? 'Solarerzeugung als Fläche' : 'Keine Solardaten'}, `
                + `${hasHome ? 'Hausverbrauch als Linie' : 'keine Verbrauchsdaten'}, in Kilowatt. `
                + `${chartGapCount} ${chartGapCount === 1 ? 'Zeitraum ohne Messwerte' : 'Zeiträume ohne Messwerte'}. `
                + (peaks.length > 0 ? `${peaks.length} kurze Verbrauchsspitzen über der Skala, Maximum ${formatAxisKw(maxPeak)} Kilowatt.` : 'Keine Spitzen über der Skala.')
              }>
              <p className="sr-only">Werte sind auf 15-Minuten-Mittel aggregiert. Fehlende Zeiträume bleiben als Lücken sichtbar und werden nicht durch eine Linie überbrückt. Die Y-Achse priorisiert den normalen Tagesverlauf; einzelne Spitzen über der Skala werden als Marker oben und unter dem Diagramm mit ihrem echten Maximalwert genannt.</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={buckets} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="solarGradT" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#D97706" stopOpacity={0.10} />
                      <stop offset="95%" stopColor="#D97706" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} vertical={false} />
                  <XAxis dataKey="timestampMs" type="number" scale="time" domain={[dayStartMs, dayEndMs]}
                    ticks={dayTicks} interval={0} className="font-data"
                    stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={value => formatTimelineTime(value, locale)} />
                  <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} unit="kW" className="font-data"
                    domain={[0, yCap]} allowDataOverflow width={52} tickFormatter={formatAxisKw} />
                  <Tooltip isAnimationActive={animate} content={<ChronikTooltip locale={locale} cap={yCap} />}
                    cursor={{ stroke: '#94A3B8', strokeWidth: 1 }} />
                  {/* Solar: the line carries the trace; the fill only hints at volume.
                      Consumption: clear line. Neither is drawn across a real gap. */}
                  {hasSolar && (
                    <Area type="linear" dataKey="solarKw" name="Solarerzeugung" stroke="#D97706" strokeWidth={2.25}
                      fill="url(#solarGradT)" fillOpacity={1} dot={false} connectNulls={false} isAnimationActive={animate} />
                  )}
                  {hasHome && (
                    <Line type="linear" dataKey="homeLoadKw" name="Hausverbrauch" stroke="#4F46E5" strokeWidth={2}
                      dot={false} connectNulls={false} isAnimationActive={animate} />
                  )}
                  {/* Gaps: a thin neutral rule at the very bottom — a quality hint, not a
                      second series and never PV-coloured. Fixed ~4px via a tiny data slice. */}
                  {gapList.map((g, i) => (
                    <GapReferenceArea key={`gap-${i}`} x1={g.startMs} x2={g.endMs} y1={0} y2={yCap * 0.02}
                      fill="#64748B" fillOpacity={0.35} stroke="none" ifOverflow="hidden" />
                  ))}
                  {/* Real interval maxima above the cap: a small chevron pointing down at
                      the exact time — "there was more here than the scale shows". */}
                  {peaks.map((p, i) => (
                    <ReferenceDot key={`peak-${i}`} x={p.timestampMs} y={yCap} ifOverflow="visible"
                      shape={PeakChevron} fill={p.series === 'home' ? '#4F46E5' : '#D97706'} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Für diesen Zeitraum liegen noch keine Messwerte vor.
            </p>
          )}

          {isDemo && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Alle Daten in dieser Ansicht sind simuliert und stammen aus dem aktiven Demo-Szenario.
            </p>
          )}

          {/* One compact status footer. Detailed reasons only in Technical Details. */}
          <div data-testid="chart-data-quality"
            className="border-t border-slate-200/70 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {/* One compact quality line: coverage · peaks · maximum. */}
            <p>
              {chartGapCount > 0
                ? `Messdaten für ${formatNumber(chartGapCount, locale)} ${chartGapCount === 1 ? 'Zeitraum' : 'Zeiträume'} unvollständig`
                : 'Messdaten für den dargestellten Zeitraum vollständig'}
              {peaks.length > 0 && (
                <span data-testid="chart-peak-note">
                  {' · '}{formatNumber(peaks.length, locale)} {peaks.length === 1 ? 'Verbrauchsspitze' : 'Verbrauchsspitzen'} über der sichtbaren Skala · Maximum <span className="font-data tabular-nums">{formatAxisKw(maxPeak)} kW</span>
                </span>
              )}
            </p>
            {/* Symbol help so gap and peak are named, not communicated by colour alone. */}
            {(chartGapCount > 0 || peaks.length > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
                {chartGapCount > 0 && (
                  <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 rounded-full bg-slate-400/70" />Datenlücke</span>
                )}
                {peaks.length > 0 && (
                  <span className="flex items-center gap-1.5" aria-hidden="true"><span className="text-slate-500">▼</span>Verbrauchsspitze</span>
                )}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
              {chartGapCount > 0 && (
                <details>
                  <summary className="cursor-pointer">Warum fehlen Daten?</summary>
                  <p className="mt-1">Für einzelne 15-Minuten-Abschnitte liegen keine Messwerte vor. Abdeckung, Quellen und Details stehen unten unter „Technische Details“.</p>
                </details>
              )}
              <details>
                <summary className="cursor-pointer">Messwerte als Tabelle anzeigen</summary>
                <div className="mt-2 max-h-64 overflow-y-auto">
                  <table className="w-full text-left">
                    <caption className="sr-only">15-Minuten-Mittelwerte für Solarerzeugung und Hausverbrauch</caption>
                    <thead>
                      <tr className="text-slate-400">
                        <th scope="col" className="pr-3 font-medium">Zeit</th>
                        <th scope="col" className="pr-3 font-medium">Solar</th>
                        <th scope="col" className="font-medium">Hausverbrauch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.filter(b => b.hasData).map(b => (
                        <tr key={b.startMs}>
                          <td className="font-data tabular-nums pr-3">{new Date(b.startMs).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="font-data tabular-nums pr-3">{b.solarKw !== null ? `${formatAxisKw(b.solarKw)} kW` : '—'}</td>
                          <td className="font-data tabular-nums">{b.homeLoadKw !== null ? `${formatAxisKw(b.homeLoadKw)} kW` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>
        </section>
      )}

      {/* Weather now lives inside the cockpit (balance | weather). No large
          separate weather section here. */}

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
            <p>Gespeicherte Messpunkte: <strong className="font-data text-slate-700 dark:text-slate-200">{formatNumber(timeline.length, locale)}</strong></p>
            <p className="mt-1">Dargestellte 15-Min-Intervalle: <strong className="font-data text-slate-700 dark:text-slate-200">{formatNumber(renderedPointCount, locale)}</strong></p>
          </div>
        </div>
      </details>
    </div>
  );
}
