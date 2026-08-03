import React, { useEffect, useState } from 'react';
import { useApp, useNumberLocale } from '../context/AppContext';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Download, Mail, Database, FileText, FileJson, FileSpreadsheet, Archive, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { HistoryAvailabilitySummary } from '../components/HistoryAvailabilitySummary';
import { HistoryOverviewChart } from '../components/HistoryOverviewChart';
import { evaluateCoverage } from '../lib/storytelling';
import { usePrefersReducedMotion } from '../lib/motion';
import { DEFAULT_RECORDING_CADENCE_SECONDS, todayCoverageBoundaries } from '../lib/timelineIntegrity';
import { EconomySummary } from '../components/EconomySummary';
import { formatEnergy } from '../lib/format';
import { PeriodReport } from '../types';
import { classifyPeriod, PERIOD_METRICS, provenanceLabel } from '../lib/periodView';

type ExportType = 'pdf' | 'csv' | 'json' | 'zip';
type Range = 'today' | 'yesterday' | '7days' | '30days' | 'month' | 'year';

const ranges: { id: Range; label: string }[] = [
  { id: 'today', label: 'Heute' },
  { id: 'yesterday', label: 'Gestern' },
  { id: '7days', label: 'Letzte 7 Tage' },
  { id: '30days', label: 'Letzte 30 Tage' },
  { id: 'month', label: 'Aktueller Monat' },
  { id: 'year', label: 'Dieses Jahr' },
];

