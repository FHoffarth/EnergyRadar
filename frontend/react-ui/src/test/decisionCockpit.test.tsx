import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AutarkieGauge } from '../components/decision/AutarkieGauge';
import { DailyVerdict } from '../components/decision/DailyVerdict';
import { EconomicHero } from '../components/decision/EconomicHero';
import { LivePvGauge } from '../components/decision/LivePvGauge';
import { economyHero, economyReasonCopy, livePvState, verdictTone } from '../lib/decisionView';
import { DailyAssessment } from '../types';

const locale = 'de-DE' as const;

function assessment(over: Partial<DailyAssessment>): DailyAssessment {
  return { assessable: true, assessment_class: 'strong', trust: 'complete',
    headline: 'Ein überwiegend autarker Energietag.', sentence: '70 % des Strombedarfs …', reason: null, ...over };
}

describe('AutarkieGauge', () => {
  it('exposes an accessible meter with the real value', () => {
    render(<AutarkieGauge pct={87} tone={verdictTone('excellent')} />);
    const meter = screen.getByRole('meter', { name: 'Autarkiegrad' });
    expect(meter.getAttribute('aria-valuenow')).toBe('87');
    expect(meter.getAttribute('aria-valuetext')).toMatch(/87 Prozent/);
    expect(screen.getByText('87')).toBeTruthy();
  });
  it('renders unknown as intentional, never as 0 %', () => {
    render(<AutarkieGauge pct={null} tone={verdictTone(null)} />);
    expect(screen.getByRole('img', { name: 'Autarkiegrad nicht bewertbar' })).toBeTruthy();
    expect(screen.getByText('Nicht bewertbar')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});

describe('DailyVerdict', () => {
  it('renders each class with its headline and data attributes', () => {
    const { rerender } = render(<DailyVerdict assessment={assessment({ assessment_class: 'excellent', headline: 'Ein weitgehend autarker Energietag.' })} />);
    expect(screen.getByTestId('daily-verdict').getAttribute('data-class')).toBe('excellent');
    rerender(<DailyVerdict assessment={assessment({ assessment_class: 'grid_dependent', headline: 'Ein netzgeprägter Energietag.' })} />);
    expect(screen.getByText('Ein netzgeprägter Energietag.')).toBeTruthy();
  });
  it('marks partial trust without changing the class', () => {
    render(<DailyVerdict assessment={assessment({ assessment_class: 'excellent', trust: 'partial' })} />);
    const el = screen.getByTestId('daily-verdict');
    expect(el.getAttribute('data-class')).toBe('excellent');
    expect(el.getAttribute('data-trust')).toBe('partial');
    expect(screen.getByText(/Vorläufig/)).toBeTruthy();
  });
  it('renders not-assessable honestly', () => {
    render(<DailyVerdict assessment={assessment({ assessable: false, assessment_class: null, trust: 'not_assessable', headline: 'Noch nicht bewertbar' })} />);
    expect(screen.getByText('Noch nicht bewertbar')).toBeTruthy();
  });
});

function economy(results: any, reason: string | null = null): any {
  return { results, reason };
}

describe('EconomicHero — value-first, precise reasons', () => {
  it('leads with the total value and breaks down both components', () => {
    render(<EconomicHero locale={locale} report={economy({
      solar_economic_value: { value_eur: '2.34' }, avoided_grid_cost: { value_eur: '1.50' }, feed_in_remuneration: { value_eur: '0.84' },
    })} />);
    expect(screen.getByTestId('economic-hero').getAttribute('data-has-value')).toBe('true');
    expect(screen.getByText(/2,34/)).toBeTruthy();
    expect(screen.getByText('Vermiedener Netzbezug')).toBeTruthy();
    expect(screen.getByText('Einspeisevergütung')).toBeTruthy();
  });
  it('lifts the known feed-in value big when the total is not assessable, tariff reason stays calm', () => {
    // No grid tariff → total & avoided unavailable, but feed-in is known.
    render(<EconomicHero locale={locale} report={economy({
      solar_economic_value: { value_eur: null, reason: 'grid_tariff_missing_or_boundary' },
      avoided_grid_cost: { value_eur: null, reason: 'grid_tariff_missing_or_boundary' },
      feed_in_remuneration: { value_eur: '1.36' },
    })} />);
    // The euro value leads; the missing part is a compact, precise line — no red error.
    expect(screen.getByText(/1,36/)).toBeTruthy();
    expect(screen.getAllByText('Einspeisevergütung').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Vermiedener Netzbezug')).toBeTruthy();
    expect(screen.getByText('Stromtarif nicht hinterlegt')).toBeTruthy();
    // The long duplicate "keine belastbare Bewertung" paragraph is gone.
    expect(screen.queryByTestId('economic-reason')).toBeNull();
    expect(screen.queryByText(/keine belastbare/)).toBeNull();
  });
  it('falls back to the precise reason only when no euro value exists at all', () => {
    render(<EconomicHero locale={locale} report={economy({
      solar_economic_value: { value_eur: null, reason: 'grid_tariff_missing_or_boundary' },
    })} />);
    expect(screen.getByTestId('economic-reason').textContent).toMatch(/kein gültiger Stromtarif hinterlegt/);
    expect(screen.queryByText(/grid_tariff_missing_or_boundary/)).toBeNull();
  });
});

describe('LivePvGauge — 2.85 kWp secondary states', () => {
  it('shows live power vs configured capacity', () => {
    render(<LivePvGauge locale={locale} powerKw={1.42} capacityKwp={2.85} state="live" />);
    expect(screen.getByText(/1,42 kW von 2,85 kWp/)).toBeTruthy();
  });
  it('shows night standby, never 0 % as a fault', () => {
    render(<LivePvGauge locale={locale} powerKw={null} capacityKwp={2.85} state="night" />);
    expect(screen.getByText(/Nachtbetrieb · Aktuelle PV-Leistung pausiert/)).toBeTruthy();
  });
  it('is hidden entirely when capacity is not configured (never inferred)', () => {
    const { container } = render(<LivePvGauge locale={locale} powerKw={1.0} capacityKwp={null} state="live" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('decisionView helpers', () => {
  it('economyReasonCopy maps codes and has a safe default', () => {
    expect(economyReasonCopy('feed_in_tariff_missing_or_boundary')).toMatch(/Einspeisevergütung/);
    expect(economyReasonCopy('anything_else')).toMatch(/keine belastbare/);
  });
  it('economyHero extracts figures and reasons', () => {
    const h = economyHero(economy({ solar_economic_value: { value_eur: '2.0' }, avoided_grid_cost: { value_eur: null, reason: 'grid_tariff_missing_or_boundary' } }));
    expect(h.total).toBe(2.0);
    expect(h.avoided).toBeNull();
    expect(h.avoidedReason).toBe('grid_tariff_missing_or_boundary');
  });
  it('livePvState treats night 0 W as standby, not unavailable', () => {
    expect(livePvState(null, undefined, undefined, new Date('2026-08-03T23:30:00'))).toBe('night');
    expect(livePvState(1.2, 'observed', 'live', new Date('2026-08-03T12:00:00'))).toBe('live');
    expect(livePvState(null, undefined, 'stale', new Date('2026-08-03T12:00:00'))).toBe('stale');
    expect(livePvState(null, undefined, undefined, new Date('2026-08-03T12:00:00'))).toBe('unavailable');
  });
});
