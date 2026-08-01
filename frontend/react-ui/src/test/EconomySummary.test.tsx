import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EconomySummary } from '../components/EconomySummary';
import { EconomyReportData } from '../types';

function report(overrides: Partial<EconomyReportData> = {}): EconomyReportData {
  return {
    period: { from: '2026-03-04T00:00:00+01:00', to: '2026-03-04T12:00:00+01:00' },
    calculated_at: '2026-03-04T11:00:00Z', coverage_state: 'complete', provisional: false,
    energy_basis: {},
    tariffs: {
      grid_work_price: { id: 1, tariff_type: 'grid_work_price', value_ct_per_kwh: '34.00', annual_eur: null, valid_from: '2026-01-01', valid_until: null, label: 'Vertrag', source_type: 'contract', provisional: false },
      feed_in_tariff: { id: 2, tariff_type: 'feed_in_tariff', value_ct_per_kwh: '12.00', annual_eur: null, valid_from: '2026-01-01', valid_until: null, label: null, source_type: 'provisional_user_assumption', provisional: false },
      base_price: { id: 3, tariff_type: 'base_price', value_ct_per_kwh: null, annual_eur: '120', valid_from: '2026-01-01', valid_until: null, label: null, source_type: 'invoice', provisional: false },
    },
    results: {
      grid_import_cost: { value_eur: '0.74', coverage_state: 'complete', formula: 'import', reason: null },
      feed_in_remuneration: { value_eur: '0.32', coverage_state: 'complete', formula: 'feed', reason: null },
      avoided_grid_cost: { value_eur: '1.82', coverage_state: 'complete', formula: 'avoided', reason: null },
      solar_economic_value: { value_eur: '2.14', coverage_state: 'complete', formula: 'avoided_grid_cost + feed_in_remuneration', reason: null },
      net_variable_energy_position: { value_eur: '1.40', coverage_state: 'complete', formula: 'net', reason: null },
    },
    exclusions: ['base_price_not_avoidable'], ...overrides,
  };
}

describe('EconomySummary', () => {
  it('renders a complete estimate, formula details and base-price exclusion', () => {
    render(<EconomySummary report={report()} locale="de-DE" />);
    expect(screen.getByText(/2,14\s*€/)).toBeInTheDocument();
    expect(screen.getByText('Vermiedene Stromkosten')).toBeInTheDocument();
    screen.getByText('Berechnungsdetails').click();
    expect(screen.getByRole('heading', { name: 'Wirtschaftlicher Solarwert heute' })).toBeInTheDocument();
    expect(screen.getByText('Der Grundpreis bleibt unberücksichtigt, weil er unabhängig vom Verbrauch anfällt.')).toBeInTheDocument();
    expect(screen.getByText(/Formel Solarwert: vermiedene Stromkosten \+ geschätzte Einspeisevergütung/)).toBeInTheDocument();
    expect(screen.getByText('Grundpreis (nur Kontext)')).toBeInTheDocument();
    expect(screen.getByText(/120 €\/Jahr/)).toBeInTheDocument();
  });

  it('uses partial wording and visibly labels provisional tariffs', () => {
    render(<EconomySummary report={report({ coverage_state: 'partial', provisional: true })} locale="de-DE" />);
    expect(screen.getByRole('heading', { name: 'Wirtschaftlicher Solarwert im erfassten Zeitraum' })).toBeInTheDocument();
    expect(screen.getByText('Keine Hochrechnung auf nicht erfasste Zeiträume.')).toBeInTheDocument();
    expect(screen.getByText(/Vorläufiger Wert/)).toBeInTheDocument();
  });

  it('renders the exact partial-period Decimal fixture as 1.22 EUR', () => {
    const fixture = report({ coverage_state: 'partial' });
    fixture.results.grid_import_cost.value_eur = '0.4794';
    fixture.results.avoided_grid_cost.value_eur = '0.7446';
    fixture.results.feed_in_remuneration.value_eur = '0.4716';
    fixture.results.solar_economic_value.value_eur = '1.2162';
    render(<EconomySummary report={fixture} locale="de-DE" />);
    expect(screen.getByText(/1,22\s*€/)).toBeInTheDocument();
  });

  it('keeps a valid zero distinct from unavailable', () => {
    const zero = report(); zero.results.solar_economic_value.value_eur = '0.00';
    const { rerender } = render(<EconomySummary report={zero} locale="de-DE" />);
    expect(screen.getByText(/0,00\s*€/)).toBeInTheDocument();
    const unavailable = report(); unavailable.results.solar_economic_value.value_eur = null; unavailable.coverage_state = 'unavailable';
    rerender(<EconomySummary report={unavailable} locale="de-DE" />);
    expect(screen.getByText('Für diesen Zeitraum ist keine belastbare Berechnung möglich.')).toBeInTheDocument();
    expect(screen.queryByText(/0,00\s*€/)).not.toBeInTheDocument();
  });

  it('does not imply a missing feed-in tariff is zero', () => {
    const missing = report();
    missing.results.solar_economic_value.value_eur = null;
    missing.results.solar_economic_value.reason = 'feed_in_tariff_missing_or_boundary';
    missing.results.feed_in_remuneration.value_eur = null;
    missing.tariffs.feed_in_tariff = null;
    render(<EconomySummary report={missing} locale="de-DE" />);
    expect(screen.getByText('Der Einspeisetarif ist nicht für den gesamten erfassten Zeitraum bestätigt.')).toBeInTheDocument();
  });

  it('shows the precise energy rejection without claiming valid tariffs are missing', () => {
    const unavailable = report({ coverage_state: 'unavailable', reason: 'energy_period_mismatch' });
    unavailable.results.solar_economic_value.value_eur = null;
    unavailable.results.solar_economic_value.reason = 'energy_period_mismatch';
    render(<EconomySummary report={unavailable} locale="de-DE" />);
    expect(screen.getByText('PV-Erzeugung und Einspeisung beziehen sich nicht auf denselben erfassten Zeitraum.')).toBeInTheDocument();
    expect(screen.queryByText(/Tarifdaten fehlen/i)).not.toBeInTheDocument();
    expect(screen.getByText(/34.00 ct\/kWh/)).toBeInTheDocument();
    expect(screen.getByText(/12.00 ct\/kWh/)).toBeInTheDocument();
  });

  it('labels a provisional base price only as context', () => {
    const provisionalBase = report();
    provisionalBase.tariffs.base_price!.provisional = true;
    render(<EconomySummary report={provisionalBase} locale="de-DE" />);
    screen.getByText('Berechnungsdetails').click();
    expect(screen.getByText(/120 €\/Jahr.*vorläufig/)).toBeInTheDocument();
    expect(screen.getByText(/2,14\s*€/)).toBeInTheDocument();
  });
});
