import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryData } from '../types';

const mocks = vi.hoisted(() => ({
  currentHistory: null as HistoryData | null,
  requestHistoryRange: vi.fn(),
}));

vi.mock('../lib/energyService', () => ({
  historyData$: {
    get: () => mocks.currentHistory,
    subscribe: (callback: (value: HistoryData) => void) => {
      callback(mocks.currentHistory as HistoryData);
      return () => undefined;
    },
  },
  requestHistoryRange: mocks.requestHistoryRange,
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => ({
    requestExport: vi.fn(),
    requestMailShare: vi.fn(),
    exportStatus: { status: 'idle', msg: '' },
  }),
  useNumberLocale: () => 'de-DE',
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ data, children }: any) => (
    <div data-testid="history-chart" data-points={JSON.stringify(data)}>{children}</div>
  ),
  Line: ({ dataKey, name, connectNulls }: any) => (
    <div data-testid={`series-${dataKey}`} data-name={name} data-connect={String(connectNulls)} />
  ),
  ReferenceLine: ({ y }: any) => <div data-testid="zero-line" data-y={String(y)} />,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { MemoryView } from '../views/MemoryView';

describe('persisted Energy Memory history', () => {
  beforeEach(() => {
    mocks.requestHistoryRange.mockClear();
    mocks.currentHistory = {
      range: 'today',
      status: 'partial',
      recordingSince: '2026-07-31T17:24:00Z',
      lastRecordedAt: '2026-07-31T17:30:00Z',
      totalSamples: 3,
      points: [
        { timestamp: '2026-07-31T17:24:00Z', time: '19:24', solarKw: 1.1, consumptionKw: 0.2, gridKw: -0.9, quality: 'derived', source: 'EnergyRadar', gap: false },
        { timestamp: '2026-07-31T17:25:00Z', time: '19:25', solarKw: 0, consumptionKw: 0, gridKw: 0, quality: 'derived', source: 'EnergyRadar', gap: false },
        { timestamp: '2026-07-31T17:27:00Z', time: '19:27', solarKw: null, consumptionKw: null, gridKw: null, quality: 'missing', source: 'EnergyRadar', gap: true },
      ],
    };
  });

  it('renders Solar, Consumption and signed Grid Flow without bridging gaps', () => {
    render(<MemoryView />);

    expect(screen.getByText(/Aufzeichnung aktiv seit .* Für diesen Zeitraum liegen teilweise keine Messdaten vor\./)).toBeInTheDocument();
    expect(screen.getByTestId('series-solarKw')).toHaveAttribute('data-name', 'Solar');
    expect(screen.getByTestId('series-consumptionKw')).toHaveAttribute('data-name', 'Verbrauch');
    expect(screen.getByTestId('series-gridKw')).toHaveAttribute('data-name', 'Netzfluss');
    expect(screen.getByTestId('series-gridKw')).toHaveAttribute('data-connect', 'false');
    expect(screen.getByTestId('zero-line')).toHaveAttribute('data-y', '0');

    const points = JSON.parse(screen.getByTestId('history-chart').getAttribute('data-points') || '[]');
    expect(points[0].gridKw).toBe(-0.9);
    expect(points[1].gridKw).toBe(0);
    expect(points[2].gridKw).toBeNull();
  });

  it('requests Today, 7-day and 30-day bounded ranges', () => {
    render(<MemoryView />);
    expect(mocks.requestHistoryRange).toHaveBeenCalledWith('today');

    fireEvent.click(screen.getByRole('button', { name: '7 Tage' }));
    fireEvent.click(screen.getByRole('button', { name: '30 Tage' }));

    expect(mocks.requestHistoryRange).toHaveBeenCalledWith('7days');
    expect(mocks.requestHistoryRange).toHaveBeenCalledWith('30days');
  });

  it('shows an honest empty state without rendering a chart', () => {
    mocks.currentHistory = {
      range: 'today',
      status: 'no_history',
      recordingSince: null,
      lastRecordedAt: null,
      totalSamples: 0,
      points: [],
    };

    render(<MemoryView />);

    expect(screen.getByText('Für diesen Zeitraum wurden noch keine Energiedaten aufgezeichnet.')).toBeInTheDocument();
    expect(screen.queryByTestId('history-chart')).not.toBeInTheDocument();
  });
});
