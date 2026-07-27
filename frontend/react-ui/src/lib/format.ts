/**
 * Numeric presentation helpers.
 *
 * Every visible number goes through this module so the `number_format`
 * setting actually changes what the user sees. Callers pass the locale
 * explicitly (see `useNumberLocale`) rather than reading a module-level
 * value, so a settings change re-renders with the new format immediately.
 */

export type NumberLocale = 'de-DE' | 'en-US';

export const DEFAULT_NUMBER_LOCALE: NumberLocale = 'de-DE';

/** Placeholder for a value that is genuinely unknown — never a zero. */
export const UNKNOWN_VALUE = '—';

export function formatNumber(
  value: number | null | undefined,
  locale: NumberLocale = DEFAULT_NUMBER_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN_VALUE;
  return value.toLocaleString(locale, options);
}

/** Format a kW value with one decimal place. Returns the unknown marker for null. */
export function formatKw(
  kw: number | null | undefined,
  locale: NumberLocale = DEFAULT_NUMBER_LOCALE,
): string {
  return formatNumber(kw, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Format a watt reading as kW. Returns the unknown marker for null. */
export function formatPower(
  watts: number | null | undefined,
  locale: NumberLocale = DEFAULT_NUMBER_LOCALE,
): string {
  if (watts === null || watts === undefined || Number.isNaN(watts)) return UNKNOWN_VALUE;
  return `${formatKw(watts / 1000, locale)} kW`;
}

export function formatEnergy(
  kwh: number | null | undefined,
  locale: NumberLocale = DEFAULT_NUMBER_LOCALE,
): string {
  if (kwh === null || kwh === undefined || Number.isNaN(kwh)) return UNKNOWN_VALUE;
  return `${formatKw(kwh, locale)} kWh`;
}

export function formatTemperature(
  celsius: number | null | undefined,
  locale: NumberLocale = DEFAULT_NUMBER_LOCALE,
): string | null {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return null;
  return `${formatNumber(celsius, locale, { maximumFractionDigits: 1 })} °C`;
}

export function getStatusText(lastUpdated: string | null): string {
  if (!lastUpdated) return 'Keine Daten';
  return 'Live';
}
