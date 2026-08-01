import { DemoDeviceSummary } from '../types';

export function deviceStatusPresentation(status: DemoDeviceSummary['status']) {
  if (status === 'active') {
    return { label: 'Online', action: 'Jetzt prüfen', online: true, tone: 'success' as const };
  }
  if (status === 'partial') {
    return { label: 'Teilweise verfügbar', action: 'Jetzt prüfen', online: false, tone: 'warning' as const };
  }
  if (status === 'last_known') {
    return { label: 'Veraltet', action: 'Erneut prüfen', online: false, tone: 'warning' as const };
  }
  if (status === 'unconfigured') {
    return { label: 'Nicht eingerichtet', action: 'Einrichten', online: false, tone: 'neutral' as const };
  }
  if (status === 'idle') {
    return { label: 'Noch nicht geprüft', action: 'Verbindung prüfen', online: false, tone: 'neutral' as const };
  }
  return { label: 'Offline', action: 'Erneut prüfen', online: false, tone: 'error' as const };
}

export function relativeResponseTime(
  value: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!value || value === 'Unbekannt' || value === 'Demo-Szenario') return null;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h`;
}
