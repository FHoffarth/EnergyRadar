import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TariffSettings } from '../components/TariffSettings';

const saveTariff = vi.fn();
const deleteTariff = vi.fn();
const app = {
  settingsPayload: { tariffs: [], effective_settings: {}, settings: {}, system: {} },
  saveTariff, deleteTariff,
  tariffOperationState: { status: 'idle' },
};

vi.mock('../context/AppContext', () => ({ useApp: () => app }));

describe('TariffSettings', () => {
  beforeEach(() => { saveTariff.mockClear(); deleteTariff.mockClear(); app.tariffOperationState = { status: 'idle' }; app.settingsPayload.tariffs = []; });

  it('has accessible labels and save/discard dirty-state semantics', () => {
    render(<TariffSettings />);
    const save = screen.getByRole('button', { name: 'Tarifzeitraum speichern' });
    const discard = screen.getByRole('button', { name: 'Tarifentwurf zurücksetzen' });
    expect(save).toBeDisabled(); expect(discard).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Betrag in ct/kWh'), { target: { value: '34.00' } });
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-01-01' } });
    expect(save).toBeEnabled(); expect(discard).toBeEnabled();
    fireEvent.click(discard);
    expect(screen.getByLabelText('Betrag in ct/kWh')).toHaveValue(null);
    expect(save).toBeDisabled();
  });

  it('saves exact strings without a product default', () => {
    render(<TariffSettings />);
    expect(screen.getByLabelText('Betrag in ct/kWh')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Betrag in ct/kWh'), { target: { value: '34.1250' } });
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tarifzeitraum speichern' }));
    expect(saveTariff).toHaveBeenCalledWith(expect.objectContaining({ value_ct_per_kwh: '34.1250', valid_from: '2026-01-01' }));
  });

  it('shows and preserves a provisional feed-in choice', () => {
    render(<TariffSettings />);
    fireEvent.change(screen.getByLabelText('Tarifart'), { target: { value: 'feed_in_tariff' } });
    fireEvent.click(screen.getByLabelText(/Vorläufiger Wert/));
    fireEvent.change(screen.getByLabelText('Betrag in ct/kWh'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tarifzeitraum speichern' }));
    expect(saveTariff).toHaveBeenCalledWith(expect.objectContaining({ tariff_type: 'feed_in_tariff', provisional: true }));
  });

  it('guides an empty setup without requiring a base price', () => {
    render(<TariffSettings />);
    expect(screen.getByText(/Solar Economy ist bereit/)).toBeInTheDocument();
    expect(screen.getByText(/Strombezugspreis und einen Einspeisetarif/)).toBeInTheDocument();
    expect(screen.getByText(/Der Grundpreis ist optional/)).toBeInTheDocument();
  });

  it('saves and discards a base price in EUR per year without a default', () => {
    render(<TariffSettings />);
    fireEvent.change(screen.getByLabelText('Tarifart'), { target: { value: 'base_price' } });
    const annual = screen.getByLabelText('Jahresgrundpreis brutto in €');
    expect(annual).toHaveValue(null);
    fireEvent.change(annual, { target: { value: '120.00' } });
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Anbieter oder Bezeichnung (optional)'), { target: { value: 'ENTEGA Ökostrom fix 24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tarifentwurf zurücksetzen' }));
    expect(screen.getByLabelText('Tarifart')).toHaveValue('grid_work_price');
    expect(screen.getByLabelText('Betrag in ct/kWh')).toHaveValue(null);

    fireEvent.change(screen.getByLabelText('Tarifart'), { target: { value: 'base_price' } });
    fireEvent.change(screen.getByLabelText('Jahresgrundpreis brutto in €'), { target: { value: '120.00' } });
    fireEvent.change(screen.getByLabelText('Gültig ab'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByLabelText(/Vorläufiger Wert/));
    fireEvent.click(screen.getByRole('button', { name: 'Tarifzeitraum speichern' }));
    expect(saveTariff).toHaveBeenCalledWith(expect.objectContaining({
      tariff_type: 'base_price', annual_eur: '120.00', value_ct_per_kwh: null, provisional: true,
    }));
  });

  it('lists and edits an open-ended provisional base-price period', () => {
    app.settingsPayload.tariffs = [{
      id: 7, tariff_type: 'base_price', value_ct_per_kwh: null, annual_eur: '120',
      valid_from: '2026-01-01', valid_until: null, label: 'ENTEGA Ökostrom fix 24',
      source_type: 'invoice', provisional: true,
    }];
    render(<TariffSettings />);
    expect(screen.getByText('Grundpreis · 120 €/Jahr')).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 bis offen.*vorläufig/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    expect(screen.getByLabelText('Tarifart')).toHaveValue('base_price');
    expect(screen.getByLabelText('Jahresgrundpreis brutto in €')).toHaveValue(120);
  });
});
