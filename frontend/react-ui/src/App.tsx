/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider } from './context/AppContext';
import { AppLayout } from './components/layout/AppLayout';

export default function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
