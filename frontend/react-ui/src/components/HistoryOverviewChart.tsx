import React from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TimelineEntry } from '../types';
import { NumberLocale, formatNumber } from '../lib/format';
import { EnergyChartTooltip } from './EnergyChartTooltip';

export function HistoryOverviewChart({ timeline, locale, animate }: {
  timeline: TimelineEntry[]; locale: NumberLocale; animate: boolean;
}) {
  const measured = timeline.filter(point => [point.solarKw, point.homeLoadKw, point.gridKw].some(value => value !== null));
  if (!measured.length) return <p className="text-sm text-slate-500">Für den geladenen Verlauf liegen keine Messwerte vor.</p>;
  return (
    <div className="h-72 w-full" aria-label="Gespeicherter Energieverlauf; Lücken werden nicht verbunden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.22} vertical={false} />
          <XAxis dataKey="time" stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} unit="kW"
            tickFormatter={(value: number) => formatNumber(value, locale, { maximumFractionDigits: 1 })} />
          <Tooltip content={<EnergyChartTooltip locale={locale} />} isAnimationActive={animate} />
          <Line type="linear" dataKey="solarKw" name="Solar" stroke="#D97706" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={animate} />
          <Line type="linear" dataKey="homeLoadKw" name="Verbrauch" stroke="#4F46E5" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={animate} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
