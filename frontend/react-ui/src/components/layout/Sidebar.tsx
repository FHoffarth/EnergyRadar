import React from 'react';
import { useApp } from '../../context/AppContext';
import { Activity, BarChart2, Cpu, Settings, Zap, Database } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Sidebar() {
  const { view, setView, status, powerData } = useApp();

  const statusPresentation = {
    live: {
      label: 'Live',
      detail: powerData.lastUpdated || 'Aktuelle Messwerte',
      dot: 'bg-emerald-500',
    },
    stale: {
      label: 'Veraltet',
      detail: powerData.lastUpdated || 'Letzte Messung ist veraltet',
      dot: 'bg-amber-500',
    },
    meter_locked: {
      label: 'Teilweise verfügbar',
      detail: 'Zähler-PIN erforderlich',
      dot: 'bg-amber-500',
    },
    error: {
      label: 'Nicht erreichbar',
      detail: 'Verbindung fehlgeschlagen',
      dot: 'bg-rose-500',
    },
    no_data: {
      label: 'Keine Daten',
      detail: 'Keine Datenquelle eingerichtet',
      dot: 'bg-slate-400',
    },
  }[status];

  const navItems = [
    { id: 'now', label: 'Jetzt', icon: Activity },
    { id: 'today', label: 'Heute', icon: BarChart2 },
    { id: 'devices', label: 'Geräte', icon: Cpu },
    { id: 'memory', label: 'Gedächtnis', icon: Database },
    { id: 'settings', label: 'Einstellungen', icon: Settings },
  ] as const;

  return (
    <aside className="w-64 flex-shrink-0 z-20 bg-[#F1F1EF] dark:bg-[#1C1C1E] border-r border-[#E5E5E3] dark:border-slate-800 flex flex-col h-full">
      <div className="p-8 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1C1C1E] dark:bg-white rounded-xl flex items-center justify-center shadow-sm">
            <Zap className="w-6 h-6 text-white dark:text-[#1C1C1E]" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-[#1C1C1E] dark:text-slate-100">EnergyRadar</span>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                isActive
                  ? "bg-white dark:bg-slate-800 shadow-sm text-[#1C1C1E] dark:text-white font-medium"
                  : "text-[#6E6E6E] dark:text-slate-400 hover:text-[#1C1C1E] dark:hover:text-slate-200"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-6">
        <div className="p-4 bg-white/50 dark:bg-slate-800/50 rounded-2xl border border-[#E5E5E3] dark:border-slate-700">
          <p className="text-xs text-[#6E6E6E] dark:text-slate-400 font-medium uppercase tracking-wider mb-2">Datenstatus</p>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusPresentation.dot}`}></div>
            <span className="text-sm font-semibold text-[#1C1C1E] dark:text-slate-200">{statusPresentation.label}</span>
          </div>
          <p className="text-[11px] text-[#8E8E8E] dark:text-slate-500 mt-1">{statusPresentation.detail}</p>
        </div>
      </div>
    </aside>
  );
}
