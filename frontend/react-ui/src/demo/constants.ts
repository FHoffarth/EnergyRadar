import { EnergyValue, TimelineEntry, DemoDeviceSummary } from '../types';

export type DemoPresetId = 'sunny_midday' | 'evening_peak' | 'cloudy_heatpump' | 'partial_sensor_drop';

export interface DemoPreset {
  id: DemoPresetId;
  name: string;
  description: string;
  solarKw: number | null;
  homeLoadKw: number | null;
  gridKw: number | null;
  batteryPct: number | null;
  batteryFlowKw: number | null;
  origin: EnergyValue['origin'];
  label: string;
}

export const DEMO_PRESETS: Record<DemoPresetId, DemoPreset> = {
  sunny_midday: {
    id: 'sunny_midday',
    name: 'Sonniger Mittag (PV-Überschuss)',
    description: 'Volle PV-Erzeugung übersteigt Hausverbrauch. Demo-Szenario.',
    solarKw: 6.4,
    homeLoadKw: 2.1,
    gridKw: -2.8,
    batteryPct: 92,
    batteryFlowKw: 1.5,
    origin: 'simulated',
    label: 'Sonniger Mittag'
  },
  evening_peak: {
    id: 'evening_peak',
    name: 'Abendspitze (Batteriebetrieb)',
    description: 'Sonne untergegangen. Haus wird aus der Batterie versorgt. Demo-Szenario.',
    solarKw: 0.0,
    homeLoadKw: 3.8,
    gridKw: 0.0,
    batteryPct: 74,
    batteryFlowKw: -3.8,
    origin: 'simulated',
    label: 'Abendspitze'
  },
  cloudy_heatpump: {
    id: 'cloudy_heatpump',
    name: 'Bedeckt & Wärmepumpe',
    description: 'Bewölkung dämpft PV-Ertrag. Demo-Szenario.',
    solarKw: 0.8,
    homeLoadKw: 4.2,
    gridKw: 3.4,
    batteryPct: 35,
    batteryFlowKw: 0.0,
    origin: 'simulated',
    label: 'Bedeckt & Wärmepumpe'
  },
  partial_sensor_drop: {
    id: 'partial_sensor_drop',
    name: 'Teilweiser Sensor-Ausfall (Demo)',
    description: 'Demonstriert Umgang mit unvollständigen Messwerten.',
    solarKw: 1.4,
    homeLoadKw: 2.6,
    gridKw: null,
    batteryPct: 45,
    batteryFlowKw: null,
    origin: 'unavailable',
    label: 'Sensor-Ausfall'
  }
};

export const DEMO_TIMELINE: TimelineEntry[] = [
  { time: '00:00', solarKw: 0, homeLoadKw: 0.35, gridKw: 0.35, batteryPct: 55, origin: 'simulated' },
  { time: '02:00', solarKw: 0, homeLoadKw: 0.28, gridKw: 0.28, batteryPct: 52, origin: 'simulated' },
  { time: '04:00', solarKw: 0, homeLoadKw: 0.26, gridKw: 0.26, batteryPct: 49, origin: 'simulated' },
  { time: '06:00', solarKw: 0.1, homeLoadKw: 0.85, gridKw: 0.75, batteryPct: 48, origin: 'simulated' },
  { time: '08:00', solarKw: 1.8, homeLoadKw: 1.4, gridKw: -0.4, batteryPct: 52, origin: 'simulated' },
  { time: '10:00', solarKw: 4.5, homeLoadKw: 1.8, gridKw: -2.7, batteryPct: 68, origin: 'simulated' },
  { time: '12:00', solarKw: 6.8, homeLoadKw: 2.2, gridKw: -4.6, batteryPct: 88, origin: 'simulated' },
  { time: '14:00', solarKw: 6.4, homeLoadKw: 2.1, gridKw: -4.3, batteryPct: 98, origin: 'simulated' },
  { time: '16:00', solarKw: 3.2, homeLoadKw: 2.9, gridKw: -0.3, batteryPct: 100, origin: 'simulated' },
  { time: '17:00', solarKw: 0.8, homeLoadKw: 3.6, gridKw: 0.0, batteryPct: 96, origin: 'simulated' },
  { time: '19:00', solarKw: 0.0, homeLoadKw: 4.1, gridKw: 0.0, batteryPct: 78, origin: 'simulated' },
  { time: '21:00', solarKw: 0.0, homeLoadKw: 2.2, gridKw: 0.0, batteryPct: 65, origin: 'simulated' },
  { time: '23:00', solarKw: 0.0, homeLoadKw: 0.6, gridKw: 0.0, batteryPct: 58, origin: 'simulated' }
];

export const DEMO_DEVICES: DemoDeviceSummary[] = [
  {
    id: 'demo_solar',
    name: 'PV-Anlage (Demo)',
    category: 'PV & Speicher',
    status: 'active',
    powerWatts: 6400,
    origin: 'simulated',
    lastSeen: 'Demo-Szenario',
    smartShedEnabled: false,
    notes: 'Simulierte PV-Anlage im Demo-Modus. Keine echte Verbindung.',
    iconName: 'Sun'
  },
  {
    id: 'demo_battery',
    name: 'Heimspeicher (Demo)',
    category: 'PV & Speicher',
    status: 'active',
    powerWatts: 1500,
    origin: 'simulated',
    lastSeen: 'Demo-Szenario',
    smartShedEnabled: false,
    notes: 'Simulierter Batteriespeicher. Alle Werte aus Demo-Szenario.',
    iconName: 'BatteryCharging'
  },
  {
    id: 'demo_ev',
    name: 'Wallbox E-Auto (Demo)',
    category: 'E-Mobilität',
    status: 'active',
    powerWatts: 1400,
    origin: 'simulated',
    lastSeen: 'Demo-Szenario',
    smartShedEnabled: true,
    notes: 'Dynamisch an PV-Überschuss im Demo-Szenario angepasst.',
    iconName: 'Zap'
  },
  {
    id: 'demo_heatpump',
    name: 'Wärmepumpe (Demo)',
    category: 'Klima & Heizung',
    status: 'active',
    powerWatts: 850,
    origin: 'simulated',
    lastSeen: 'Demo-Szenario',
    smartShedEnabled: true,
    notes: 'Inverter-Modulation im Demo-Modell.',
    iconName: 'Thermometer'
  }
];

export const DEMO_ASSESSMENT_VERDICTS: Record<string, { headline: string; summary: string }> = {
  sunny_midday: {
    headline: 'PV-Erzeugung deckt den Hausverbrauch',
    summary: 'Nach dem Hausverbrauch stehen 4,3 kW zur Verfügung: 1,5 kW laden den Speicher, 2,8 kW werden ins Netz eingespeist.'
  },
  evening_peak: {
    headline: 'Heimspeicher unterstützt den Hausverbrauch',
    summary: 'Der Hausverbrauch (3,8 kW) wird aktuell mit 3,8 kW aus der Batterie (74 % Ladung) unterstützt.'
  },
  cloudy_heatpump: {
    headline: 'Netzbezug zur Deckung der Last',
    summary: 'Bei einer PV-Erzeugung von 0,8 kW und einer Hauslast von 4,2 kW werden derzeit 3,4 kW aus dem Stromnetz bezogen.'
  },
  partial_sensor_drop: {
    headline: 'Unvollständige Sensor-Telemetrie',
    summary: 'Es liegen derzeit nicht alle primären Leistungsmesswerte vor. Der Hausstatus kann nicht vollständig berechnet werden.'
  }
};
