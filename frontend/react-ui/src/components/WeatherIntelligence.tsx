import React from 'react';
import {
  Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun,
  Droplets, Moon, Sun, Sunrise, Sunset, Wind,
} from 'lucide-react';
import { NumberLocale, formatNumber, formatTemperature } from '../lib/format';
import { DailyWeatherData, EnergySnapshot, HourlyWeatherData, WeatherReportData } from '../types';
import { energyWeatherInsight } from '../lib/energyContext';

const CONDITION_LABELS: Record<string, string> = {
  clear: 'Klar',
  partly_cloudy: 'Teilweise bewölkt',
  cloudy: 'Bewölkt',
  rain: 'Regen',
  heavy_rain: 'Starker Regen',
  snow: 'Schnee',
  fog: 'Nebel',
  thunderstorm: 'Gewitter',
  unknown: 'Wetterlage unbekannt',
};

type WeatherIconComponent = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

function iconForCondition(condition?: string | null, isDay: boolean | null = null): WeatherIconComponent {
  if (condition === 'clear') {
    if (isDay === true) return Sun;
    if (isDay === false) return Moon;
    return Cloud;
  }
  if (condition === 'partly_cloudy') return CloudSun;
  if (condition === 'rain' || condition === 'heavy_rain') return CloudRain;
  if (condition === 'snow') return CloudSnow;
  if (condition === 'fog') return CloudFog;
  if (condition === 'thunderstorm') return CloudLightning;
  return Cloud;
}

function cleanDisplayText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned || /^(?:none|null|undefined|nan)$/i.test(cleaned)) return null;
  return cleaned;
}

function conditionLabel(condition?: unknown): string {
  const cleaned = cleanDisplayText(condition);
  if (!cleaned) return CONDITION_LABELS.unknown;
  return CONDITION_LABELS[cleaned] ?? cleaned.replaceAll('_', ' ');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasFreshWeather(report: WeatherReportData): boolean {
  return report.quality?.freshness === 'fresh';
}

function WeatherFreshnessNotice({ report }: { report: WeatherReportData }) {
  if (hasFreshWeather(report)) return null;
  return (
    <p role="status" className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-300">
      Wetterdaten sind derzeit nicht aktuell. Angezeigt werden die zuletzt verfügbaren Wetterdaten.
    </p>
  );
}

function safeDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localHourKey(date: Date, timezone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
  } catch {
    return date.toISOString().slice(0, 13);
  }
}

export function hourlyForecastState(time: string, now: Date, timezone?: string): 'expired' | 'current' | 'future' {
  const local = time.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/);
  const pointKey = local ? `${local[1]}T${local[2]}` : (() => {
    const parsed = safeDate(time);
    return parsed ? localHourKey(parsed, timezone) : '';
  })();
  if (!pointKey) return 'expired';
  const nowKey = localHourKey(now, timezone);
  if (pointKey < nowKey) return 'expired';
  return pointKey === nowKey ? 'current' : 'future';
}

function formatLocalTime(value: string, locale: NumberLocale, timezone?: string): string | null {
  // Open-Meteo returns local timestamps without an offset when `timezone` is
  // requested. Preserve that wall-clock time instead of parsing it in the
  // computer's timezone and shifting it a second time.
  const localTime = value.match(/T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (localTime) {
    const hour = Number(localTime[1]);
    const minute = Number(localTime[2]);
    if (hour <= 23 && minute <= 59) return `${localTime[1]}:${localTime[2]}`;
    return null;
  }
  const parsed = safeDate(value);
  if (!parsed) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(parsed);
  }
}

function formatForecastDay(value: string, locale: NumberLocale): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(parsed);
}

function SunEvent({ report, locale }: { report: WeatherReportData; locale: NumberLocale }) {
  const timezone = report.location?.timezone;
  const events = [
    { timestamp: report.sun?.sunrise, label: 'Sonnenaufgang', Icon: Sunrise },
    { timestamp: report.sun?.sunset, label: 'Sonnenuntergang', Icon: Sunset },
  ]
    .filter((event): event is { timestamp: string; label: string; Icon: WeatherIconComponent } => (
      typeof event.timestamp === 'string'
      && formatLocalTime(event.timestamp, locale, timezone) !== null
    ));
  if (!events.length) return null;
  return (
    <>
      {events.map(event => {
        const value = formatLocalTime(event.timestamp, locale, timezone);
        const EventIcon = event.Icon;
        return value ? (
          <div key={event.label} className="flex min-w-0 items-center gap-2">
            <EventIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
            <span>{event.label}: {value}</span>
          </div>
        ) : null;
      })}
    </>
  );
}

