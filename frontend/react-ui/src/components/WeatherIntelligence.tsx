import React from 'react';
import {
  Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun,
  Droplets, Moon, Sun, Sunrise, Sunset, Wind,
} from 'lucide-react';
import { NumberLocale, formatNumber, formatTemperature } from '../lib/format';
import { HourlyWeatherData, WeatherReportData } from '../types';

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

function safeDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function solarContext(report: WeatherReportData): string | null {
  const current = report.current;
  if (!current || current.is_day !== true || !isFiniteNumber(current.cloud_cover_percent)) return null;
  if (current.cloud_cover_percent >= 75) {
    return 'Begrenzte Solarerzeugung aufgrund dichter Bewölkung zu erwarten.';
  }
  if (current.cloud_cover_percent >= 45) {
    return 'Die PV-Leistung dürfte mit zunehmender Bewölkung sinken.';
  }
  if (current.cloud_cover_percent <= 25) {
    return 'Gute Solarbedingungen für die nächste Stunde.';
  }
  return null;
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
    ))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const event = events[0];
  if (!event) return null;
  const value = formatLocalTime(event.timestamp, locale, timezone);
  if (!value) return null;
  const EventIcon = event.Icon;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <EventIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
      <span><span className="sr-only">{event.label}: </span>{value}</span>
    </div>
  );
}

function ForecastItem({
  point, locale, timezone,
}: {
  point: HourlyWeatherData; locale: NumberLocale; timezone?: string;
}) {
  const time = formatLocalTime(point.time, locale, timezone);
  const temperature = formatTemperature(point.temperature_c, locale);
  if (!time || !temperature) return null;
  const Icon = iconForCondition(point.condition);
  const probability = point.precipitation_probability_percent;

  return (
    <li className="min-w-0 rounded-xl border border-sky-200/70 bg-white/55 px-3 py-2.5 text-center dark:border-sky-900/70 dark:bg-slate-950/25">
      <time className="block text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">{time}</time>
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

export function WeatherIntelligence({
  report, locale, compact = false,
}: {
  report: WeatherReportData | null; locale: NumberLocale; compact?: boolean;
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
  const CurrentIcon = iconForCondition(current.condition, current.is_day);
  const temperature = formatTemperature(current.temperature_c, locale);
  const context = solarContext(report);
  const location = cleanDisplayText(report.location?.display_name);
  const forecast = (report.hourly ?? [])
    .filter(point => (
      typeof point?.time === 'string'
      && formatLocalTime(point.time, locale, report.location?.timezone) !== null
      && isFiniteNumber(point.temperature_c)
    ))
    .slice(0, 6);

  return (
    <section aria-label="Wetter und Solarbedingungen" className="cockpit-surface-muted overflow-hidden">
      <div className="px-5 py-5 sm:px-6">
        <p className="cockpit-eyebrow">Energie-Kontext</p>
        {location && <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300" title={location}>{location}</p>}
        <div className="mt-3 flex min-w-0 items-center gap-4">
          <CurrentIcon className="h-12 w-12 shrink-0 text-teal-700 dark:text-teal-300" aria-hidden />
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

      {!compact && forecast.length > 0 && (
        <div className="border-t border-sky-200/70 px-5 py-4 dark:border-sky-900/70 sm:px-6">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Nächste Stunden</h3>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-2">
            {forecast.map(point => (
              <React.Fragment key={point.time}>
                <ForecastItem point={point} locale={locale} timezone={report.location?.timezone} />
              </React.Fragment>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
