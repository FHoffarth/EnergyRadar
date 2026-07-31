import { EnergySnapshot } from '../types';

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

export function greetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}
export function greetingTitle(hour: number, preferredName?: string | null): string {
  const salutation = {
    morning: 'Guten Morgen',
    afternoon: 'Guten Tag',
    evening: 'Guten Abend',
  }[greetingPeriod(hour)];
  const name = preferredName?.trim();
  return name ? `${salutation}, ${name}.` : `${salutation}.`;
}

function formatPower(kw: number, locale: string): string {
  const absoluteKw = Math.abs(kw);
  if (absoluteKw < 1) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(absoluteKw * 1000)} W`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(absoluteKw)} kW`;
}

export function trustworthyEnergySummary(
  snapshot: EnergySnapshot,
  locale = 'de-DE',
): string {
  if (snapshot.quality !== 'live') {
    return 'Ein Teil deiner Live-Energiedaten ist derzeit nicht verfügbar.';
  }

  if (snapshot.grid.origin === 'observed' && snapshot.grid.valueKw !== null) {
    const grid = snapshot.grid.valueKw;
    if (grid < 0) {
      return `Dein Zuhause speist gerade ${formatPower(grid, locale)} ins Netz ein.`;
    }
    if (grid > 0) {
      return `Dein Zuhause bezieht gerade ${formatPower(grid, locale)} aus dem Netz.`;
    }
    return 'Dein Zuhause tauscht gerade keine Energie mit dem Netz aus.';
  }

  if (snapshot.solar.origin === 'observed' && snapshot.solar.valueKw !== null) {
    return `Deine Solaranlage erzeugt gerade ${formatPower(snapshot.solar.valueKw, locale)}.`;
  }

  return 'Ein Teil deiner Live-Energiedaten ist derzeit nicht verfügbar.';
}
