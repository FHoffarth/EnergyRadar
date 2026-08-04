import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { useApp } from '../../context/AppContext';
import { useEnergyProvider } from '../../providers/EnergyProviderContext';
import { TodayView } from '../../views/TodayView';
import { DevicesView } from '../../views/DevicesView';
import { SettingsView } from '../../views/SettingsView';
import { MemoryView } from '../../views/MemoryView';
import { SetupWizardModal } from '../SetupWizardModal';

export function AppLayout() {
  const { view } = useApp();
  const { testConnection } = useEnergyProvider();
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);
  const bridge = (window as any).qt?.webChannelTransport ? true : false;

  const renderView = () => {
    switch (view) {
      // 'now' and 'today' are now one unified surface (Übersicht). The legacy
      // 'now' route redirects to it so old deep links keep working.
      case 'now': return <TodayView />;
      case 'today': return <TodayView />;
      case 'devices': return <DevicesView />;
      case 'memory': return <MemoryView />;
      case 'settings': return <SettingsView />;
      default: return <TodayView />;
    }
  };

  // Light mode uses a subtly tinted canvas so surfaces read as surfaces
  // rather than dissolving into a white page.
  return (
    <div className="flex h-screen w-full bg-[var(--radar-canvas)] text-[#1C1C1E] dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300 relative">
      <Sidebar onOpenSetupWizard={() => setIsSetupWizardOpen(true)} />
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col z-10">
        <div className="cockpit-shell flex-1 flex flex-col" data-testid="desktop-content">
          {renderView()}
        </div>
      </main>
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        onTestConnection={testConnection}
        isBridgeConnected={bridge}
      />
    </div>
  );
}
