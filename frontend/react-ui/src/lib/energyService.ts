import { PowerData, SystemStatus, DataState, TodayData } from '../types';
import { getBridge, initBridge } from './bridge';

// Helper to wrap raw values in DataState
function toDataState<T>(value: T | null | undefined, forceUnknown = false): DataState<T> {
  if (forceUnknown || value === null || value === undefined) {
    return { state: 'unknown' };
  }
  return { state: 'available', value };
}

// ── Observers ─────────────────────────────────────────────────────────────
export type Subscriber<T> = (data: T) => void;

class Observable<T> {
  private subscribers: Set<Subscriber<T>> = new Set();
  private lastValue: T;

  constructor(initial: T) {
    this.lastValue = initial;
  }

  get(): T {
    return this.lastValue;
  }

  set(value: T) {
    this.lastValue = value;
    this.subscribers.forEach((cb) => cb(value));
  }

  subscribe(cb: Subscriber<T>) {
    this.subscribers.add(cb);
    cb(this.lastValue); // deliver current state immediately
    return () => this.subscribers.delete(cb);
  }
}

// ── State Stores ─────────────────────────────────────────────────────────

export const nowData$ = new Observable<{ power: PowerData; status: SystemStatus }>({
  power: {
    solar: { state: 'loading' },
    grid: { state: 'loading' },
    home: { state: 'loading' },
    lastUpdated: null,
  },
  status: 'no_data',
});

export const todayData$ = new Observable<TodayData>({
  solarTotal: { state: 'loading' },
  homeTotal: { state: 'loading' },
  gridFeedInTotal: { state: 'loading' },
  gridDrawTotal: { state: 'loading' },
  selfSufficiency: { state: 'loading' },
  selfConsumption: { state: 'loading' },
  history: []
});

// ── Service Logic ────────────────────────────────────────────────────────

function processNowViewModel(raw: Record<string, any>) {
  // Python NowViewModel fields:
  // verdict_kind, pv_power_w, grid_power_w, consumption_w, data_quality, pin_locked, freshness_label
  const pv = typeof raw.pv_power_w === 'number' ? raw.pv_power_w : null;
  // NOTE: React grid was historically positive=feed-in, but Python models Grid as positive=draw, negative=feed-in.
  // We align with Python here: positive = grid draw (Bezug aus dem Netz).
  const grid = typeof raw.grid_power_w === 'number' ? raw.grid_power_w : null;
  const home = typeof raw.consumption_w === 'number' ? raw.consumption_w : null;
  const quality = raw.data_quality || 'no_source';

  // Determine system status
  let status: SystemStatus = 'no_data';
  if (raw.pin_locked === true) {
    status = 'meter_locked';
  } else if (quality === 'error') {
    status = 'error';
  } else if (quality === 'stale') {
    status = 'stale';
  } else if (quality === 'live') {
    status = 'live';
  }

  // Fallback if data quality is bad
  const forceUnknown = status === 'no_data' || status === 'error';

  const power: PowerData = {
    solar: toDataState(pv, forceUnknown),
    grid: toDataState(grid, forceUnknown),
    home: toDataState(home, forceUnknown),
    lastUpdated: raw.freshness_label || null,
  };

  nowData$.set({ power, status });
}

function processTodayViewModel(raw: Record<string, any>) {
  // Python fields: generated_kwh, consumption_kwh, import_total_kwh, export_total_kwh, self_consumption_pct, autarky_pct, history

  // Map history to typed array, formatting time to HH:MM locally
  const history = (raw.history || []).map((pt: any) => {
    let timeStr = "";
    if (pt.measured_at) {
      const dt = new Date(pt.measured_at);
      timeStr = dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    return {
      time: timeStr,
      solar: typeof pt.pv_power_w === 'number' ? pt.pv_power_w : null,
      home: typeof pt.home_power_w === 'number' ? pt.home_power_w : null,
      gridImport: typeof pt.grid_import_w === 'number' ? pt.grid_import_w : null,
      gridExport: typeof pt.grid_export_w === 'number' ? pt.grid_export_w : null,
    };
  });

  todayData$.set({
    solarTotal: toDataState(raw.generated_kwh),
    homeTotal: toDataState(raw.consumption_kwh),
    gridDrawTotal: toDataState(raw.import_total_kwh),
    gridFeedInTotal: toDataState(raw.export_total_kwh),
    selfConsumption: toDataState(raw.self_consumption_pct),
    selfSufficiency: toDataState(raw.autarky_pct),
    history
  });
}

export function startEnergyService() {
  initBridge().then((bridge) => {
    if (!bridge) {
      // Dev mode without Qt -> inject fake initial state instead of 0s
      console.info('[energyService] No bridge, using offline state');
      nowData$.set({
        power: {
          solar: { state: 'unknown' },
          grid: { state: 'unknown' },
          home: { state: 'unknown' },
          lastUpdated: null,
        },
        status: 'no_data'
      });
      return;
    }

    // Read initial values
    try {
      if (bridge.nowData) {
        processNowViewModel(JSON.parse(bridge.nowData));
      }
    } catch (e) {
      console.error('[energyService] initial parse error', e);
    }

    // Subscribe to live updates
    bridge.nowDataChanged.connect(() => {
      try {
        if (bridge.nowData) {
          processNowViewModel(JSON.parse(bridge.nowData));
        }
      } catch (e) {
        console.error('[energyService] live parse error', e);
      }
    });

    try {
      if (bridge.todayData) {
        processTodayViewModel(JSON.parse(bridge.todayData));
      }
    } catch (e) {
      console.error('[energyService] initial parse error today', e);
    }

    bridge.todayDataChanged.connect(() => {
      try {
        if (bridge.todayData) {
          processTodayViewModel(JSON.parse(bridge.todayData));
        }
      } catch (e) {
        console.error('[energyService] live parse error today', e);
      }
    });
  });
}
