import { describe, it, expect } from 'vitest';
import { describeRecording } from '../lib/freshness';
import { SystemInfo } from '../types';

const locale = 'de-DE' as const;

function system(partial: Partial<SystemInfo>): SystemInfo {
  return {
    app_version: '1.0.0',
    build: 'test',
    database_schema_version: 5,
    recording_interval_seconds: 60,
    database_path: '/tmp/energy.db',
    log_path: '/tmp/energyradar.log',
    export_directory: '/tmp',
    database_healthy: true,
    recording_active: true,
    recording_since: null,
    current_session_since: null,
    stored_samples: 0,
    database_size_bytes: 0,
    last_recorded_sample_at: null,
    ...partial,
  };
}

describe('describeRecording — live vs persisted freshness', () => {
  it('does NOT report stale when a fresh session sits over a stale previous sample', () => {
    // Reproduces the P0: recorder just started (1 min ago), newest persisted
    // sample is from the previous run 2 hours ago, live feed is fresh.
    const now = new Date('2026-08-03T16:51:00Z');
    const info = system({
      recording_active: true,
      stored_samples: 140,
      recording_since: '2026-07-22T21:10:17Z', // earliest history
      current_session_since: '2026-08-03T16:50:00Z', // this run started 1 min ago
      last_recorded_sample_at: '2026-08-03T14:50:00Z', // 2h old, previous run
    });

    const d = describeRecording(info, { locale, now })!;

    expect(d.state).toBe('no_data');
    expect(d.healthy).toBe(true);
    // Must never phrase the live feed as a 2-hour-stale measurement.
    expect(d.detail ?? '').not.toMatch(/vor 2 Stunden/);
    expect(d.detail ?? '').toMatch(/erste Speicherung läuft/);
    expect(d.label).toBe('Aufzeichnung läuft');
  });

  it('reports genuinely stale only when a this-session sample fell behind cadence', () => {
    const now = new Date('2026-08-03T16:51:00Z');
    const info = system({
      recording_active: true,
      stored_samples: 200,
      recording_since: '2026-07-22T21:10:17Z',
      current_session_since: '2026-08-03T10:00:00Z', // session started hours ago
      last_recorded_sample_at: '2026-08-03T16:45:00Z', // 6 min old, this session, > 3×60s
    });

    const d = describeRecording(info, { locale, now })!;

    expect(d.state).toBe('stale');
    expect(d.healthy).toBe(false);
    expect(d.detail ?? '').toMatch(/Zuletzt gespeichert/);
  });

  it('reports healthy recording when a this-session sample is within cadence', () => {
    const now = new Date('2026-08-03T16:51:00Z');
    const info = system({
      recording_active: true,
      stored_samples: 200,
      recording_since: '2026-07-22T21:10:17Z',
      current_session_since: '2026-08-03T10:00:00Z',
      last_recorded_sample_at: '2026-08-03T16:50:40Z', // 20s old
    });

    const d = describeRecording(info, { locale, now })!;

    expect(d.state).toBe('recording');
    expect(d.healthy).toBe(true);
  });
});
