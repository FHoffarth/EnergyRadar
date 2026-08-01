import React from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TimelineEntry } from '../types';
import { NumberLocale, formatNumber } from '../lib/format';
import { EnergyChartTooltip } from './EnergyChartTooltip';
import { formatTimelineTime, hasFiniteTimelineValue, withVisibleTimelineGaps } from '../lib/timelineIntegrity';

export function HistoryOverviewChart({ timeline, locale, animate, expectedCadenceSeconds }: {
  timeline: TimelineEntry[]; locale: NumberLocale; animate: boolean; expectedCadenceSeconds: number;
}) {
  const measured = timeline.filter(hasFiniteTimelineValue);
  if (!measured.length) return <p className="text-sm text-slate-500">Für den geladenen Verlauf liegen keine Messwerte vor.</p>;
  const chartTimeline = withVisibleTimelineGaps(timeline, expectedCadenceSeconds);
  const gapCount = chartTimeline.filter(point => point.isGapMarker).length;
  const sparseDots = measured.length <= 3 ? { r: 2, strokeWidth: 0 } : false;
  return (
    <div>
      <div aria-label="Diagrammlegende" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-600" />Solar</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-indigo-600" />Verbrauch</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-orange-600" />Netz (+ Bezug / − Einspeisung)</span>
      </div>
      <div className="h-72 w-full" role="img"
        aria-label={`Gespeicherter Energieverlauf mit ${gapCount} sichtbaren ${gapCount === 1 ? 'Datenlücke' : 'Datenlücken'}. Netzbezug liegt über, Einspeisung unter null.`}>
        <p className="sr-only">Fehlende Messperioden werden nicht verbunden. Gültige Nullwerte bleiben sichtbar.</p>
        <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartTimeline} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.22} vertical={false} />
          <XAxis dataKey="timestampMs" type="number" scale="time" domain={['dataMin', 'dataMax']}
            stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} minTickGap={48}
            tickFormatter={value => formatTimelineTime(value, locale)} />
          <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} unit="kW"
            domain={[(minimum: number) => Math.min(0, minimum), (maximum: number) => Math.max(0, maximum)]}
            tickFormatter={(value: number) => formatNumber(value, locale, { maximumFractionDigits: 1 })} />
          <Tooltip content={<EnergyChartTooltip locale={locale} />} isAnimationActive={animate} />
          <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" />
          <Line type="linear" dataKey="solarKw" name="Solar" stroke="#D97706" strokeWidth={2} dot={sparseDots} connectNulls={false} isAnimationActive={animate} />
          <Line type="linear" dataKey="homeLoadKw" name="Verbrauch" stroke="#4F46E5" strokeWidth={2} dot={sparseDots} connectNulls={false} isAnimationActive={animate} />
          <Line type="linear" dataKey="gridKw" name="Netz" stroke="#EA580C" strokeWidth={1.75} dot={sparseDots} connectNulls={false} isAnimationActive={animate} />
        </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