function ForecastItem({
  point, locale, timezone, current = false,
}: {
  point: HourlyWeatherData; locale: NumberLocale; timezone?: string; current?: boolean;
}) {
  const time = formatLocalTime(point.time, locale, timezone);
  const temperature = formatTemperature(point.temperature_c, locale);
  if (!time || !temperature) return null;
  const Icon = iconForCondition(point.condition);
  const probability = point.precipitation_probability_percent;

  return (
    <li className="min-w-0 rounded-xl border border-sky-200/70 bg-white/55 px-3 py-2.5 text-center dark:border-sky-900/70 dark:bg-slate-950/25">
      <time className="block text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">{current ? 'Jetzt' : time}</time>
      <Icon className="mx-auto my-2 h-5 w-5 text-sky-700 dark:text-sky-300" aria-hidden />
      <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{temperature}</span>
      {probability !== null && probability !== undefined && (
        <span className="mt-1 flex items-center justify-center gap-1 text-xs tabular-nums text-sky-700 dark:text-sky-300">
          <Droplets className="h-3 w-3" aria-hidden />
          {formatNumber(probability, locale, { maximumFractionDigits: 0 })} %
        </span>
      )}
    </li>
  );
}

export function CompactHourlyForecast({ report, locale, now: fixedNow }: { report: WeatherReportData | null; locale: NumberLocale; now?: Date }) {
  const [expanded, setExpanded] = React.useState(false);
  const [clock, setClock] = React.useState(() => fixedNow ?? new Date());
  React.useEffect(() => {
    if (fixedNow) {
      setClock(fixedNow);
      return undefined;
    }
    const current = new Date();
    const nextHour = new Date(current);
    nextHour.setMinutes(60, 0, 0);
    const timer = window.setTimeout(() => setClock(new Date()), Math.max(1, nextHour.getTime() - current.getTime()));
    return () => window.clearTimeout(timer);
  }, [fixedNow, clock]);
  if (!report || report.status !== 'available') return null;
  const forecast = (report.hourly ?? []).filter(point => (
    typeof point?.time === 'string'
    && hourlyForecastState(point.time, clock, report.location?.timezone) !== 'expired'
    && formatLocalTime(point.time, locale, report.location?.timezone) !== null
    && isFiniteNumber(point.temperature_c)
  )).slice(0, 24);
  if (!forecast.length) return null;
  const visible = expanded ? forecast : forecast.slice(0, 6);
  return (
    <section aria-label="Stündliche Wettervorhersage" className="cockpit-surface-muted px-5 py-4 sm:px-6">
      <p className="cockpit-eyebrow">Wetter heute</p>
      <h2 className="cockpit-section-title mt-1">
        {hasFreshWeather(report) ? 'Stündliche Vorhersage' : 'Stündliche Vorhersage · zuletzt verfügbar'}
      </h2>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-2">
        {visible.map(point => (
          <React.Fragment key={point.time}>
            <ForecastItem point={point} locale={locale} timezone={report.location?.timezone}
              current={hourlyForecastState(point.time, clock, report.location?.timezone) === 'current'} />
          </React.Fragment>
        ))}
      </ul>
      {forecast.length > 6 && (
        <button type="button" className="mt-3 text-sm font-medium text-sky-700 hover:underline dark:text-sky-300"
          aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? 'Weniger Stunden anzeigen' : `${forecast.length - 6} weitere Stunden anzeigen`}
        </button>
      )}
    </section>
  );
}

export const HourlyWeatherForecast = CompactHourlyForecast;

