import React from 'react';
import { CoverageResult, coverageCopy } from '../lib/storytelling';

const labels = { complete: 'Vollständig', partial: 'Teilweise', sparse: 'Wenige Daten', unavailable: 'Nicht verfügbar' };
const styles = {
  complete: 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-300',
  partial: 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-300',
  sparse: 'border-slate-300 bg-slate-100/70 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  unavailable: 'border-slate-300 bg-slate-100/70 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400',
};

export function DataCoverageStatus({ coverage, scope = 'Zeitraum' }: { coverage: CoverageResult; scope?: string }) {
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 ${styles[coverage.level]}`} data-testid="coverage-status">
      <p className="text-sm font-semibold">{labels[coverage.level]}</p>
      <p className="mt-1 text-xs leading-relaxed">{coverageCopy(coverage.level, scope)}</p>
      {coverage.firstTime && coverage.lastTime && (
        <p className="mt-1 text-xs opacity-80">Erfasster Abschnitt: {coverage.firstTime}–{coverage.lastTime} Uhr</p>
      )}
    </div>
  );
}
