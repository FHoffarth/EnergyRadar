import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryView } from '../views/MemoryView';

const requestExport = vi.fn();
const appState: any = {
  requestExport, requestMailShare: vi.fn(), exportStatus: { status: 'idle', msg: '' },
  settingsPayload: { effective_settings: { number_format: 'de-DE' }, system: {
    recording_since: '2026-07-01T08:00:00', last_recorded_sample_at: '2026-08-01T10:00:00',
  } },
};
const providerState: any = { timeline: [] };

vi.mock('../context/AppContext', () => ({ useApp: () => appState, useNumberLocale: () => 'de-DE' }));
vi.mock('../providers/EnergyProviderContext', () => ({ useEnergyProvider: () => providerState }));

describe('MemoryView', () => {
  beforeEach(() => { requestExport.mockClear(); providerState.timeline = []; });

  it('puts availability and an honest loaded-day chart before secondary export controls', () => {
    render(<MemoryView />);
    expect(screen.getByRole('region', { name: 'Verfügbarkeit der Historie' })).toBeTruthy();
    expect(screen.getByText('Aktuell geladener Tag')).toBeTruthy();
    expect(screen.getByText(/derzeit geladenen Tagesverlauf/)).toBeTruthy();
    expect(screen.getByText('Export und Sicherung')).toBeTruthy();
    expect(screen.queryByText(/in Entwicklung/)).toBeNull();
  });

  it('uses the selected range for the real export action', () => {
    render(<MemoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
    fireEvent.click(screen.getByText('Export und Sicherung'));
    fireEvent.click(screen.getByRole('button', { name: 'Export speichern' }));
    expect(requestExport).toHaveBeenCalledWith('pdf', 'today', expect.any(String), expect.any(String));
  });

  it('keeps missing history visibly unavailable', () => {
    render(<MemoryView />);
    expect(screen.getByText('Nicht verfügbar')).toBeTruthy();
    expect(screen.getAllByText(/keine Messwerte/)).toHaveLength(2);
  });
});
