import React from 'react';
import { CoverageResult, coverageCopy } from '../lib/storytelling';

const labels = { complete: 'Vollständig', partial: 'Teilweise', sparse: 'Wenige Daten', unavailable: 'Nicht verfügbar' };
// Level is carried by a labelled dot (never colour alone); no card is needed.
const dot = {
  complete: 'bg-emerald-500',
  partial: 'bg-amber-500',
  sparse: 'bg-slate-400',
  unavailable: 'bg-slate-400',
};

export function DataCoverageStatus({ coverage, scope = 'Zeitraum' }: { coverage: CoverageResult; scope?: string }) {
  return (
    <div role="status" className="text-xs" data-testid="coverage-status">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span className={`inline-block h-2 w-2 rounded-full ${dot[coverage.level]}`} aria-hidden />
        {labels[coverage.level]}
      </p>
      <p className="mt-1 leading-relaxed text-slate-500 dark:text-slate-400">{coverageCopy(coverage.level, scope)}</p>
      {coverage.firstTime && coverage.lastTime && (
        <p className="mt-1 text-slate-400 dark:text-slate-500">Erfasster Abschnitt: {coverage.firstTime}–{coverage.lastTime} Uhr</p>
      )}
    </div>
  );
}
