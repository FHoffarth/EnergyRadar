import React from 'react';
import { Sidebar } from './Sidebar';
import { LivingSkyBackground } from './LivingSkyBackground';
import { useApp } from '../../context/AppContext';
import { NowView } from '../../views/NowView';
import { TodayView } from '../../views/TodayView';
import { DevicesView } from '../../views/DevicesView';
import { SettingsView } from '../../views/SettingsView';
import { MemoryView } from '../../views/MemoryView';

export function AppLayout() {
  const { view } = useApp();

  const renderView = () => {
    switch (view) {
      case 'now': return <NowView />;
      case 'today': return <TodayView />;
      case 'devices': return <DevicesView />;
      case 'memory': return <MemoryView />;
      case 'settings': return <SettingsView />;
      default: return <NowView />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F8F8F7] dark:bg-[#121212] text-[#1C1C1E] dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300 relative">
      <LivingSkyBackground />
      <Sidebar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col z-10">
        <div className="max-w-[1200px] mx-auto w-full h-full flex flex-col">
          {renderView()}
        </div>
      </main>
    </div>
  );
}
