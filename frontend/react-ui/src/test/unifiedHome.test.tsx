import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AutarkieGauge } from '../components/decision/AutarkieGauge';
import { AutarkieBar } from '../components/decision/AutarkieBar';
import { EnergyBalanceStory } from '../components/decision/EnergyBalanceStory';
import { LiveEnergyStrip } from '../components/decision/LiveEnergyStrip';
import { TodayData, EnergySnapshot } from '../types';

const locale = 'de-DE' as const;

describe('AutarkieGauge — warm solar arc (not funeral-grey)', () => {
  it('uses a warm amber active arc, never a grey one', () => {
    render(<AutarkieGauge pct={57} tone="text-slate-800" />);
    const arc = screen.getByTestId('gauge-arc');
    expect(arc.getAttribute('class')).toMatch(/stroke-amber/);
    expect(arc.getAttribute('class')).not.toMatch(/stroke-slate/);
  });
  it('keeps the unknown state quiet and intentional', () => {
    render(<AutarkieGauge pct={null} tone="" />);
    expect(screen.getByText('Nicht bewertbar')).toBeTruthy();
    expect(screen.queryByTestId('gauge-arc')).toBeNull();
  });
});

function today(over: Partial<TodayData>): TodayData {
  return {
    solarTotal: { state: 'available', value: 12.8 },
    homeTotal: { state: 'available', value: 7.2 },
    gridFeedInTotal: { state: 'available', value: 9.2 },
    gridDrawTotal: { state: 'available', value: 3.6 },
    selfSufficiency: { state: 'available', value: 57 },
    selfConsumption: { state: 'available', value: 28 },
    history: [], ...over,
  };
}

describe('AutarkieBar — compact horizontal autonomy (Variante B)', () => {
  it('shows the percentage, an accessible meter, and the Solar/Netz relation', () => {
    render(<AutarkieBar pct={46} solarKwh={3.5} gridKwh={4.1} locale={locale} />);
    const meter = screen.getByRole('meter', { name: 'Autarkiegrad' });
    expect(meter.getAttribute('aria-valuenow')).toBe('46');
    expect(meter.getAttribute('aria-valuetext')).toMatch(/46 Prozent solar, 54 Prozent aus dem Netz/);
    expect(screen.getByText('46')).toBeTruthy();
    // Solar and grid shares named in text, not colour-only.
    expect(screen.getByText('Solar selbst genutzt')).toBeTruthy();
    expect(screen.getByText('Netzbezug')).toBeTruthy();
  });
  it('keeps the unknown state intentional, not 0 %', () => {
    render(<AutarkieBar pct={null} solarKwh={null} gridKwh={null} locale={locale} />);
    expect(screen.getByText('Nicht bewertbar')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('EnergyBalanceStory — unambiguous labels', () => {
  it('distinguishes self-consumed PV from total house consumption', () => {
    render(<EnergyBalanceStory data={today({})} locale={locale} />);
    expect(screen.getByText('PV-Erzeugung')).toBeTruthy();
    expect(screen.getByText('Solarstrom selbst genutzt')).toBeTruthy();
    expect(screen.getByText('Hausverbrauch gesamt')).toBeTruthy();
    expect(screen.getByText('Netzbezug')).toBeTruthy();
    expect(screen.getByText('Einspeisung')).toBeTruthy();
    // No ambiguous "im Haus genutzt".
    expect(screen.queryByText(/im Haus genutzt/)).toBeNull();
    // self-consumed = 12.8 − 9.2 = 3.6, distinct from total consumption 7.2.
    expect(screen.getByTestId('balance-selfused').textContent).toMatch(/3,6/);
    expect(screen.getByTestId('balance-consumed').textContent).toMatch(/7,2/);
  });
});

function snapshot(over: Partial<EnergySnapshot>): EnergySnapshot {
  return {
    timestamp: null, quality: 'live',
    solar: { valueKw: 1.2, origin: 'observed' },
    homeLoad: { valueKw: 0.8, origin: 'observed' },
    grid: { valueKw: -0.4, origin: 'observed' },
    battery: null, assessment: null, warnings: [], ...over,
  } as EnergySnapshot;
}

describe('LiveEnergyStrip — compact live state', () => {
  it('shows PV, house and grid direction with a live status', () => {
    render(<LiveEnergyStrip snapshot={snapshot({})} locale={locale} />);
    expect(screen.getByTestId('live-status').textContent).toBe('Live');
    expect(screen.getByTestId('live-pv').textContent).toMatch(/1,20 kW/);
    // Negative grid → feed-in, shown as magnitude.
    expect(screen.getByTestId('live-grid').textContent).toMatch(/Einspeisung/);
    expect(screen.getByTestId('live-grid').textContent).toMatch(/0,40 kW/);
  });
  it('is honest when there is no live data', () => {
    render(<LiveEnergyStrip snapshot={snapshot({ quality: 'unavailable', solar: { valueKw: null, origin: 'unavailable' } })} locale={locale} />);
    expect(screen.getByTestId('live-pv').textContent).toMatch(/—/);
  });
});
