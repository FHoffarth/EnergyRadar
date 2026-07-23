import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Download, Mail, Database, FileText, FileJson, FileSpreadsheet, Archive, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export function MemoryView() {
  const { requestExport, requestMailShare, exportStatus } = useApp();

  const [exportType, setExportType] = useState<'pdf' | 'csv' | 'json' | 'zip'>('pdf');
  const [range, setRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'month' | 'year'>('7days');

  // Helper to get ISO date strings for range
  const getRangeDates = () => {
    const end = new Date();
    const start = new Date();
    start.setHours(0,0,0,0);

    switch (range) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        end.setHours(23,59,59,999);
        break;
      case '7days':
        start.setDate(start.getDate() - 7);
        break;
      case '30days':
        start.setDate(start.getDate() - 30);
        break;
      case 'month':
        start.setDate(1);
        break;
      case 'year':
        start.setMonth(0, 1);
        break;
    }
    return { start: start.toISOString(), end: end.toISOString() };
  };

  const handleExport = () => {
    const { start, end } = getRangeDates();
    requestExport(exportType, range, start, end);
  };

  const handleMailShare = () => {
    const { start, end } = getRangeDates();
    requestMailShare(range, start, end);
  };

  const isZip = exportType === 'zip';

  return (
    <div className="flex-1 flex flex-col p-8 pt-12 overflow-y-auto">
      <div className="mb-10">
        <h1 className="text-4xl font-bold text-[#1C1C1E] dark:text-slate-100 tracking-tight">Daten & Gedächtnis</h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-2 text-lg">Exportiere Berichte oder erstelle Sicherungen.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Links: Format & Zeitraum */}
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
                <button
                  key={f.id}
                  onClick={() => setExportType(f.id as any)}
                  className={`flex flex-col p-4 rounded-xl border text-left transition-colors ${
                    exportType === f.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                      : 'border-[#E5E5E3] dark:border-slate-700 hover:border-indigo-300'
                  }`}
                >
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
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id as any)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      range === r.id
                        ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                        : 'border-[#E5E5E3] dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rechts: Aktionen & Vorschau */}
        <div className="col-span-1 space-y-8">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-[#E5E5E3] dark:border-slate-800 shadow-sm flex flex-col h-full">
            <h2 className="text-xl font-semibold mb-6">Aktionen</h2>

            <div className="space-y-4 flex-1">
              <button
                onClick={handleExport}
                disabled={exportStatus.status === 'running'}
                className="w-full py-4 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {exportStatus.status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                Export Speichern
              </button>

              {!isZip && exportType === 'pdf' && (
                <button
                  onClick={handleMailShare}
                  disabled={exportStatus.status === 'running'}
                  className="w-full py-4 px-4 bg-white dark:bg-slate-800 border-2 border-indigo-600 dark:border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-slate-700 disabled:opacity-50 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Mail className="w-5 h-5" />
                  Per E-Mail teilen
                </button>
              )}
            </div>

            {/* Status Panel */}
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
              <p><strong>Datenschutz-Hinweis:</strong> Alle Exporte werden lokal auf deinem Gerät erstellt. Bei der E-Mail-Teilen-Funktion wird dein Standard-Mailprogramm mit dem Bericht geöffnet. Du musst die Datei manuell anfügen.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