function DailyForecastItem({ point, locale }: { point: DailyWeatherData; locale: NumberLocale }) {
  const day = formatForecastDay(point.date, locale);
  if (!day) return null;
  const Icon = iconForCondition(point.condition);
  return (
    <li className="rounded-xl border border-slate-200/80 bg-white/55 px-3 py-3 dark:border-slate-700/70 dark:bg-slate-950/25">
      <time dateTime={point.date} className="text-xs font-semibold text-slate-700 dark:text-slate-200">{day}</time>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Icon className="h-5 w-5 text-sky-700 dark:text-sky-300" aria-hidden />
        <span className="text-sm tabular-nums text-slate-800 dark:text-slate-100">
          {formatTemperature(point.temperature_min_c, locale) ?? '—'} / {formatTemperature(point.temperature_max_c, locale) ?? '—'}
        </span>
      </div>
      {isFiniteNumber(point.precipitation_probability_percent) && (
        <span className="mt-2 flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300">
          <Droplets className="h-3 w-3" aria-hidden />
          {formatNumber(point.precipitation_probability_percent, locale, { maximumFractionDigits: 0 })} %
        </span>
      )}
    </li>
  );
}

export function MultiDayWeatherForecast({ report, locale }: { report: WeatherReportData | null; locale: NumberLocale }) {
  if (!report || report.status !== 'available') return null;
  const forecast = (report.daily ?? []).filter(point => formatForecastDay(point.date, locale)).slice(0, 7);
  if (!forecast.length) return null;
  return (
    <details className="cockpit-surface-muted px-5 py-4 sm:px-6">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700 marker:text-sky-600 dark:text-slate-200 dark:marker:text-sky-300">
        {hasFreshWeather(report) ? '5–7-Tage-Ausblick' : '5–7-Tage-Ausblick · zuletzt verfügbar'}
      </summary>
      <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-2">
        {forecast.map(point => (
          <React.Fragment key={point.date}>
            <DailyForecastItem point={point} locale={locale} />
          </React.Fragment>
        ))}
      </ul>
    </details>
  );
}

export function WeatherIntelligence({
  report, locale, compact = false, snapshot, now = new Date(),
}: {
  report: WeatherReportData | null; locale: NumberLocale; compact?: boolean;
  snapshot?: EnergySnapshot | null; now?: Date;
}) {
  if (!report || report.status !== 'available' || !report.current) {
    return (
      <section aria-label="Wetter und Solarbedingungen" className="cockpit-surface-muted px-5 py-4">
        <h2 className="cockpit-section-title">Energie-Kontext</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Wetterdaten aktuell nicht verfügbar</p>
      </section>
    );
  }

  const { current } = report;
  const freshWeather = hasFreshWeather(report);
  const CurrentIcon = iconForCondition(current.condition, current.is_day);
  const temperature = formatTemperature(current.temperature_c, locale);
  const context = freshWeather && snapshot ? energyWeatherInsight({ now, sun: report.sun, current, snapshot }) : null;
  const location = cleanDisplayText(report.location?.display_name);

  return (
    <section aria-label="Wetter und Solarbedingungen" className="cockpit-surface-muted overflow-hidden">
      <div className="px-5 py-5 sm:px-6">
        <p className="cockpit-eyebrow">Energie-Kontext</p>
        <WeatherFreshnessNotice report={report} />
        {location && <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300" title={location}>{location}</p>}
        <div className="mt-3 flex min-w-0 items-center gap-4">
          <CurrentIcon className="h-12 w-12 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
          <div className="min-w-0">
            {temperature
              ? <p className="text-4xl font-semibold tracking-tight tabular-nums text-slate-950 dark:text-white">{temperature}</p>
              : <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">Temperatur nicht verfügbar</p>}
            <p className="mt-0.5 break-words text-sm font-medium text-slate-700 dark:text-slate-200">{conditionLabel(current.condition)}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
          {isFiniteNumber(current.feels_like_c)
            && <span>Gefühlt {formatTemperature(current.feels_like_c, locale)}</span>}
          {isFiniteNumber(current.wind_speed_kmh) && (
            <span className="flex items-center gap-1.5"><Wind className="h-4 w-4" aria-hidden />{formatNumber(current.wind_speed_kmh, locale, { maximumFractionDigits: 1 })} km/h</span>
          )}
          {isFiniteNumber(current.precipitation_probability_percent) && (
            <span className="flex items-center gap-1.5"><Droplets className="h-4 w-4" aria-hidden />{formatNumber(current.precipitation_probability_percent, locale, { maximumFractionDigits: 0 })} %</span>
          )}
          <SunEvent report={report} locale={locale} />
        </div>
        {context && <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{context}</p>}
      </div>

      {!compact && <div className="border-t border-sky-200/70 dark:border-sky-900/70"><CompactHourlyForecast report={report} locale={locale} /></div>}
    </section>
  );
}
