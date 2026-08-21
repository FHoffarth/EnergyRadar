import React from 'react';
import { CoverageResult } from '../lib/storytelling';
import { DataCoverageStatus } from './DataCoverageStatus';

function dateTime(value?: string | null): string {
  if (!value) return 'Nicht verfügbar';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
    : 'Nicht verfügbar';
}

export function HistoryAvailabilitySummary({ recordingSince, lastSample, selectedRange, coverage, status, showCoverage }: {
  recordingSince?: string | null; lastSample?: string | null; selectedRange: string; coverage: CoverageResult;
  status?: { label: string; unavailable: boolean }; showCoverage?: boolean;
}) {
  return (
    <section aria-label="Verfügbarkeit der Historie" className="cockpit-surface p-5 lg:p-6">
      <p className="cockpit-eyebrow">Gespeicherte Historie</p>
      <h2 className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{selectedRange}</h2>
      {status && (
        // Authoritative, period-derived status — never contradicts the summary
        // and curve below (no false "Nicht verfügbar" when data exists).
        <p className={`mt-2 text-sm font-medium ${status.unavailable ? 'text-slate-500' : 'text-emerald-700 dark:text-emerald-400'}`}
          data-testid="memory-top-status">
          {status.label}
        </p>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Aufzeichnung seit</dt><dd className="mt-1 font-medium">{dateTime(recordingSince)}</dd></div>
        <div><dt className="text-xs text-slate-500">Letzte gespeicherte Messung</dt><dd className="mt-1 font-medium">{dateTime(lastSample)}</dd></div>
      </dl>
      {/* The today-only coverage read-out is meaningful only for the live day. */}
      {showCoverage !== false && (
        <div className="mt-4"><DataCoverageStatus coverage={coverage} scope="geladenen Verlauf" /></div>
      )}
    </section>
  );
}