function getRangeDates(range: Range) {
  const end = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  switch (range) {
    case 'today': break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case '7days': start.setDate(start.getDate() - 7); break;
    case '30days': start.setDate(start.getDate() - 30); break;
    case 'month': start.setDate(1); break;
    case 'year': start.setMonth(0, 1); break;
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export function MemoryView() {
  const { requestExport, requestMailShare, exportStatus, settingsPayload, todayData } = useApp();
  const { timeline, requestPeriod } = useEnergyProvider();
  const locale = useNumberLocale();
  const animate = !usePrefersReducedMotion();
  const [exportType, setExportType] = useState<ExportType>('pdf');
  const [range, setRange] = useState<Range>('today');
  const [periodReport, setPeriodReport] = useState<PeriodReport | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const rangeLabel = ranges.find(candidate => candidate.id === range)?.label ?? range;
  // The curve series is only supplied for today; historical ranges resolve
  // through the authoritative period API, which is totals + provenance only.
  const visibleTimeline = range === 'today' ? timeline : [];
  const expectedCadenceSeconds = settingsPayload?.system?.recording_interval_seconds ?? DEFAULT_RECORDING_CADENCE_SECONDS;
  const coverage = evaluateCoverage(visibleTimeline, {
    expectedCadenceSeconds,
    ...todayCoverageBoundaries(visibleTimeline),
  });

  // Resolve every range — including today — through the one authoritative
  // period contract, so Memory can never disagree with Today or the report.
  useEffect(() => {
    let cancelled = false;
    setPeriodLoading(true);
    const { start, end } = getRangeDates(range);
    requestPeriod(start, end)
      .then(report => { if (!cancelled) { setPeriodReport(report); setPeriodLoading(false); } })
      .catch(() => { if (!cancelled) { setPeriodReport(null); setPeriodLoading(false); } });
    return () => { cancelled = true; };
  }, [range, requestPeriod]);

  const availability = classifyPeriod(periodReport, periodLoading);

  const handleExport = () => {
    const { start, end } = getRangeDates(range);
    requestExport(exportType, range, start, end);
  };
  const handleMailShare = () => {
    const { start, end } = getRangeDates(range);
    requestMailShare(range, start, end);
  };
  const isZip = exportType === 'zip';

  return (
    <div className="cockpit-page flex-1 overflow-y-auto" data-testid="memory-workspace">
      <header className="mb-6 max-w-3xl">
        <p className="cockpit-eyebrow">Historie</p>
        <h1 className="cockpit-title mt-2 text-slate-900 dark:text-white">Energie im Rückblick</h1>
        <p className="mt-2 text-base text-slate-600 dark:text-slate-400">Gespeicherte Messungen mit sichtbarer Datenabdeckung.</p>
      </header>

      <HistoryAvailabilitySummary
        recordingSince={settingsPayload?.system?.recording_since}
        lastSample={settingsPayload?.system?.last_recorded_sample_at}
        selectedRange={rangeLabel}
        coverage={coverage}
      />

      {range === 'today' ? (
        <EconomySummary report={todayData?.economy} locale={locale} scope="memory" />
      ) : (
        <section className="cockpit-surface my-5 p-5" aria-label="Wirtschaftlichkeit im gewählten Zeitraum">
          <h2 className="cockpit-section-title">Wirtschaftlicher Solarwert</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Für diesen Zeitraum ist in der aktuellen Ansicht noch keine belastbare Berechnung verfügbar. Es wird kein Tageswert hochgerechnet.</p>
        </section>
      )}

      <section className="cockpit-surface my-5 p-5" aria-labelledby="history-range-heading">
        <h2 id="history-range-heading" className="cockpit-section-title">Zeitraum wählen</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {ranges.map(candidate => (
            <button key={candidate.id} type="button" onClick={() => setRange(candidate.id)}
              aria-pressed={range === candidate.id}
              className={`rounded-lg border p-3 text-center transition-colors ${range === candidate.id
                ? 'border-sky-700 bg-sky-700 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-slate-950'
                : 'border-slate-200 text-slate-700 hover:border-sky-400 dark:border-slate-700 dark:text-slate-300'}`}>
              {candidate.label}
            </button>
          ))}
        </div>
      </section>

      <section className="cockpit-surface my-5 p-5" aria-labelledby="period-summary-heading" data-testid="period-summary" data-availability={availability}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="period-summary-heading" className="cockpit-section-title">Gespeicherte Summen · {rangeLabel}</h2>
          {periodReport?.provenance && provenanceLabel(periodReport.provenance) && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {provenanceLabel(periodReport.provenance)}
            </span>
          )}
        </div>

        {availability === 'loading' && (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Zeitraum wird geladen …</p>
        )}

        {availability === 'summary' && periodReport && (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {PERIOD_METRICS.map(({ key, label }) => (
                <div key={key}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {formatEnergy(periodReport.metrics[key].value_kwh, locale)}
                  </dd>
                </div>
              ))}
            </dl>
            {range !== 'today' && (
              <p className="mt-4 text-sm text-amber-700 dark:text-amber-400">
                Tagesertrag bekannt, Verlauf unvollständig — für diesen Zeitraum liegen Summen, aber keine vollständige Kurve vor.
              </p>
            )}
          </>
        )}

        {availability === 'records_only' && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Für diesen Zeitraum sind Messwerte gespeichert, aber es lässt sich keine belastbare Summe bilden. Es wird kein Wert hochgerechnet.
          </p>
        )}

        {availability === 'unavailable' && (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Für diesen Zeitraum liegen keine gespeicherten Messwerte vor.
          </p>
        )}
      </section>

      <div className="grid gap-5">
        <section className="cockpit-surface p-5 lg:p-6" aria-labelledby="history-chart-heading">
          <p className="cockpit-eyebrow">Verlauf</p>
          <h2 id="history-chart-heading" className="mt-2 text-xl font-semibold">
            {range === 'today' ? 'Aktuell geladener Tag' : rangeLabel}
          </h2>
          <p className="mb-4 mt-1 text-sm text-slate-500 dark:text-slate-400">
            {range === 'today'
              ? 'Die Kurve zeigt den derzeit geladenen Tagesverlauf. Fehlende Abschnitte bleiben als Lücken sichtbar.'
              : 'Für diesen Zeitraum zeigt die Oberfläche noch keinen Verlauf; die gespeicherten Summen oben stammen aus der Zeitraum-Auswertung. Der Export enthält die Rohdaten.'}
          </p>
          <HistoryOverviewChart timeline={visibleTimeline} locale={locale} animate={animate}
            expectedCadenceSeconds={expectedCadenceSeconds} />
        </section>
      </div>

      <details className="cockpit-surface mt-6 p-5">
        <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">Export und Sicherung</summary>
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><Database className="h-5 w-5 text-sky-600" /> Export-Format</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { id: 'pdf', label: 'PDF-Bericht', icon: FileText, desc: 'Visuell' },
                { id: 'csv', label: 'CSV-Daten', icon: FileSpreadsheet, desc: 'Für Tabellen' },
                { id: 'json', label: 'JSON-Daten', icon: FileJson, desc: 'Rohdaten' },
                { id: 'zip', label: 'ZIP-Backup', icon: Archive, desc: 'Vollsicherung' },
              ].map(format => (
                <button key={format.id} type="button" onClick={() => setExportType(format.id as ExportType)}
                  aria-pressed={exportType === format.id}
                  className={`flex flex-col rounded-xl border p-4 text-left transition-colors ${exportType === format.id
                    ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/30'
                    : 'border-slate-200 hover:border-sky-400 dark:border-slate-700'}`}>
                  <format.icon className={`mb-3 h-7 w-7 ${exportType === format.id ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500'}`} />
                  <span className="font-medium">{format.label}</span>
                  <span className="mt-1 text-xs text-slate-500">{format.desc}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              {isZip ? 'Das Backup umfasst alle gespeicherten Daten.' : `Der Export verwendet den gewählten Zeitraum „${rangeLabel}“.`}
            </p>
          </div>

          <div>
            <button type="button" onClick={handleExport} disabled={exportStatus.status === 'running'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              {exportStatus.status === 'running' ? <Loader2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
              Export speichern
            </button>
            {!isZip && exportType === 'pdf' && (
              <button type="button" onClick={handleMailShare} disabled={exportStatus.status === 'running'}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-700 px-4 py-3 font-medium text-sky-700 disabled:opacity-50 dark:border-sky-500 dark:text-sky-300">
                <Mail className="h-5 w-5" /> Per E-Mail teilen
              </button>
            )}
            {exportStatus.status !== 'idle' && (
              <div role="status" className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${
                exportStatus.status === 'error' ? 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900/20' :
                exportStatus.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' :
                'border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-900/20'
              }`}>
                {exportStatus.status === 'error' ? <AlertCircle className="h-5 w-5 shrink-0" /> :
                  exportStatus.status === 'done' ? <CheckCircle className="h-5 w-5 shrink-0" /> :
                    <Loader2 className="h-5 w-5 shrink-0" />}
                <div><p className="font-medium">{exportStatus.status === 'error' ? 'Fehler' : exportStatus.status === 'done' ? 'Erfolgreich' : 'In Arbeit …'}</p>
                  {exportStatus.msg && <p className="mt-1 text-sm">{exportStatus.msg}</p>}</div>
              </div>
            )}
          </div>
        </div>
        <p className="mt-5 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700">
          Exporte werden lokal erstellt. Beim Teilen öffnet EnergyRadar dein Standard-Mailprogramm.
        </p>
      </details>
      <details className="mt-4 text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Technische Details</summary>
        <dl className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Geladene Messpunkte</dt><dd className="font-medium">{visibleTimeline.length}</dd></div>
          <div><dt className="text-xs text-slate-500">Erkannte Lücken</dt><dd className="font-medium">{coverage.gapCount}</dd></div>
        </dl>
      </details>
    </div>
  );
}
