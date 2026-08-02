/**
 * Freshness and recording language.
 *
 * The Design Constitution requires freshness to reach the user as a *feeling*
 * (live / recent / stale / stopped), never as a raw timestamp, and the
 * recording heartbeat to whisper when healthy and become loud when it breaks.
 *
 * These helpers are pure and derive only from state the backend already owns
 * (`SystemInfo`). They never invent a freshness policy — the backend decides
 * whether recording is active; the frontend only phrases it.
 */
import { SystemInfo } from '../types';
import { NumberLocale } from './format';

export type RecordingState = 'recording' | 'stale' | 'stopped' | 'no_data' | 'unknown';

export interface RecordingDescriptor {
  state: RecordingState;
  /** Short human label, e.g. "Aufzeichnung läuft". */
  label: string;
  /** Secondary human phrase, e.g. "seit 08:14 Uhr". Never a raw ISO string. */
  detail: string | null;
  /** Healthy → whisper (quiet). Unhealthy → loud (prominent). */
  healthy: boolean;
}

/** Local wall-clock HH:MM for a stored instant. Diagnostics/derived phrasing only. */
export function localClock(iso: string | null | undefined, locale: NumberLocale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** Human "time ago" in German. Returns null for an unparseable instant. */
export function humanAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  const hours = Math.round(minutes / 60);
  return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
}

/**
 * Phrase the recording heartbeat from authoritative system state. Returns null
 * when no system information is available, so callers can simply omit the
 * heartbeat rather than render a fake one.
 */
export function describeRecording(
  system: SystemInfo | null | undefined,
  opts: { locale: NumberLocale; now?: Date },
): RecordingDescriptor | null {
  if (!system) return null;
  const now = opts.now ?? new Date();
  const interval = system.recording_interval_seconds > 0 ? system.recording_interval_seconds : 60;
  const lastAt = system.last_recorded_sample_at ?? null;
  const lastAgeSeconds = lastAt ? Math.max(0, (now.getTime() - new Date(lastAt).getTime()) / 1000) : null;
  const sinceClock = localClock(system.recording_since, opts.locale);

  if (!system.recording_active) {
    return {
      state: 'stopped',
      label: 'Aufzeichnung unterbrochen',
      detail: lastAt ? `Letzte Messung ${humanAgo(lastAt, now)}` : 'Keine aktive Aufzeichnung',
      healthy: false,
    };
  }

  // Recording is active but has produced nothing yet — an honest not-yet.
  if (!lastAt || system.stored_samples === 0) {
    return {
      state: 'no_data',
      label: 'Aufzeichnung gestartet',
      detail: sinceClock ? `seit ${sinceClock} Uhr · noch keine Messung` : 'Noch keine Messung erfasst',
      healthy: true,
    };
  }

  // Active, but the last sample is well past the expected cadence: say so plainly.
  if (lastAgeSeconds !== null && lastAgeSeconds > interval * 3) {
    return {
      state: 'stale',
      label: 'Aufzeichnung aktiv',
      detail: `Letzte Messung ${humanAgo(lastAt, now)}`,
      healthy: false,
    };
  }

  return {
    state: 'recording',
    label: 'Aufzeichnung läuft',
    detail: sinceClock ? `seit ${sinceClock} Uhr` : null,
    healthy: true,
  };
}
