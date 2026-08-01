import { CurrentWeatherData, DemoDeviceSummary, EnergySnapshot, SunData, TimelineEntry } from '../types';

export type EnergyTrend = 'steigt' | 'fällt' | 'stabil' | null;

function observed(value: { valueKw: number | null; origin: string }): value is { valueKw: number; origin: string } {
  return value.origin === 'observed' && value.valueKw !== null && Number.isFinite(value.valueKw);
}

function formatPower(kw: number, locale: string): string {
  const absolute = Math.abs(kw);
  if (absolute < 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(absolute * 1000)} W`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(absolute)} kW`;
}

export function currentEnergyVerdict(
  snapshot: EnergySnapshot,
  devices: DemoDeviceSummary[] = [],
  locale = 'de-DE',
): string {
  const sourceUnavailable = devices.some(device => ['partial', 'offline', 'unknown', 'last_known'].includes(device.status));
  if (snapshot.quality !== 'live' || sourceUnavailable) return 'Ein Teil deiner Energiedaten ist derzeit nicht verfügbar.';
  if (!observed(snapshot.grid)) return 'Ein Teil deiner Energiedaten ist derzeit nicht verfügbar.';
  if (snapshot.grid.valueKw > 0) return `Dein Zuhause bezieht aktuell ${formatPower(snapshot.grid.valueKw, locale)} aus dem Netz.`;
  if (snapshot.grid.valueKw < 0) return `Du speist aktuell ${formatPower(snapshot.grid.valueKw, locale)} ins Netz ein.`;
  if (observed(snapshot.solar) && observed(snapshot.homeLoad) && snapshot.solar.valueKw >= snapshot.homeLoad.valueKw) {
    return 'Dein Zuhause wird aktuell vollständig von der Solaranlage versorgt.';
  }
  return 'Dein Zuhause tauscht aktuell keine Energie mit dem Netz aus.';
}

export function recentSolarTrend(timeline: TimelineEntry[]): EnergyTrend {
  const points = timeline.filter(point => point.origin === 'observed' && point.solarKw !== null && Number.isFinite(point.solarKw));
  if (points.length < 3) return null;
  const window = points.slice(-3);
  const first = window[0].solarKw as number;
  const last = window[window.length - 1].solarKw as number;
  const threshold = Math.max(0.05, Math.abs(first) * 0.05);
  if (last - first > threshold) return 'steigt';
  if (first - last > threshold) return 'fällt';
  return 'stabil';
}

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function energyWeatherInsight(input: {
  now: Date;
  sun?: SunData | null;
  current?: CurrentWeatherData | null;
  snapshot: EnergySnapshot;
}): string {
  const now = input.now.getTime();
  const sunrise = parseTimestamp(input.sun?.sunrise);
  const sunset = parseTimestamp(input.sun?.sunset);
  const afterSunset = sunset !== null && now >= sunset;
  const beforeSunrise = sunrise !== null && sunset !== null && sunrise < sunset && now < sunrise;
  if (afterSunset || beforeSunrise) return 'Die Solarerzeugung ist für heute beendet.';

  if (input.snapshot.quality !== 'live' || !observed(input.snapshot.solar)) {
    return 'Aktuelle PV-Daten sind derzeit nicht verfügbar.';
  }

  const cloud = input.current?.cloud_cover_percent;
  if (typeof cloud === 'number' && Number.isFinite(cloud)) {
    if (cloud >= 65) return 'Bewölkung und aktuelle Messwerte sprechen derzeit für begrenzte Solarbedingungen.';
    if (cloud <= 25) return 'Die aktuellen Bedingungen für Solarstrom sind günstig.';
  }
  if ((input.current?.precipitation_mm ?? 0) > 0) return 'Niederschlag kann die Solarbedingungen derzeit begrenzen.';
  return input.snapshot.solar.valueKw === 0
    ? 'Die Solaranlage liefert aktuell gültige 0 W.'
    : 'Die aktuelle Solarleistung wird zuverlässig gemessen.';
}

export interface EnergyTooltipRow { label: string; value: string }

export function energyTooltipRows(point: Partial<TimelineEntry>, locale = 'de-DE'): EnergyTooltipRow[] {
  const rows: EnergyTooltipRow[] = [];
  if (typeof point.solarKw === 'number' && Number.isFinite(point.solarKw)) rows.push({ label: 'Solar', value: formatPower(point.solarKw, locale) });
  if (typeof point.homeLoadKw === 'number' && Number.isFinite(point.homeLoadKw)) rows.push({ label: 'Haus', value: formatPower(point.homeLoadKw, locale) });
  if (typeof point.gridKw === 'number' && Number.isFinite(point.gridKw)) {
    const meaning = point.gridKw > 0 ? 'Bezug' : point.gridKw < 0 ? 'Einspeisung' : 'Kein Austausch';
    rows.push({ label: 'Netz', value: `${formatPower(point.gridKw, locale)} ${meaning}` });
  }
  return rows;
}
