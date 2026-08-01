import React, { useState, useEffect } from 'react';
import { useApp, useNumberLocale } from '../context/AppContext';
import { RawSettings, ThemeMode, LocationCandidateData } from '../types';
import { formatNumber } from '../lib/format';
import {
  Palette, Sun, Moon, Monitor, MapPin, CloudRain, Folder, FileText,
  Check, RotateCcw, Save, Info, Loader2, ExternalLink,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Search, Globe, Server
} from 'lucide-react';
import { greetingTitle } from '../lib/greeting';
import { TariffSettings } from '../components/TariffSettings';

/**
 * Reduce a pasted address to "host" or "host:port".
 *
 * The scheme and any path are dropped because the backend collectors build the
 * device-specific endpoint themselves. A non-default port is kept — dropping it
 * would silently point the collector at the wrong port.
 */
function normalizeHost(input: string): string {
  let v = input.trim();
  v = v.replace(/^https?:\/\//i, '');
  v = v.replace(/^\/+/, '');
  v = v.replace(/\/.*$/, '');
  return v;
}

export function SettingsView() {
  const {
    settingsPayload, chooseExportDirectory, consumeSystemActionPath,
    openExportDirectory, searchWeatherLocations, weatherSearchState, savedLocationState,
    confirmWeatherLocation, removeResolvedLocation,
    testWeatherConnection, weatherTestState, weatherReport,
    openDiagnosticLog, openLogDirectory, setTheme,
    testConnection, testConnectionStatus,
    updateSettings, settingsSaveState, systemActionState, devices
  } = useApp();

  const effective = settingsPayload?.effective_settings;
  const raw = settingsPayload?.settings;
  const system = settingsPayload?.system;
  const numberLocale = useNumberLocale();
  const formatCoordinate = (value: number) =>
    formatNumber(value, numberLocale, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  const [draft, setDraft] = useState<RawSettings>({});
  const [isDirty, setIsDirty] = useState(false);
  const [locationInput, setLocationInput] = useState('');
  const [froniusAddr, setFroniusAddr] = useState('');
  const [mt175Addr, setMt175Addr] = useState('');
  const [mt175Expanded, setMt175Expanded] = useState(false);
  const [awaitingFormSave, setAwaitingFormSave] = useState(false);

  useEffect(() => {
    if (raw && !isDirty) {
      setDraft(raw);
      if (raw.location_query && weatherSearchState.status === 'idle') setLocationInput(raw.location_query);
    }
  }, [raw, isDirty, weatherSearchState.status]);

  useEffect(() => {
    if (effective?.fronius_address !== undefined) {
      setFroniusAddr(effective.fronius_address || '');
    }
    if (effective?.mt175_address !== undefined) {
      setMt175Addr(effective.mt175_address || '');
    }
  }, [effective?.fronius_address, effective?.mt175_address]);

  const updateDraft = (key: keyof RawSettings, value: any) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      setIsDirty(true);
      return next;
    });
  };

  // The success badge is driven by settingsSaveState, which only turns
  // "saved" once the backend has confirmed the write.
  const handleSave = () => {
    if (!isDirty || settingsSaveState.status === 'saving') return;
    setAwaitingFormSave(true);
    updateSettings(draft);
  };

  const handleResetDraft = () => {
    setDraft(raw ?? {});
    setLocationInput(raw?.location_query ?? '');
    setFroniusAddr(effective?.fronius_address || '');
    setMt175Addr(effective?.mt175_address || '');
    setTheme((effective?.theme || 'dark') as ThemeMode);
    setIsDirty(false);
  };

  useEffect(() => {
    if (awaitingFormSave && settingsSaveState.status === 'saved') {
      setDraft(raw ?? {});
      setIsDirty(false);
      setAwaitingFormSave(false);
    } else if (awaitingFormSave && settingsSaveState.status === 'error') {
      setAwaitingFormSave(false);
    }
  }, [settingsSaveState.status, raw, awaitingFormSave]);

  useEffect(() => {
    if (
      systemActionState?.status === 'success'
      && systemActionState.action === 'chooseExportDirectory'
      && systemActionState.path
    ) {
      setDraft(previous => ({ ...previous, export_directory: systemActionState.path }));
      setIsDirty(true);
      consumeSystemActionPath();
    }
  }, [systemActionState?.status, systemActionState?.action, systemActionState?.path, consumeSystemActionPath]);

  const handleSearchLocations = (e: React.FormEvent) => {
    e.preventDefault();
    const q = locationInput.trim();
    if (!q) return;
    searchWeatherLocations(q);
  };

  const handleConfirmLocation = (cand: LocationCandidateData) => {
    confirmWeatherLocation(cand);
    setLocationInput('');
  };

  const handleRemoveLocation = () => {
    removeResolvedLocation();
    setLocationInput('');
  };

  const getEff = <K extends keyof typeof effective>(key: K) => {
    const draftVal = draft[key as keyof RawSettings];
    if (draftVal !== undefined && draftVal !== null) return draftVal;
    return effective ? effective[key] : undefined;
  };

  const handleSaveFronius = () => {
    if (froniusAddr && froniusAddr === (effective?.fronius_address || '')) testConnection('fronius_primary');
  };

  const handleSaveMt175 = () => {
    if (mt175Addr && mt175Addr === (effective?.mt175_address || '')) testConnection('mt175_primary');
  };

  const resLoc = raw?.resolved_location || (raw?.latitude && raw?.longitude ? {
    display_name: raw.location_query || `${raw.latitude}, ${raw.longitude}`,
    latitude: raw.latitude, longitude: raw.longitude,
    timezone: 'Europe/Berlin', provider: 'open_meteo'
  } : null);
  const searchState = weatherSearchState.status;
  const weatherCandidates = weatherSearchState.candidates;
  const weatherTestLoading = weatherTestState.status === 'loading';
  const previewName = (draft.preferred_name ?? effective?.preferred_name ?? '') || null;
  const previewEnabled = draft.greeting_enabled ?? effective?.greeting_enabled ?? true;
  const formatDateTime = (value?: string | null) => {
    if (!value) return 'Noch nicht verfügbar';
    const parsed = new Date(value.replace(' ', 'T'));
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
      : 'Noch nicht verfügbar';
  };
  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 MB';
    return `${formatNumber(bytes / 1024 / 1024, numberLocale, { maximumFractionDigits: 1 })} MB`;
  };
  const deviceOnline = (id: string) => (devices ?? []).find(device => device.device_id === id)?.connection_status === 'connected';
  const systemActionBusy = systemActionState?.status === 'loading';
  const deviceSystemStatus = (id: string): [string, boolean] => {
    const device = (devices ?? []).find(candidate => candidate.device_id === id);
    if (!device || device.connection_status === 'unconfigured') return ['Nicht eingerichtet', false];
    if (device.connection_status === 'stale') return ['Veraltet', false];
    if (device.connection_status !== 'connected') return ['Offline', false];
    if (device.data_status !== 'complete') return ['Teilweise verfügbar', false];
    return ['Online', true];
  };

  return (
    <div className="cockpit-page flex flex-col min-h-full" data-testid="settings-workspace">
      <header className="pb-6 flex flex-col items-start justify-between gap-4 xl:flex-row">
        <div>
          <p className="cockpit-eyebrow">Konfiguration</p>
          <h1 className="cockpit-title mt-2 text-[#1C1C1E] dark:text-white">Einstellungen</h1>
          <p className="text-[#6E6E6E] dark:text-slate-400 mt-1 text-sm">Geräte, Aufzeichnung, Darstellung und Systemstatus an einem Ort.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {settingsSaveState.status === 'saving' && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
              <Loader2 className="w-4 h-4" /> Wird gespeichert…
            </span>
          )}
          {settingsSaveState.status === 'saved' && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4" /> Gespeichert
            </span>
          )}
          {settingsSaveState.status === 'error' && (
            <span role="alert" className="flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800">
              <AlertCircle className="w-4 h-4" /> {settingsSaveState.message || 'Speichern fehlgeschlagen.'}
            </span>
          )}
          {systemActionState?.status !== 'idle' && systemActionState?.message && (
            <span
              role={systemActionState.status === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={`text-sm font-medium ${
                systemActionState.status === 'error'
                  ? 'text-rose-600 dark:text-rose-400'
                  : systemActionState.status === 'success'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {systemActionState.status === 'loading' && <Loader2 className="inline w-4 h-4 mr-1.5" />}
              {systemActionState.message}
            </span>
          )}
          <button onClick={handleResetDraft} disabled={!isDirty || settingsSaveState.status === 'saving'}
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw className="w-4 h-4" /> Verwerfen
          </button>
          <button onClick={handleSave} disabled={!isDirty || settingsSaveState.status === 'saving'}
            className="px-5 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {settingsSaveState.status === 'saving' ? <Loader2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            Änderungen speichern
          </button>
        </div>
      </header>

      <div className="cockpit-grid items-start">
        <TariffSettings />
        {/* Theme */}
        <section className="cockpit-surface order-3 col-span-12 p-6 space-y-5 xl:col-span-6">
          <div className="flex items-center gap-3 pb-3 border-b border-[#E5E5E3] dark:border-slate-800">
            <Palette className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-bold text-[#1C1C1E] dark:text-white">Darstellung</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label htmlFor="preferred-name" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Bevorzugter Name</label>
                <p className="text-xs text-slate-500 dark:text-slate-400">Optional und nur lokal auf diesem Gerät gespeichert.</p>
              </div>
              <button type="button" aria-label="Persönliche Begrüßung umschalten"
                aria-pressed={Boolean(previewEnabled)}
                onClick={() => updateDraft('greeting_enabled', !previewEnabled)}
                className={`w-12 h-7 rounded-full p-0.5 transition-colors ${previewEnabled ? 'bg-sky-700' : 'bg-slate-300 dark:bg-slate-700'}`}>
                <div className={`w-6 h-6 rounded-full bg-white transition-transform ${previewEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <input id="preferred-name" type="text" maxLength={80} value={draft.preferred_name ?? effective?.preferred_name ?? ''}
              onChange={(event) => updateDraft('preferred_name', event.target.value)}
              placeholder="Name (optional)"
              className="w-full px-3 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3" aria-label="Vorschau der Begrüßung">
              <p className="text-xs uppercase tracking-wide text-slate-400">Vorschau</p>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                {previewEnabled ? greetingTitle(new Date().getHours(), previewName) : 'Persönliche Begrüßung ist ausgeschaltet.'}
              </p>
              {previewEnabled && <p className="mt-1 text-xs text-slate-500">Der zweite Satz erscheint nur mit vertrauenswürdigen Live-Daten.</p>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Erscheinungsbild</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'dark', label: 'Dunkel', icon: Moon },
                { id: 'light', label: 'Hell', icon: Sun },
                { id: 'system', label: 'System', icon: Monitor },
              ].map(t => {
                const active = getEff('theme') === t.id;
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button"
                    onClick={() => {
                      updateDraft('theme', t.id);
                      setTheme(t.id as ThemeMode);
                    }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border font-medium transition-all ${
                      active
                        ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-600 text-sky-700 dark:text-sky-300 font-semibold'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}>
                    <Icon className="w-4 h-4" />
                    <span className="text-sm">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Schriftgröße</label>
              <div className="flex gap-2">
                {[{ id: 'normal', label: 'Normal' }, { id: 'large', label: 'Groß' }].map(s => (
                  <button key={s.id} type="button"
                    onClick={() => updateDraft('text_size', s.id)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      getEff('text_size') === s.id
                        ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-600 text-sky-700 dark:text-sky-300 font-semibold'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}>{s.label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Zahlenformat</label>
              <div className="flex gap-2">
                {[{ id: 'de-DE', label: '1.234,56' }, { id: 'en-US', label: '1,234.56' }].map(n => (
                  <button key={n.id} type="button"
                    onClick={() => updateDraft('number_format', n.id)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      getEff('number_format') === n.id
                        ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-600 text-sky-700 dark:text-sky-300 font-semibold'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}>{n.label}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Weather & Location */}
        <section className="cockpit-surface order-4 col-span-12 p-6 space-y-5 xl:col-span-6">
          <div className="flex items-center gap-3 pb-3 border-b border-[#E5E5E3] dark:border-slate-800">
            <MapPin className="w-5 h-5 text-sky-500" />
            <h2 className="text-base font-bold text-[#1C1C1E] dark:text-white">System</h2>
          </div>

          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Standort & Wetter</h3>

          <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex items-start gap-2.5 text-sky-800 dark:text-sky-300 text-xs leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Datenschutzhinweis:</strong> Für Wetterdaten werden der bestätigte Ort sowie die Koordinaten an den Open-Meteo Wetterdienst (CC BY 4.0) übermittelt.
            </div>
          </div>

          <form onSubmit={handleSearchLocations} className="space-y-2">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Ort oder PLZ suchen</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type="text" placeholder="Ort oder Postleitzahl" value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              </div>
              <button type="submit" disabled={searchState === 'loading' || !locationInput.trim()}
                className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50">
                {searchState === 'loading' ? <><Loader2 className="w-4 h-4" /><span>Suchen...</span></> : <span>Suchen</span>}
              </button>
            </div>
          </form>

          {searchState === 'loading' && (
            <div className="text-xs text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5" /> Suche läuft...
            </div>
          )}

          {searchState === 'timeout' && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3 border border-amber-200 dark:border-amber-800">
              {weatherSearchState.message || 'Suche hat zu lange gedauert. Bitte Netzwerkverbindung prüfen und erneut versuchen.'}
            </div>
          )}

          {searchState === 'error' && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-xl p-3 border border-red-200 dark:border-red-800">
              {weatherSearchState.message || 'Bei der Suche ist ein Fehler aufgetreten. Bitte erneut versuchen.'}
            </div>
          )}

          {searchState === 'empty' && savedLocationState === 'absent' && (
            <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
              Keine Standorte gefunden. Versuche einen anderen Suchbegriff.
            </div>
          )}

          {weatherCandidates.length > 0 && (
            <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                Gefundene Standorte ({weatherCandidates.length}) — Bitte wählen:
              </p>
              <div className="space-y-1.5">
                {weatherCandidates.map((cand, idx) => (
                  <div key={cand.provider_id || idx}
                    className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between hover:border-sky-500 transition-colors">
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{cand.display_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Lat: {formatCoordinate(cand.latitude)}, Lon: {formatCoordinate(cand.longitude)}
                      </p>
                    </div>
                    <button onClick={() => handleConfirmLocation(cand)}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors">
                      Auswählen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resLoc ? (
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/40 dark:bg-emerald-950/20 flex items-start justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{resLoc.display_name}</span>
                </div>
                <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                  {formatCoordinate(resLoc.latitude)}, {formatCoordinate(resLoc.longitude)} · {resLoc.timezone || 'Europe/Berlin'}
                </p>
              </div>
              <button onClick={handleRemoveLocation}
                className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 rounded-lg border border-red-200 dark:border-red-800 transition-colors flex items-center gap-1.5">
                <Trash2 className="w-3 h-3" /> Entfernen
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 text-xs text-center">
              Noch kein Standort ausgewählt.
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Wetterdaten aktivieren</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Ruft automatische Wetter- und Sonnendaten ab.</p>
            </div>
            <button type="button" aria-label="Wetterdaten aktivieren"
              aria-pressed={Boolean(getEff('weather_enabled') && resLoc)}
              disabled={!resLoc}
              onClick={() => updateDraft('weather_enabled', !getEff('weather_enabled'))}
              className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 ${
                !resLoc ? 'opacity-40 cursor-not-allowed bg-slate-300' : getEff('weather_enabled') ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}>
              <div className={`w-6 h-6 rounded-full bg-white transition-transform duration-200 ${
                getEff('weather_enabled') && resLoc ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Anlagen-Nennleistung (kWp)</label>
            <div className="flex items-center gap-2">
              <input type="number" aria-label="Anlagen-Nennleistung (kWp)" step="0.1" min="0.1" max="1000"
                placeholder="z.B. 8.5"
                value={getEff('pv_installed_kwp') ?? ''}
                onChange={(e) => { const val = e.target.value ? parseFloat(e.target.value) : null; updateDraft('pv_installed_kwp', val); }}
                className="w-40 px-3 py-2 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              <span className="text-xs text-slate-500 font-medium">kWp Peak</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <button onClick={testWeatherConnection} disabled={weatherTestLoading || !resLoc}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm">
                {weatherTestLoading ? <><Loader2 className="w-4 h-4" /><span>Wird aktualisiert …</span></>
                  : <><CloudRain className="w-4 h-4" /><span>Wetterstatus aktualisieren</span></>}
              </button>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Globe className="w-3 h-3" /> Open-Meteo (CC BY 4.0)
              </span>
            </div>

            {weatherTestState.result && (
              <div className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                weatherTestState.status === 'success'
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
              }`}>
                {weatherTestState.status === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span className="flex-1">{weatherTestState.result.message}</span>
                {typeof weatherTestState.result.latency_ms === 'number' && (
                  <span className="font-mono text-[10px] opacity-70">{formatNumber(weatherTestState.result.latency_ms, numberLocale)} ms</span>
                )}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Systemstatus</h3>
            <div className="grid grid-cols-2 gap-2 text-xs" aria-label="Systemdiagnose">
              {[
                ['Datenbank', system?.database_healthy ? 'Fehlerfrei' : 'Nicht verfügbar', system?.database_healthy],
                ['Historie', system?.recording_active ? 'Aufzeichnung aktiv' : 'Derzeit nicht aktiv', system?.recording_active],
                ['Fronius', ...deviceSystemStatus('fronius_primary')],
                ['Smart Meter', ...deviceSystemStatus('mt175_primary')],
                ['Letzter Messwert', formatDateTime(system?.last_recorded_sample_at), Boolean(system?.last_recorded_sample_at)],
              ].map(([label, value, healthy]) => (
                <div key={String(label)} className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                  <span className={`w-2 h-2 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-slate-500">{label}:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{value}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={openDiagnosticLog} disabled={systemActionBusy}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                <FileText className="w-3.5 h-3.5" /> Systemprotokoll öffnen
              </button>
              <button type="button" onClick={openLogDirectory} disabled={systemActionBusy}
                className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                <Folder className="w-3.5 h-3.5" /> Protokollordner öffnen
              </button>
            </div>
          </div>
        </section>

        {/* Data & Storage */}
        <section className="cockpit-surface order-2 col-span-12 p-6 space-y-5 xl:col-span-6">
          <div className="flex items-center gap-3 pb-3 border-b border-[#E5E5E3] dark:border-slate-800">
            <Folder className="w-5 h-5 text-emerald-500" />
            <h2 className="text-base font-bold text-[#1C1C1E] dark:text-white">Daten & Speicher</h2>
          </div>

          <div className="grid grid-cols-2 gap-3" aria-label="Aufzeichnungsstatus">
            {[
              ['Datenbank', system?.database_healthy ? 'Fehlerfrei' : 'Nicht verfügbar'],
              ['Aufzeichnung', system?.recording_active ? 'Aktiv' : 'Derzeit nicht aktiv'],
              ['Aufzeichnung seit', formatDateTime(system?.recording_since)],
              ['Gespeicherte Messwerte', formatNumber(system?.stored_samples ?? 0, numberLocale)],
              ['Datenbankgröße', formatBytes(system?.database_size_bytes)],
              ['Schema-Version', system?.database_schema_version != null ? String(system.database_schema_version) : 'Nicht verfügbar'],
              ['Letzter Messwert', formatDateTime(system?.last_recorded_sample_at)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Exportordner</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-xs truncate">
                {getEff('export_directory') || system?.export_directory || 'Dokumente'}
              </div>
              <button onClick={chooseExportDirectory} disabled={systemActionBusy}
                className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-xs transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                Ordner wählen
              </button>
              <button onClick={openExportDirectory} disabled={systemActionBusy}
                className="px-3 py-2.5 bg-sky-700 hover:bg-sky-800 text-white rounded-xl font-medium text-xs flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                <ExternalLink className="w-4 h-4" /> Exportordner öffnen
              </button>
            </div>
          </div>

          <details className="pt-2 border-t border-slate-100 dark:border-slate-800/60 text-xs">
            <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">Erweitert</summary>
            <p className="mt-3 text-slate-500">Lokaler Speicherort</p>
            <div className="mt-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-mono text-[11px] break-all">
              {system?.database_path || 'Noch nicht verfügbar'}
            </div>
          </details>
        </section>

        {/* Device Addresses — Fronius primary, MT175 optional */}
        <section className="cockpit-surface order-1 col-span-12 p-6 space-y-5 xl:col-span-6">
          <div className="flex items-center gap-3 pb-3 border-b border-[#E5E5E3] dark:border-slate-800">
            <Server className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-[#1C1C1E] dark:text-white">Geräte</h2>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
            Nur IP-Adresse oder Hostname eingeben (z.B. <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">192.168.178.75</code> oder <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">wechselrichter.local</code>).
          </p>

          {/* Fronius — Primary */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label htmlFor="fronius-address" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Fronius Wechselrichter</label>
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">Hauptgerät</span>
            </div>
            <div className="flex gap-2">
              <input id="fronius-address" type="text" placeholder="IP oder Hostname"
                value={froniusAddr}
                onChange={(e) => {
                  const value = normalizeHost(e.target.value);
                  setFroniusAddr(value);
                  updateDraft('fronius_address', value);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveFronius(); }}
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              <button type="button"
                onClick={handleSaveFronius}
                disabled={testConnectionStatus['fronius_primary']?.testing || !froniusAddr || froniusAddr !== (effective?.fronius_address || '')}
                title={froniusAddr !== (effective?.fronius_address || '') ? 'Änderungen zuerst speichern' : undefined}
                className={`px-4 py-2.5 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-50 ${deviceOnline('fronius_primary') ? 'bg-sky-700 hover:bg-sky-800' : 'bg-amber-500 hover:bg-amber-600'}`}>
                {testConnectionStatus['fronius_primary']?.testing ? <Loader2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                {deviceOnline('fronius_primary') ? 'Jetzt prüfen' : 'Verbindung prüfen'}
              </button>
            </div>
            {testConnectionStatus['fronius_primary']?.testing && (
              <div role="status" aria-live="polite" className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5" /> Verbindung wird aktualisiert …
              </div>
            )}
            {testConnectionStatus['fronius_primary']?.result && (
              <div role={testConnectionStatus['fronius_primary'].result.ok ? 'status' : 'alert'} aria-live="polite" className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 font-medium ${
                testConnectionStatus['fronius_primary'].result.ok && testConnectionStatus['fronius_primary'].result.status !== 'partial'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              }`}>
                {testConnectionStatus['fronius_primary'].result.ok && testConnectionStatus['fronius_primary'].result.status !== 'partial' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>{testConnectionStatus['fronius_primary'].result.status === 'partial' ? 'Teilweise verfügbar: ' : ''}{testConnectionStatus['fronius_primary'].result.message}</span>
              </div>
            )}
          </div>

          {/* MT175 — Optional, collapsed by default */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <button type="button" onClick={() => setMt175Expanded(!mt175Expanded)}
              className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors w-full">
              <span className={`transition-transform duration-200 ${mt175Expanded ? 'rotate-90' : ''}`}>▶</span>
              <span>Iskra MT631 / MT175 · Tasmota Lesekopf</span>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">Optional</span>
            </button>

            {mt175Expanded && (
              <div className="mt-3 space-y-2">
                <label htmlFor="smart-meter-address" className="text-sm font-semibold text-slate-800 dark:text-slate-200">IP oder Hostname des SmartMeterReaders</label>
                <div className="flex gap-2">
                  <input id="smart-meter-address" type="text" placeholder="z.B. 192.168.178.83"
                    value={mt175Addr}
                    onChange={(e) => {
                      const value = normalizeHost(e.target.value);
                      setMt175Addr(value);
                      updateDraft('mt175_address', value);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMt175(); }}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  <button type="button"
                    onClick={handleSaveMt175}
                    disabled={testConnectionStatus['mt175_primary']?.testing || !mt175Addr || mt175Addr !== (effective?.mt175_address || '')}
                    title={mt175Addr !== (effective?.mt175_address || '') ? 'Änderungen zuerst speichern' : undefined}
                    className={`px-4 py-2.5 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 disabled:opacity-50 ${deviceOnline('mt175_primary') ? 'bg-sky-700 hover:bg-sky-800' : 'bg-amber-500 hover:bg-amber-600'}`}>
                    {testConnectionStatus['mt175_primary']?.testing ? <Loader2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                    {deviceOnline('mt175_primary') ? 'Jetzt prüfen' : 'Verbindung prüfen'}
                  </button>
                </div>
                {testConnectionStatus['mt175_primary']?.testing && (
                  <div role="status" aria-live="polite" className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5" /> Verbindung wird aktualisiert …
                  </div>
                )}
                {testConnectionStatus['mt175_primary']?.result && (
                  <div role={testConnectionStatus['mt175_primary'].result.ok ? 'status' : 'alert'} aria-live="polite" className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 font-medium ${
                    testConnectionStatus['mt175_primary'].result.ok && testConnectionStatus['mt175_primary'].result.status !== 'partial'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                  }`}>
                    {testConnectionStatus['mt175_primary'].result.ok && testConnectionStatus['mt175_primary'].result.status !== 'partial' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span>{testConnectionStatus['mt175_primary'].result.status === 'partial' ? 'Teilweise verfügbar: ' : ''}{testConnectionStatus['mt175_primary'].result.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Product attribution. Kept to the end of Settings — deliberately not
            in the sidebar, navigation, Now/Today or any persistent banner. */}
        <footer className="order-5 col-span-12 pt-2 pb-1 text-xs text-slate-400 dark:text-slate-600">
          <p>{system?.app_version ? `EnergyRadar ${system.app_version}` : 'EnergyRadar'}</p>
          <p className="mt-0.5">© 2026 Florian Hoffarth. Alle Rechte vorbehalten.</p>
        </footer>
      </div>
    </div>
  );
}
