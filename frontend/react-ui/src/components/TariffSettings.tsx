import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TariffRecordData } from '../types';

const emptyTariff = (): TariffRecordData => ({
  tariff_type: 'grid_work_price',
  value_ct_per_kwh: null,
  annual_eur: null,
  valid_from: '',
  valid_until: null,
  label: null,
  source_type: 'user_entry',
  provisional: false,
});

const typeLabel: Record<TariffRecordData['tariff_type'], string> = {
  grid_work_price: 'Strombezugspreis',
  feed_in_tariff: 'Einspeisevergütung',
  base_price: 'Grundpreis',
};

export function TariffSettings() {
  const app = useApp();
  const settingsPayload = app.settingsPayload;
  const saveTariff = app.saveTariff ?? (() => {});
  const deleteTariff = app.deleteTariff ?? (() => {});
  const tariffOperationState = app.tariffOperationState ?? { status: 'idle' as const };
  const [draft, setDraft] = useState<TariffRecordData>(emptyTariff());
  const [persistedDraft, setPersistedDraft] = useState<TariffRecordData>(emptyTariff());
  const dirty = JSON.stringify(draft) !== JSON.stringify(persistedDraft);
  const busy = tariffOperationState.status === 'saving';

  useEffect(() => {
    if (tariffOperationState.status === 'saved') {
      const next = emptyTariff();
      setDraft(next);
      setPersistedDraft(next);
    }
  }, [tariffOperationState.status]);

  const edit = (record: TariffRecordData) => {
    setDraft({ ...record });
    setPersistedDraft({ ...record });
  };

  const set = <K extends keyof TariffRecordData>(key: K, value: TariffRecordData[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const valueRequired = draft.tariff_type === 'base_price' ? draft.annual_eur : draft.value_ct_per_kwh;
  const canSave = dirty && Boolean(draft.valid_from && valueRequired !== null && valueRequired !== '') && !busy;

  return (
    <section className="cockpit-surface order-3 col-span-12 space-y-5 p-6" aria-labelledby="tariff-settings-title">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div><p className="cockpit-eyebrow">Wirtschaftlichkeit</p><h2 id="tariff-settings-title" className="mt-1 text-base font-bold">Tarife & Gültigkeit</h2></div>
        <Plus className="h-5 w-5 text-sky-600" aria-hidden="true" />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">Tarife werden lokal als Zeiträume gespeichert. Ohne bestätigten Tarif bleibt der betreffende Geldwert nicht verfügbar.</p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div><label htmlFor="tariff-type" className="text-sm font-medium">Tarifart</label><select id="tariff-type" value={draft.tariff_type} onChange={event => {
          const tariff_type = event.target.value as TariffRecordData['tariff_type'];
          setDraft(previous => ({ ...previous, tariff_type, value_ct_per_kwh: tariff_type === 'base_price' ? null : previous.value_ct_per_kwh, annual_eur: tariff_type === 'base_price' ? previous.annual_eur : null }));
        }} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700">
          <option value="grid_work_price">Strombezugspreis</option><option value="feed_in_tariff">Einspeisevergütung</option><option value="base_price">Grundpreis</option>
        </select></div>
        <div><label htmlFor="tariff-value" className="text-sm font-medium">{draft.tariff_type === 'base_price' ? 'Jahresgrundpreis brutto in €' : 'Betrag in ct/kWh'}</label><input id="tariff-value" type="number" min="0" step="0.0001" value={(draft.tariff_type === 'base_price' ? draft.annual_eur : draft.value_ct_per_kwh) ?? ''} onChange={event => set(draft.tariff_type === 'base_price' ? 'annual_eur' : 'value_ct_per_kwh', (event.target.value || null) as never)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700" /></div>
        <div><label htmlFor="tariff-from" className="text-sm font-medium">Gültig ab</label><input id="tariff-from" type="date" value={draft.valid_from} onChange={event => set('valid_from', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700" /></div>
        <div><label htmlFor="tariff-until" className="text-sm font-medium">Gültig bis (optional)</label><input id="tariff-until" type="date" value={draft.valid_until ?? ''} onChange={event => set('valid_until', event.target.value || null)} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700" /></div>
        <div><label htmlFor="tariff-label" className="text-sm font-medium">Anbieter oder Bezeichnung (optional)</label><input id="tariff-label" value={draft.label ?? ''} onChange={event => set('label', event.target.value || null)} placeholder="Zum Beispiel Vertrag 2026" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700" /></div>
        <div><label htmlFor="tariff-source" className="text-sm font-medium">Quelle</label><select id="tariff-source" value={draft.source_type} onChange={event => {
          const source_type = event.target.value;
          setDraft(previous => ({ ...previous, source_type, provisional: source_type === 'provisional_user_assumption' ? true : previous.provisional }));
        }} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2.5 dark:border-slate-700">
          <option value="user_entry">Eigene Eingabe</option><option value="invoice">Stromrechnung</option><option value="contract">Vertrag</option><option value="grid_operator_statement">Netzbetreiber-Mitteilung</option><option value="feed_in_invoice">Einspeiseabrechnung</option><option value="provisional_user_assumption">Vorläufige eigene Annahme</option><option value="other">Andere Quelle</option>
        </select></div>
        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700"><input type="checkbox" checked={draft.provisional} onChange={event => set('provisional', event.target.checked)} /> Vorläufiger Wert – noch nicht durch Abrechnung bestätigt</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => saveTariff(draft)} disabled={!canSave} className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><Save className="h-4 w-4" />Tarifzeitraum speichern</button>
        <button type="button" onClick={() => setDraft({ ...persistedDraft })} disabled={!dirty || busy} className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700"><RotateCcw className="h-4 w-4" />Tarifentwurf zurücksetzen</button>
        {draft.id != null && <button type="button" onClick={() => { if (window.confirm('Diesen Tarifzeitraum löschen?')) deleteTariff(draft.id!); }} disabled={busy} className="flex items-center gap-2 rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 disabled:opacity-40"><Trash2 className="h-4 w-4" />Löschen</button>}
      </div>
      {tariffOperationState.status === 'saved' && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{tariffOperationState.message}</p>}
      {tariffOperationState.status === 'error' && <p role="alert" className="flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{tariffOperationState.message}</p>}

      <div>
        <h3 className="text-sm font-semibold">Gespeicherte Tarifzeiträume</h3>
        {(settingsPayload?.tariffs?.length ?? 0) === 0 ? <p className="mt-2 text-sm text-slate-500">Noch keine Tarife hinterlegt.</p> : <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          {settingsPayload!.tariffs.map(record => <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{typeLabel[record.tariff_type]} · {record.tariff_type === 'base_price' ? `${record.annual_eur} €/Jahr` : `${record.value_ct_per_kwh} ct/kWh`}</p><p className="text-xs text-slate-500">{record.valid_from} bis {record.valid_until ?? 'offen'} · {record.label ?? 'ohne Bezeichnung'}{record.provisional ? ' · vorläufig' : ''}</p></div><button type="button" onClick={() => edit(record)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"><Pencil className="h-4 w-4" />Bearbeiten</button></li>)}
        </ul>}
      </div>
      <p className="text-xs text-slate-500">Der Grundpreis wird angezeigt, aber nicht als vermiedene Stromkosten gerechnet. Gültig-bis-Daten gelten einschließlich des angegebenen Tages.</p>
    </section>
  );
}
