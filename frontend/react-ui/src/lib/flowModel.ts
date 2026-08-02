/**
 * The energy-flow model for Jetzt.
 *
 * Flow is the centre of the page, not a card. This module turns a snapshot
 * into a directional relationship — sun → house → grid (and battery only when
 * real data exists) — that can be read without colour: every edge carries a
 * geometric direction and a word ("Bezug" / "Einspeisung" / "Solar").
 *
 * Trust rules from the Design Constitution are enforced here, not in the view:
 * a value counts only when the meter actually observed it; a valid zero stays
 * zero; unknown stays unknown and is never rendered as zero.
 */
import { EnergySnapshot } from '../types';
import { NumberLocale, formatKw } from './format';

export type NodeState = 'measured' | 'zero' | 'unknown';
export type GridDirection = 'import' | 'export' | 'none' | 'unknown';

export interface FlowNodeModel {
  valueKw: number | null;
  state: NodeState;
}

export interface GridNodeModel extends FlowNodeModel {
  direction: GridDirection;
}

export interface BatteryNodeModel extends FlowNodeModel {
  /** State of charge in percent when the device reports it. */
  chargePercent: number | null;
  /** 'charge' (into battery), 'discharge' (out), or 'idle'. */
  flow: 'charge' | 'discharge' | 'idle' | 'unknown';
}

export interface EnergyFlowModel {
  pv: FlowNodeModel;
  house: FlowNodeModel;
  grid: GridNodeModel;
  battery: BatteryNodeModel | null;
  /** Sun → house edge is active only while PV genuinely produces. */
  solarActive: boolean;
  /** Grid edge is active while importing or exporting. */
  gridActive: boolean;
  /** Full non-visual description of the current state, for screen readers. */
  accessibleSummary: string;
}

function isMeasured(value: { valueKw: number | null; origin: string }): boolean {
  return value.origin === 'observed' && value.valueKw !== null && Number.isFinite(value.valueKw);
}

function nodeState(value: { valueKw: number | null; origin: string }): NodeState {
  if (!isMeasured(value)) return 'unknown';
  return value.valueKw === 0 ? 'zero' : 'measured';
}

function kw(value: number, locale: NumberLocale): string {
  return `${formatKw(value, locale)} kW`;
}

export function buildFlowModel(snapshot: EnergySnapshot, locale: NumberLocale): EnergyFlowModel {
  const pv: FlowNodeModel = { valueKw: snapshot.solar.valueKw, state: nodeState(snapshot.solar) };
  const house: FlowNodeModel = { valueKw: snapshot.homeLoad.valueKw, state: nodeState(snapshot.homeLoad) };

  const gridState = nodeState(snapshot.grid);
  const gridKw = snapshot.grid.valueKw;
  const direction: GridDirection =
    gridState === 'unknown' ? 'unknown'
    : gridKw !== null && gridKw > 0 ? 'import'
    : gridKw !== null && gridKw < 0 ? 'export'
    : 'none';
  const grid: GridNodeModel = { valueKw: gridKw, state: gridState, direction };

  let battery: BatteryNodeModel | null = null;
  const rawBattery = snapshot.battery;
  if (rawBattery && rawBattery.powerKw !== null && Number.isFinite(rawBattery.powerKw)) {
    const power = rawBattery.powerKw;
    battery = {
      valueKw: power,
      state: power === 0 ? 'zero' : 'measured',
      chargePercent: rawBattery.stateOfChargePercent,
      // Convention: positive power charges the battery, negative discharges it.
      flow: power > 0 ? 'charge' : power < 0 ? 'discharge' : 'idle',
    };
  }

  const solarActive = pv.state === 'measured' && (pv.valueKw ?? 0) > 0;
  const gridActive = direction === 'import' || direction === 'export';

  // ── Non-visual summary ─────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(pv.state === 'unknown' ? 'Solar ist nicht verfügbar' : `Solar erzeugt ${kw(pv.valueKw as number, locale)}`);
  parts.push(house.state === 'unknown' ? 'der Hausverbrauch ist nicht verfügbar' : `das Haus verbraucht ${kw(house.valueKw as number, locale)}`);
  if (grid.state === 'unknown') {
    parts.push('der Netzaustausch ist nicht verfügbar');
  } else if (direction === 'import') {
    parts.push(`${kw(Math.abs(gridKw as number), locale)} werden aus dem Netz bezogen`);
  } else if (direction === 'export') {
    parts.push(`${kw(Math.abs(gridKw as number), locale)} werden ins Netz eingespeist`);
  } else {
    parts.push('es findet kein Netzaustausch statt');
  }
  if (battery) {
    const label = battery.flow === 'charge' ? 'der Speicher lädt' : battery.flow === 'discharge' ? 'der Speicher entlädt' : 'der Speicher ruht';
    parts.push(battery.chargePercent !== null ? `${label} bei ${battery.chargePercent}% Ladung` : label);
  }
  const joined = parts.join('. ');
  const accessibleSummary = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;

  return { pv, house, grid, battery, solarActive, gridActive, accessibleSummary };
}
