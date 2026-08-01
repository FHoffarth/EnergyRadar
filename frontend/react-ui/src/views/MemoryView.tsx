import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Download, Mail, Database, FileText, FileJson, FileSpreadsheet, Archive, CheckCircle, AlertCircle, Loader2, Brain, Info } from 'lucide-react';

export function MemoryView() {
  const { requestExport, requestMailShare, exportStatus } = useApp();
  const { timeline } = useEnergyProvider();

  const [exportType, setExportType] = useState<'pdf' | 'csv' | 'json' | 'zip'>('pdf');
  const [range, setRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'month' | 'year'>('7days');

  const getRangeDates = () => {
    const end = new Date();
    const start = new Date();
    start.setHours(0,0,0,0);

    switch (range) {
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
    requestExport(exportType, range, start, end);
  };

  const handleMailShare = () => {
    const { start, end } = getRangeDates();
    requestMailShare(range, start, end);
  };

  const isZip = exportType === 'zip';

  return (
    <div className="cockpit-page flex-1 flex flex-col overflow-y-auto" data-testid="memory-workspace">
      <div className="mb-7 max-w-3xl">
        <p className="cockpit-eyebrow">Historie &amp; Export</p>
        <h1 className="cockpit-title mt-2 text-[#1C1C1E] dark:text-slate-100">Daten & Gedächtnis</h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-2 text-base">Exportiere Berichte oder erstelle Sicherungen.</p>
      </div>

      <div className="cockpit-surface-muted mb-6 p-4 flex items-start gap-3 text-slate-700 dark:text-slate-300 text-sm">
        <Brain className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold">Gedächtnisfunktion — in Entwicklung</strong>
          <p className="text-xs mt-1 leading-relaxed">
            EnergyRadar wird zukünftig wiederkehrende Verbrauchsmuster erkennen und Gedächtnis-Einträge aus Ihren Tagesdaten ableiten.
            Im aktuellen Sprint steht die Export-Funktion zur Verfügung.
          </p>
        </div>
      </div>

      <div className="cockpit-grid">
        <div className="col-span-12 space-y-6 lg:col-span-8">
          <div className="cockpit-surface p-6">
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2"><Database className="w-5 h-5 text-sky-600 dark:text-sky-400" /> Export-Format</h2>
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
                      ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-600'
                      : 'border-[#E5E5E3] dark:border-slate-700 hover:border-sky-400'
                  }`}>
                  <f.icon className={`w-8 h-8 mb-3 ${exportType === f.id ? 'text-sky-700 dark:text-sky-300' : 'text-slate-500'}`} />
                  <span className="font-medium text-slate-900 dark:text-slate-100">{f.label}</span>
                  <span className="text-xs text-slate-500 mt-1">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {!isZip && (
            <div className="cockpit-surface p-6">
              <h2 className="text-lg font-semibold mb-6">Zeitraum</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { id: 'today', label: 'Heute' },
                  { id: 'yesterday', label: 'Gestern' },
                  { id: '7days', label: 'Letzte 7 Tage' },
                  { id: '30days', label: 'Letzte 30 Tage' },
                  { id: 'month', label: 'Aktueller Monat' },
                  { id: 'year', label: 'Dieses Jahr' },
                ].map(r => (
                  <button key={r.id} onClick={() => setRange(r.id as any)}
                    className={`p-3 rounded-lg border text-center transition-colors ${
                      range === r.id
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

        <div className="col-span-12 space-y-6 lg:col-span-4">
          <div className="cockpit-surface p-6 flex flex-col h-full">
            <h2 className="text-lg font-semibold mb-6">Aktionen</h2>
            <div className="space-y-4 flex-1">
              <button onClick={handleExport} disabled={exportStatus.status === 'running'}
                className="w-full py-4 px-4 bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
                {exportStatus.status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                Export Speichern
              </button>

              {!isZip && exportType === 'pdf' && (
                <button onClick={handleMailShare} disabled={exportStatus.status === 'running'}
                  className="w-full py-4 px-4 bg-white dark:bg-slate-800 border border-sky-700 dark:border-sky-500 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-slate-700 disabled:opacity-50 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors">
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
