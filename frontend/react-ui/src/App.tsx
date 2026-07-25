import React from 'react';
import { AppProvider } from './context/AppContext';
import { EnergyProviderRoot } from './providers/EnergyProviderContext';
import { AppLayout } from './components/layout/AppLayout';

export default function App() {
  return (
    <AppProvider>
      <EnergyProviderRoot>
        <AppLayout />
      </EnergyProviderRoot>
    </AppProvider>
  );
}
