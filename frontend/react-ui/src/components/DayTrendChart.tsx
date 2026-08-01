import React from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TimelineEntry } from '../types';
import { NumberLocale } from '../lib/format';
import { dedupeTickFormatter } from '../lib/chartAxis';
import { EnergyChartTooltip } from './EnergyChartTooltip';

interface DayTrendChartProps {
  timeline: TimelineEntry[];
  locale: NumberLocale;
  /** Disable chart animation when the operating system requests reduced motion. */
  animate: boolean;
  /** Presentation size only; the measured series and evidence rules stay identical. */
  size?: 'compact' | 'workspace';
}

/** A series needs at least this many measured points before it is drawn. */
export const MIN_TREND_POINTS = 3;

/** Points that carry an actual measurement. Nulls stay null — never zero. */
export function measuredPoints(timeline: TimelineEntry[]): TimelineEntry[] {
  return timeline.filter(point => point.solarKw !== null && !Number.isNaN(point.solarKw));
}

export function hasEnoughEvidence(timeline: TimelineEntry[]): boolean {
  return measuredPoints(timeline).length >= MIN_TREND_POINTS;
}

/**
 * Restrained single-series day trend for the Now workspace.
 *
 * Only the measured PV series is drawn. Consumption, grid and storage are
 * deliberately absent here — the Now view must not imply data the meter
 * has not delivered.
 */
export function DayTrendChart({ timeline, locale, animate, size = 'compact' }: DayTrendChartProps) {
  const points = measuredPoints(timeline);
  const formatTick = dedupeTickFormatter(points, 'time');

  return (
    <div className={`${size === 'workspace' ? 'h-[clamp(17rem,34vh,24rem)]' : 'h-24'} w-full`} aria-label="Gemessener PV-Tagesverlauf">
      <ResponsiveContainer width="100%" height="100%">
        {/* Right margin leaves room for the final time tick's caption. */}
        <AreaChart data={points} margin={{ top: 4, right: 18, left: 0, bottom: -4 }}>
          <defs>
            <linearGradient id="nowSolarTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D97706" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            stroke="currentColor"
            className="text-slate-400 dark:text-slate-600"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickFormatter={formatTick}
          />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            cursor={{ stroke: '#94A3B8', strokeWidth: 1 }}
            isAnimationActive={animate}
            content={<EnergyChartTooltip locale={locale} />}
            contentStyle={{
              borderRadius: '0.625rem',
              border: '1px solid rgba(148,163,184,0.35)',
              fontSize: '12px',
              padding: '4px 8px',
            }}
          />
          <Area
            type="monotone"
            dataKey="solarKw"
            name="PV"
            stroke="#D97706"
            strokeWidth={1.75}
            fill="url(#nowSolarTrend)"
            dot={false}
            activeDot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={animate}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
