import { describe, expect, it } from 'vitest';
import { historyData$, processHistoryViewModel, requestHistoryRange } from '../lib/energyService';

describe('history bridge normalization', () => {
  it('preserves negative, zero, null and quality metadata', () => {
    processHistoryViewModel({
      range: '7days',
      status: 'partial',
      recording_since_utc: '2026-07-31T10:00:00Z',
      last_recorded_at_utc: '2026-07-31T10:02:00Z',
      total_samples: 3,
      points: [
        { timestamp_utc: '2026-07-31T10:00:00Z', pv_power_w: 1100, house_power_w: 211, grid_power_w: -789, quality_state: 'derived', source_name: 'EnergyRadar', gap: false },
        { timestamp_utc: '2026-07-31T10:01:00Z', pv_power_w: 0, house_power_w: 0, grid_power_w: 0, quality_state: 'derived', source_name: 'EnergyRadar', gap: false },
        { timestamp_utc: '2026-07-31T10:02:00Z', pv_power_w: null, house_power_w: null, grid_power_w: null, quality_state: 'missing', source_name: 'EnergyRadar', gap: true },
      ],
    });

    const result = historyData$.get();
    expect(result.range).toBe('7days');
    expect(result.points[0].gridKw).toBe(-0.789);
    expect(result.points[1].gridKw).toBe(0);
    expect(result.points[2].gridKw).toBeNull();
    expect(result.points[2].gap).toBe(true);
    expect(result.points[2].quality).toBe('missing');
  });

  it('ignores an out-of-order response after a range switch', () => {
    void requestHistoryRange('30days');
    processHistoryViewModel({
      range: 'today',
      status: 'available',
      total_samples: 1,
      points: [{ timestamp_utc: '2026-07-31T10:00:00Z', grid_power_w: 100 }],
    });

    expect(historyData$.get().range).toBe('30days');
    expect(historyData$.get().status).toBe('loading');
  });
});
