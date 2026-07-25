import React from 'react';
import { Sun, Battery, Home, Globe } from 'lucide-react';
import { EnergySnapshot, DataOrigin } from '../types';

interface EnergyFlowProps {
  snapshot: EnergySnapshot;
}

function formatKw(val: number | null): string {
  if (val === null || isNaN(val)) return '—';
  return val.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function EnergyFlow({ snapshot }: EnergyFlowProps) {
  const { solar, homeLoad, grid, battery } = snapshot;

  const renderOriginBadge = (origin: DataOrigin) => {
    const styles: Record<DataOrigin, string> = {
      observed: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/40',
      simulated: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/80 dark:text-sky-400 dark:border-sky-800/40',
      calculated: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-400 dark:border-indigo-800/40',
      estimated: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-400 dark:border-amber-800/40',
      unavailable: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
    };
    const labels: Record<DataOrigin, string> = {
      observed: 'Gemessen',
      simulated: 'Simuliert',
      calculated: 'Berechnet',
      estimated: 'Geschätzt',
      unavailable: 'Unbekannt'
    };
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${styles[origin]}`}>
        {labels[origin]}
      </span>
    );
  };

  const isImporting = grid.valueKw !== null && grid.valueKw > 0 && grid.origin !== 'unavailable';
  const isExporting = grid.valueKw !== null && grid.valueKw < 0 && grid.origin !== 'unavailable';
  const isCharging = battery !== null && battery.powerKw !== null && battery.powerKw > 0;
  const isDischarging = battery !== null && battery.powerKw !== null && battery.powerKw < 0;
  const hasGrid = grid.valueKw !== null && grid.origin !== 'unavailable';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/70 p-5 sm:p-6 shadow-sm font-sans">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Momentane Leistungsflüsse
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {solar.origin === 'observed' ? 'Verifizierte Live-Telemetriewerte' :
             solar.origin === 'simulated' ? 'Simulierte Demo-Daten' :
             'Daten aus zuverlässiger Quelle'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`p-4 rounded-xl border transition-colors ${
          solar.valueKw !== null && solar.valueKw > 0
            ? 'bg-amber-50/80 border-amber-200/80 dark:bg-amber-950/10 dark:border-amber-500/20'
            : 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-800/30 dark:border-slate-700/50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Sun className="w-5 h-5" />
            </div>
            {renderOriginBadge(solar.origin)}
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {solar.valueKw !== null ? `${formatKw(solar.valueKw)} kW` : '—'}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            {solar.valueKw !== null ? (solar.valueKw > 0 ? 'PV-Erzeugung' : 'Kein Solareintrag') : 'Sensordaten fehlen'}
          </div>
        </div>

        <div className={`p-4 rounded-xl border transition-colors ${
          isCharging
            ? 'bg-emerald-50/80 border-emerald-200/80 dark:bg-emerald-950/10 dark:border-emerald-500/20'
            : isDischarging
            ? 'bg-sky-50/80 border-sky-200/80 dark:bg-sky-950/10 dark:border-sky-500/20'
            : 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-800/30 dark:border-slate-700/50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`p-2 rounded-lg ${isCharging ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'}`}>
              <Battery className="w-5 h-5" />
            </div>
            {battery ? renderOriginBadge(battery.origin) : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 font-medium">Nicht verfügbar</span>}
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {battery?.stateOfChargePercent !== null && battery?.stateOfChargePercent !== undefined ? `${battery.stateOfChargePercent} %` : '—'}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            {battery?.powerKw !== null && battery?.powerKw !== undefined ? (
              isCharging ? `Laden (+${formatKw(battery.powerKw)} kW)` :
              isDischarging ? `Entladen (${formatKw(battery.powerKw)} kW)` : 'Speicher im Standby'
            ) : 'Speicherdaten nicht verfügbar'}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-200/80 dark:bg-indigo-950/10 dark:border-indigo-500/20">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Home className="w-5 h-5" />
            </div>
            {renderOriginBadge(homeLoad.origin)}
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {homeLoad.valueKw !== null ? `${formatKw(homeLoad.valueKw)} kW` : '—'}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            {homeLoad.valueKw !== null ? 'Hauslast' : 'Verbrauchsdaten fehlen'}
          </div>
        </div>

        <div className={`p-4 rounded-xl border transition-colors ${
          isImporting
            ? 'bg-rose-50/80 border-rose-200/80 dark:bg-rose-950/10 dark:border-rose-500/20'
            : isExporting
            ? 'bg-sky-50/80 border-sky-200/80 dark:bg-sky-950/10 dark:border-sky-500/20'
            : 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-800/30 dark:border-slate-700/50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`p-2 rounded-lg ${isImporting ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'}`}>
              <Globe className="w-5 h-5" />
            </div>
            {renderOriginBadge(grid.origin)}
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
            {hasGrid ? `${formatKw(Math.abs(grid.valueKw!))} kW` : '—'}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            {hasGrid ? (
              isImporting ? 'Netzbezug' :
              isExporting ? 'Netzeinspeisung' : 'Netzneutral'
            ) : 'Messung unbestimmt'}
          </div>
        </div>
      </div>
    </div>
  );
}
