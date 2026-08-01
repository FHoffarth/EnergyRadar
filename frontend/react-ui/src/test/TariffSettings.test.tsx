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
});
