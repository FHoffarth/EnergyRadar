import React from 'react';
import { Sun, Home, Zap, BatteryMedium, ArrowDown, ArrowRight, ArrowLeft } from 'lucide-react';
import { EnergySnapshot } from '../../types';
import { NumberLocale, UNKNOWN_VALUE, formatKw, formatNumber } from '../../lib/format';
import { buildFlowModel, EnergyFlowModel, FlowNodeModel, GridDirection } from '../../lib/flowModel';

/**
 * The Jetzt centrepiece: a calm, mostly-static diagram of the house's energy
 * relationship. Sun above, house as the central protagonist, grid to the side,
 * battery only when real data exists. Direction is legible without colour —
 * arrow geometry and a word carry it; colour only reinforces. Numbers annotate
 * the nodes; they are not equal metric cards.
 */

type Tone = 'solar' | 'house' | 'import' | 'export' | 'neutral' | 'unknown';

const TONE_VALUE: Record<Tone, string> = {
  solar: 'tone-solar',
  house: 'tone-house',
  import: 'tone-import',
  export: 'tone-export',
  neutral: 'tone-neutral',
  unknown: 'tone-unknown',
};

function NodeValue({ node, tone, locale }: { node: FlowNodeModel; tone: Tone; locale: NumberLocale }) {
  if (node.state === 'unknown' || node.valueKw === null) {
    return <span className={`flow-node__value ${TONE_VALUE.unknown}`}>{UNKNOWN_VALUE}</span>;
  }
  const magnitude = Math.abs(node.valueKw);
  return (
    <span className={`flow-node__value ${TONE_VALUE[tone]}`}>
      {formatKw(magnitude, locale)}
      <span className="flow-node__unit">kW</span>
    </span>
  );
}

function FlowNode({
  icon: Icon, label, node, tone, caption, protagonist = false, locale,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  node: FlowNodeModel;
  tone: Tone;
  caption: string;
  protagonist?: boolean;
  locale: NumberLocale;
}) {
  const unknown = node.state === 'unknown';
  return (
    <div className={`flow-node${protagonist ? ' flow-node--protagonist' : ''}${unknown ? ' flow-node--unknown' : ''}`}>
      <span className="flow-node__label">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <NodeValue node={node} tone={unknown ? 'unknown' : tone} locale={locale} />
      <span className="flow-node__caption">{caption}</span>
    </div>
  );
}

function Connector({
  orientation, active, direction, label,
}: {
  orientation: 'vertical' | 'horizontal';
  active: boolean;
  /** 'down' for solar; 'right' import; 'left' export; 'none' idle/unknown. */
  direction: 'down' | 'right' | 'left' | 'none';
  label: string | null;
}) {
  const Arrow = direction === 'down' ? ArrowDown : direction === 'right' ? ArrowRight : direction === 'left' ? ArrowLeft : null;
  return (
    <div
      className={`flow-conn flow-conn--${orientation} ${active ? 'flow-conn--active' : 'flow-conn--idle'}`}
      aria-hidden="true"
    >
      <span className="flow-conn__line" />
      {Arrow && active ? (
        <span className="flow-conn__arrow flow-conn__arrow--active">
          <Arrow className="h-4 w-4" />
        </span>
      ) : (
        <span className="flow-conn__line" />
      )}
      {label && <span className="flow-conn__label">{label}</span>}
    </div>
  );
}

function gridCaption(direction: GridDirection): string {
  switch (direction) {
    case 'import': return 'Bezug';
    case 'export': return 'Einspeisung';
    case 'none': return 'Kein Austausch';
    default: return 'Nicht verfügbar';
  }
}

function gridTone(direction: GridDirection): Tone {
  switch (direction) {
    case 'import': return 'import';
    case 'export': return 'export';
    case 'none': return 'neutral';
    default: return 'unknown';
  }
}

export function EnergyFlow({ snapshot, locale }: { snapshot: EnergySnapshot; locale: NumberLocale }) {
  const model: EnergyFlowModel = buildFlowModel(snapshot, locale);
  const { pv, house, grid, battery } = model;

  const pvCaption = pv.state === 'unknown' ? 'Nicht verfügbar' : pv.state === 'zero' ? 'Keine Erzeugung' : 'Gemessen';
  const houseCaption = house.state === 'unknown' ? 'Nicht verfügbar' : 'Gemessen';

  const gridNode = (
    <FlowNode icon={Zap} label="Netz" node={grid} tone={gridTone(grid.direction)} caption={gridCaption(grid.direction)} locale={locale} />
  );

  // Layout: the house is the central protagonist — PV sits directly above it,
  // the grid to its left, the battery (when real) to its right. When there is
  // no battery, a hidden mirror of the grid keeps the house centred rather than
  // letting it drift right.
  return (
    <section aria-label="Momentane Leistungswerte" className="flow" data-testid="energy-flow">
      <p className="sr-only" data-testid="flow-summary">{model.accessibleSummary}</p>
      <div className="flow-diagram">
        {/* PV — above the house */}
        <div className="flow-row">
          <FlowNode icon={Sun} label="PV" node={pv} tone="solar" caption={pvCaption} locale={locale} />
        </div>
        {/* Sun → house */}
        <div className="flow-row">
          <Connector orientation="vertical" active={model.solarActive} direction={model.solarActive ? 'down' : 'none'} label={model.solarActive ? 'Solar' : null} />
        </div>
        {/* Grid — house — battery (or balancing mirror) */}
        <div className="flow-row flow-row--main">
          {gridNode}
          <Connector
            orientation="horizontal"
            active={model.gridActive}
            direction={grid.direction === 'import' ? 'right' : grid.direction === 'export' ? 'left' : 'none'}
            label={grid.direction === 'import' ? 'Bezug' : grid.direction === 'export' ? 'Einspeisung' : null}
          />
          <FlowNode icon={Home} label="Haus" node={house} tone="house" caption={houseCaption} protagonist locale={locale} />
          {battery ? (
            <>
              <Connector
                orientation="horizontal"
                active={battery.flow === 'charge' || battery.flow === 'discharge'}
                direction={battery.flow === 'charge' ? 'right' : battery.flow === 'discharge' ? 'left' : 'none'}
                label={battery.flow === 'charge' ? 'Laden' : battery.flow === 'discharge' ? 'Entladen' : null}
              />
              <FlowNode
                icon={BatteryMedium}
                label="Speicher"
                node={battery}
                tone="neutral"
                caption={battery.chargePercent !== null ? `${formatNumber(battery.chargePercent, locale)} % Ladung` : 'Speicher'}
                locale={locale}
              />
            </>
          ) : (
            <span className="flow-mirror" aria-hidden="true">
              <Connector orientation="horizontal" active={false} direction="none" label={null} />
              {gridNode}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
