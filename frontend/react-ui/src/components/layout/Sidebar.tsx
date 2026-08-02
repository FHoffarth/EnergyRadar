import React from 'react';
import { useApp, useNumberLocale } from '../../context/AppContext';
import { useEnergyProvider } from '../../providers/EnergyProviderContext';
import { localClock } from '../../lib/freshness';
import { Activity, BarChart2, Cpu, Settings, Zap, Database, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import markDark from '../../assets/icons/energyradar-mark.svg';
import markLight from '../../assets/icons/energyradar-mark-light.svg';

interface SidebarProps {
  onOpenSetupWizard?: () => void;
}

export function Sidebar({ onOpenSetupWizard }: SidebarProps) {
  const { view, setView, status, settingsPayload } = useApp();
  const { snapshot, sourceType } = useEnergyProvider();
  const locale = useNumberLocale();
  // Freshness reaches the user as a local-time feeling, never a raw timestamp.
  const observedClock = localClock(snapshot.timestamp, locale);

  // The setup CTA is only offered while no data source is actually working.
  const hasConfiguredSource =
    Boolean(settingsPayload?.effective_settings?.fronius_address)
    || Boolean(settingsPayload?.effective_settings?.mt175_address)
    || snapshot.solar.origin === 'observed';

  const hasObservedSolar = snapshot.solar.origin === 'observed';
  const hasObservedHome = snapshot.homeLoad.origin === 'observed';
  const hasObservedGrid = snapshot.grid.origin === 'observed';
  const solarOnly = hasObservedSolar && !hasObservedHome && !hasObservedGrid;
  const anyObserved = hasObservedSolar || hasObservedHome || hasObservedGrid;

  const qualityPresentation = solarOnly
    ? { label: 'Solar aktiv', detail: 'PV-Daten aktuell · Zähler nicht verfügbar', dot: 'bg-emerald-500' }
    : anyObserved
    ? { label: 'Aktuell', detail: observedClock ? `Aktualisiert ${observedClock} Uhr` : 'Aktuelle Messwerte', dot: 'bg-emerald-500' }
    : snapshot.quality === 'stale'
    ? { label: 'Veraltet', detail: observedClock ? `Letzte Messung ${observedClock} Uhr` : 'Letzte Messung ist veraltet', dot: 'bg-amber-500' }
    : snapshot.quality === 'error'
    ? { label: 'Nicht erreichbar', detail: 'Verbindung unterbrochen', dot: 'bg-rose-500' }
    : { label: 'Keine Daten', detail: 'Keine Datenquelle eingerichtet', dot: 'bg-slate-400' };

  const navItems = [
    { id: 'now', label: 'Jetzt', icon: Activity },
    { id: 'today', label: 'Heute', icon: BarChart2 },
    { id: 'devices', label: 'Geräte', icon: Cpu },
    { id: 'memory', label: 'Gedächtnis', icon: Database },
    { id: 'settings', label: 'Einstellungen', icon: Settings },
  ] as const;

  return (
    <aside className="w-60 2xl:w-64 flex-shrink-0 z-20 bg-[#F4F6F5] dark:bg-[#151A1A] border-r border-slate-200/80 dark:border-slate-800 flex flex-col h-full">
      <div className="p-8 pb-6">
        <div className="flex items-center gap-3">
          {/* Supplied mark, one variant per theme. The `dark` class lives on
              <html>, so CSS picks the variant without duplicating theme logic. */}
          <img
            src={markLight}
            width={40}
            height={40}
            alt="EnergyRadar"
            className="w-10 h-10 flex-shrink-0 dark:hidden"
          />
          <img
            src={markDark}
            width={40}
            height={40}
            alt=""
            aria-hidden="true"
            className="w-10 h-10 flex-shrink-0 hidden dark:block"
          />
          <div>
            <span className="text-xl font-semibold tracking-tight text-[#1C1C1E] dark:text-slate-100 block leading-tight">EnergyRadar</span>
            <span className="text-[10px] font-medium text-sky-700 dark:text-sky-400">{sourceType === 'demo' ? 'Demo-Modus' : sourceType === 'offline' ? 'Nicht verbunden' : 'Verbunden'}</span>
          </div>
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
                  ? "bg-white dark:bg-slate-800 text-sky-800 dark:text-sky-300 font-semibold ring-1 ring-slate-200/70 dark:ring-slate-700"
                  : "text-[#6E6E6E] dark:text-slate-400 hover:text-[#1C1C1E] dark:hover:text-slate-200"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-6 space-y-3">
        <div className="p-4 bg-white/50 dark:bg-slate-800/50 rounded-2xl border border-[#E5E5E3] dark:border-slate-700">
          <p className="text-xs text-[#6E6E6E] dark:text-slate-400 font-medium uppercase tracking-wider mb-2">Datenstatus</p>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${qualityPresentation.dot}`} />
            <span className="text-sm font-semibold text-[#1C1C1E] dark:text-slate-200">{qualityPresentation.label}</span>
          </div>
          <p className="text-[11px] text-[#8E8E8E] dark:text-slate-500 mt-1">{qualityPresentation.detail}</p>
        </div>

        {onOpenSetupWizard && !hasConfiguredSource && (
          <button
            onClick={onOpenSetupWizard}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Datenquelle einrichten
          </button>
        )}
      </div>
    </aside>
  );
}
