import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Download, Mail, Database, FileText, FileJson, FileSpreadsheet, Archive, CheckCircle, AlertCircle, Loader2, History } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HistoryData, HistoryRangeKey } from '../types';
import { historyData$, requestHistoryRange } from '../lib/energyService';
import { useNumberLocale } from '../context/AppContext';
import { formatNumber } from '../lib/format';

export function MemoryView() {
  const { requestExport, requestMailShare, exportStatus } = useApp();
  const locale = useNumberLocale();

  const [exportType, setExportType] = useState<'pdf' | 'csv' | 'json' | 'zip'>('pdf');
  const [exportRange, setExportRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'month' | 'year'>('7days');
  const [historyRange, setHistoryRange] = useState<HistoryRangeKey>('today');
  const [history, setHistory] = useState<HistoryData>(historyData$.get());

  useEffect(() => historyData$.subscribe(setHistory), []);
  useEffect(() => {
    requestHistoryRange(historyRange);
  }, [historyRange]);

  const getRangeDates = () => {
    const end = new Date();
    const start = new Date();
    start.setHours(0,0,0,0);

    switch (exportRange) {
      case 'today': break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        end.setHours(23,59,59,999);
        break;
      case '7days': start.setDate(start.getDate() - 7); break;
      case '30days': start.setDate(start.getDate() - 30); break;
      case 'month': start.setDate(1); break;
      case 'year': start.setMonth(0, 1); break;
    }
    return { start: start.toISOString(), end: end.toISOString() };
  };

  const handleExport = () => {
    const { start, end } = getRangeDates();
    requestExport(exportType, exportRange, start, end);
  };

  const handleMailShare = () => {
    const { start, end } = getRangeDates();
    requestMailShare(exportRange, start, end);
  };

  const isZip = exportType === 'zip';
  const recordingSince = history.recordingSince
    ? new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(history.recordingSince))
    : null;
  const historyMessage = history.status === 'loading'
    ? 'Gespeicherte Energiedaten werden geladen.'
    : history.status === 'no_history'
    ? 'Für diesen Zeitraum wurden noch keine Energiedaten aufgezeichnet.'
    : history.status === 'partial'
    ? `${recordingSince ? `Aufzeichnung aktiv seit ${recordingSince} Uhr. ` : ''}Für diesen Zeitraum liegen teilweise keine Messdaten vor.`
    : recordingSince
    ? `Aufzeichnung aktiv seit ${recordingSince} Uhr.`
    : 'Gespeicherte Energiedaten sind verfügbar.';
  const chartPoints = history.points;

  return (
    <div className="flex-1 flex flex-col p-8 pt-12 overflow-y-auto">
      <div className="mb-10">
        <h1 className="text-4xl font-bold text-[#1C1C1E] dark:text-slate-100 tracking-tight">Daten & Gedächtnis</h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-2 text-lg">Exportiere Berichte oder erstelle Sicherungen.</p>
      </div>

      <section className="mb-8 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-[#E5E5E3] dark:border-slate-800 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-500" /> Energieverlauf
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1" aria-live="polite">
              {historyMessage}
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-1" aria-label="Historischer Zeitraum">
            {([
              ['today', 'Heute'],
              ['7days', '7 Tage'],
              ['30days', '30 Tage'],
            ] as Array<[HistoryRangeKey, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setHistoryRange(key)}
                aria-pressed={historyRange === key}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  historyRange === key
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {history.status === 'loading' ? (
          <div className="h-72 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Historie wird geladen
          </div>
        ) : chartPoints.length === 0 ? (
          <div className="h-72 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-sm">
            Keine gespeicherten Messwerte in diesem Zeitraum.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartPoints} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} vertical={false} />
                <XAxis dataKey="time" minTickGap={48} tickLine={false} axisLine={false} fontSize={10} stroke="#94A3B8" />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  stroke="#94A3B8"
                  unit=" kW"
                  tickFormatter={(value: number) => formatNumber(value, locale, { maximumFractionDigits: 1 })}
                />
                <ReferenceLine y={0} stroke="#64748B" strokeWidth={1.5} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${formatNumber(value, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kW`,
                    name,
                  ]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.timestamp
                    ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(payload[0].payload.timestamp))
                    : ''}
                />
                <Legend />
                <Line type="linear" dataKey="solarKw" name="Solar" stroke="#D97706" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="linear" dataKey="consumptionKw" name="Verbrauch" stroke="#4F46E5" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="linear" dataKey="gridKw" name="Netzfluss" stroke="#0284C7" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Netzfluss über null bedeutet Bezug, unter null Einspeisung. Fehlende Zeiträume bleiben als Lücken sichtbar.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="col-span-1 lg:col-span-2 space-y-8">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-[#E5E5E3] dark:border-slate-800 shadow-sm">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2"><Database className="w-5 h-5 text-indigo-500" /> Export-Format</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { id: 'pdf', label: 'PDF Bericht', icon: FileText, desc: 'Visuell' },
                { id: 'csv', label: 'CSV Daten', icon: FileSpreadsheet, desc: 'Für Excel' },
                { id: 'json', label: 'JSON Daten', icon: FileJson, desc: 'Rohdaten' },
                { id: 'zip', label: 'ZIP Backup', icon: Archive, desc: 'Vollsicherung' },
              ].map(f => (
                <button key={f.id} onClick={() => setExportType(f.id as any)}
                  className={`flex flex-col p-4 rounded-xl border text-left transition-colors ${
                    exportType === f.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                      : 'border-[#E5E5E3] dark:border-slate-700 hover:border-indigo-300'
                  }`}>
                  <f.icon className={`w-8 h-8 mb-3 ${exportType === f.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`} />
                  <span className="font-medium text-slate-900 dark:text-slate-100">{f.label}</span>
                  <span className="text-xs text-slate-500 mt-1">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {!isZip && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-[#E5E5E3] dark:border-slate-800 shadow-sm">
              <h2 className="text-xl font-semibold mb-6">Zeitraum</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { id: 'today', label: 'Heute' },
                  { id: 'yesterday', label: 'Gestern' },
                  { id: '7days', label: 'Letzte 7 Tage' },
                  { id: '30days', label: 'Letzte 30 Tage' },
                  { id: 'month', label: 'Aktueller Monat' },
                  { id: 'year', label: 'Dieses Jahr' },
                ].map(r => (
                  <button key={r.id} onClick={() => setExportRange(r.id as any)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      exportRange === r.id
                        ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                        : 'border-[#E5E5E3] dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="col-span-1 space-y-8">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-[#E5E5E3] dark:border-slate-800 shadow-sm flex flex-col h-full">
            <h2 className="text-xl font-semibold mb-6">Aktionen</h2>
            <div className="space-y-4 flex-1">
              <button onClick={handleExport} disabled={exportStatus.status === 'running'}
                className="w-full py-4 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                {exportStatus.status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                Export Speichern
              </button>

              {!isZip && exportType === 'pdf' && (
                <button onClick={handleMailShare} disabled={exportStatus.status === 'running'}
                  className="w-full py-4 px-4 bg-white dark:bg-slate-800 border-2 border-indigo-600 dark:border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 disabled:opacity-50 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                  <Mail className="w-5 h-5" />
                  Per E-Mail teilen
                </button>
              )}
            </div>

            {exportStatus.status !== 'idle' && (
              <div className={`mt-6 p-4 rounded-xl border flex items-start gap-3 ${
                exportStatus.status === 'error' ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800' :
                exportStatus.status === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800' :
                'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800'
              }`}>
                {exportStatus.status === 'error' ? <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> :
                 exportStatus.status === 'done' ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> :
                 <Loader2 className="w-5 h-5 shrink-0 mt-0.5 animate-spin" />}
                <div>
                  <p className="font-medium">
                    {exportStatus.status === 'error' ? 'Fehler' :
                     exportStatus.status === 'done' ? 'Erfolgreich' : 'In Arbeit...'}
                  </p>
                  {exportStatus.msg && <p className="text-sm opacity-90 mt-1">{exportStatus.msg}</p>}
                </div>
              </div>
            )}

            <div className="mt-8 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <p><strong>Datenschutz-Hinweis:</strong> Alle Exporte werden lokal auf deinem Gerät erstellt. Bei der E-Mail-Teilen-Funktion wird dein Standard-Mailprogramm mit dem Bericht geöffnet.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
