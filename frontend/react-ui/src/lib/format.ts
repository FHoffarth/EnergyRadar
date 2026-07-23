export function formatPower(watts: number | null): string {
  if (watts === null) return '–';
  const kw = Math.abs(watts) / 1000;
  return `${kw.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;
}

export function formatEnergy(kwh: number | null): string {
  if (kwh === null) return '–';
  return `${kwh.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
}

export function getStatusText(lastUpdated: string | null): string {
  if (!lastUpdated) return 'Keine Daten';
  return 'Live';
}
