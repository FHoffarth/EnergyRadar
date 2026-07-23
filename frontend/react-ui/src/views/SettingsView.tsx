import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { RawSettings, LocationCandidateData } from '../types';
import {
  Palette, Sun, Moon, Monitor, MapPin, CloudRain, Folder, FileText,
  Check, RotateCcw, Save, Sparkles, Info, Loader2, ExternalLink,
  Trash2, CheckCircle2, AlertCircle, AlertTriangle, Search, Compass, Globe, Server
} from 'lucide-react';

export function SettingsView() {
  const {
    settingsPayload, updateSettings, chooseExportDirectory,
    openExportDirectory, searchWeatherLocations, isSearchingCandidates,
    weatherCandidates, confirmWeatherLocation, removeResolvedLocation,
    testWeatherConnection, weatherTestState, weatherReport,
    openDiagnosticLog, openLogDirectory, setTheme,
    saveFroniusAddress, testConnection, testConnectionStatus
  } = useApp();

  const effective = settingsPayload?.effective_settings;
  const raw = settingsPayload?.settings;
  const system = settingsPayload?.system;

  const [draft, setDraft] = useState<RawSettings>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [locationInput, setLocationInput] = useState('');

  useEffect(() => {
    if (raw && !isDirty) {
      setDraft(raw);
      if (raw.location_query) {
        setLocationInput(raw.location_query);
      }
    }
  }, [raw, isDirty]);

  const updateDraft = (key: keyof RawSettings, value: any) => {
    setDraft(prev => {
      const next = { ...prev, [key]: value };
      setIsDirty(true);
      return next;
    });
  };

  const handleSave = () => {
    updateSettings(draft);
    setIsDirty(false);
    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 3000);
  };

  const handleResetDraft = () => {
    if (raw) setDraft(raw);
    setIsDirty(false);
  };

  const handleSearchLocations = (e: React.FormEvent) => {
    e.preventDefault();
    if (locationInput.trim()) {
      searchWeatherLocations(locationInput);
    }
  };

  const getEff = <K extends keyof typeof effective>(key: K) => {
    const draftVal = draft[key as keyof RawSettings];
    if (draftVal !== undefined && draftVal !== null) return draftVal;
    return effective ? effective[key] : undefined;
  };

  const resLoc = raw?.resolved_location || (raw?.latitude && raw?.longitude ? {
    display_name: raw.location_query || `${raw.latitude}, ${raw.longitude}`,
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: 'Europe/Berlin',
    provider: 'open_meteo'
  } : null);

  return (
    <div className="flex flex-col h-full pt-12 pb-12 overflow-y-auto px-12">
      {/* Header */}
      <header className="pb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-[#1C1C1E] dark:text-white leading-tight">
            Einstellungen
          </h1>
          <p className="text-[#6E6E6E] dark:text-slate-400 mt-2 text-lg">
            Verwalte Darstellung, Standort, Wetter und Systemoptionen.
          </p>
        </div>

        {/* Save & Reset Bar */}
        <div className="flex items-center gap-3">
          {saveSuccessMsg && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4" /> Gespeichert
            </span>
          )}

          {isDirty && (
            <>
              <button
                onClick={handleResetDraft}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Verwerfen
              </button>

              <button
                onClick={handleSave}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
              >
                <Save className="w-4 h-4" /> Änderungen speichern
              </button>
            </>
          )}
        </div>
      </header>

      <div className="space-y-8 max-w-4xl">

        {/* 1. DARSTELLUNG & THEME */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E5E5E3] dark:border-slate-800">
            <Palette className="w-6 h-6 text-indigo-500" />
            <h2 className="text-xl font-bold text-[#1C1C1E] dark:text-white">Darstellung & Theme</h2>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Erscheinungsbild</label>
            <div className="grid grid-cols-3 gap-4">
              {[
                { id: 'dark', label: 'Dunkel', icon: Moon },
                { id: 'light', label: 'Hell', icon: Sun },
                { id: 'system', label: 'System', icon: Monitor },
              ].map(t => {
                const active = getEff('theme') === t.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      updateDraft('theme', t.id);
                      setTheme(t.id as any);
                      updateSettings({ theme: t.id });
                    }}
                    className={`flex items-center justify-center gap-3 p-4 rounded-2xl border font-medium transition-all ${
                      active
                        ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold shadow-sm'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">Dynamischer Hintergrund (Living Sky)</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Passt Farben und Atmosphäre an Tageszeit und Wetterlage an.</p>
            </div>
            <button
              type="button"
              aria-label="Dynamischen Hintergrund umschalten"
              aria-pressed={Boolean(getEff('dynamic_bg_enabled'))}
              onClick={() => {
                const nextVal = !getEff('dynamic_bg_enabled');
                updateDraft('dynamic_bg_enabled', nextVal);
                updateSettings({ dynamic_bg_enabled: nextVal });
              }}
              className={`w-14 h-8 rounded-full p-1 transition-colors duration-200 ${
                getEff('dynamic_bg_enabled') ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div className={`w-6 h-6 rounded-full bg-white transition-transform duration-200 ${
                getEff('dynamic_bg_enabled') ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Animationsmodus</label>
            <div className="grid grid-cols-3 gap-4">
              {[
                { id: 'full', label: 'Normal', desc: 'Volle Effekte' },
                { id: 'reduced', label: 'Reduziert', desc: 'Sanfte Übergänge' },
                { id: 'none', label: 'Keine Animationen', desc: 'Statisches Layout' },
              ].map(m => {
                const active = getEff('motion_mode') === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      updateDraft('motion_mode', m.id);
                      updateSettings({ motion_mode: m.id });
                    }}
                    className={`flex flex-col p-4 rounded-2xl border text-left transition-all ${
                      active
                        ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold shadow-sm'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="font-semibold">{m.label}</span>
                    <span className="text-xs text-slate-500 mt-1">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Schriftgröße</label>
              <div className="flex gap-3">
                {[
                  { id: 'normal', label: 'Normal' },
                  { id: 'large', label: 'Groß' },
                ].map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      updateDraft('text_size', s.id);
                      updateSettings({ text_size: s.id });
                    }}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      getEff('text_size') === s.id
                        ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Zahlenformat</label>
              <div className="flex gap-3">
                {[
                  { id: 'de-DE', label: '1.234,56 (Deutsch)' },
                  { id: 'en-US', label: '1,234.56 (International)' },
                ].map(n => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      updateDraft('number_format', n.id);
                      updateSettings({ number_format: n.id });
                    }}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      getEff('number_format') === n.id
                        ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'border-[#E5E5E3] dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 1.5 GERÄTE & ANBINDUNG (WECHSELRICHTER & STROMZÄHLER IP) */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E5E5E3] dark:border-slate-800">
            <Server className="w-6 h-6 text-amber-500" />
            <h2 className="text-xl font-bold text-[#1C1C1E] dark:text-white">Geräte & IP-Adressen</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Fronius Wechselrichter (IP / Hostname)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="z. B. wechselrichter.local"
                  value={getEff('fronius_address') ?? ''}
                  onChange={(e) => updateDraft('fronius_address', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const addr = getEff('fronius_address');
                      if (addr) saveFroniusAddress(addr);
                      testConnection('fronius_primary');
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const addr = getEff('fronius_address');
                    if (addr) saveFroniusAddress(addr);
                    testConnection('fronius_primary');
                  }}
                  className="px-3.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {testConnectionStatus['fronius_primary']?.testing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Übernehmen & Testen
                </button>
              </div>
              <p className="text-xs text-slate-500 font-medium">Adresse des Fronius Solar API v1 Interfaces im lokalen Netzwerk.</p>
              {testConnectionStatus['fronius_primary']?.result && (
                <div className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 font-medium ${
                  testConnectionStatus['fronius_primary'].result.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  {testConnectionStatus['fronius_primary'].result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                  <span>{testConnectionStatus['fronius_primary'].result.message} ({testConnectionStatus['fronius_primary'].result.latency_ms} ms)</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">ISKRA MT175 / Tasmota Lesekopf (IP / Hostname)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="z. B. zaehler.local"
                  value={getEff('mt175_address') ?? ''}
                  onChange={(e) => updateDraft('mt175_address', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const addr = getEff('mt175_address');
                      updateSettings({ mt175_address: addr });
                      testConnection('mt175_primary');
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const addr = getEff('mt175_address');
                    updateSettings({ mt175_address: addr });
                    testConnection('mt175_primary');
                  }}
                  className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {testConnectionStatus['mt175_primary']?.testing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Übernehmen & Testen
                </button>
              </div>
              <p className="text-xs text-slate-500 font-medium">Adresse des optischen SML Lesekopfs (z. B. Tasmota HTTP API).</p>
              {testConnectionStatus['mt175_primary']?.result && (
                <div className={`text-xs px-3 py-2 rounded-xl flex items-center gap-2 font-medium ${
                  testConnectionStatus['mt175_primary'].result.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                }`}>
                  {testConnectionStatus['mt175_primary'].result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                  <span>{testConnectionStatus['mt175_primary'].result.message} ({testConnectionStatus['mt175_primary'].result.latency_ms} ms)</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 2. STANDORT & WETTER (OPT-IN & GEOCONSENT) */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E5E5E3] dark:border-slate-800">
            <MapPin className="w-6 h-6 text-sky-500" />
            <h2 className="text-xl font-bold text-[#1C1C1E] dark:text-white">Standort & Wetter (Sprint 5B)</h2>
          </div>

          <div className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex items-start gap-3 text-sky-800 dark:text-sky-300 text-sm leading-relaxed">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <strong>Datenschutzhinweis:</strong> Für Wetterdaten werden der bestätigte Ort sowie die Koordinaten an den Open-Meteo Wetterdienst (CC BY 4.0) übermittelt. Server-Logs der Open-Meteo API können IP-Adresse und Koordinaten bis zu 90 Tage aufbewahren.
            </div>
          </div>

          {/* Location Search Form */}
          <form onSubmit={handleSearchLocations} className="space-y-3">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Ort oder PLZ suchen</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Ort oder Postleitzahl"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <Search className="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400" />
              </div>
              <button
                type="submit"
                disabled={isSearchingCandidates || !locationInput.trim()}
                className="px-5 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {isSearchingCandidates ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Suchen...</span>
                  </>
                ) : (
                  <span>Suchen</span>
                )}
              </button>
            </div>
          </form>

          {/* Candidates Result List */}
          {weatherCandidates.length > 0 && (
            <div className="p-4 rounded-2xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                Gefundene Standorte ({weatherCandidates.length}) — Bitte wählen:
              </p>
              <div className="space-y-2">
                {weatherCandidates.map((cand, idx) => (
                  <div
                    key={cand.provider_id || idx}
                    className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between hover:border-sky-500 transition-colors"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{cand.display_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Lat: {cand.latitude.toFixed(4)}, Lon: {cand.longitude.toFixed(4)} · Zeitzone: {cand.timezone || 'Europe/Berlin'}
                      </p>
                    </div>
                    <button
                      onClick={() => confirmWeatherLocation(cand)}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                    >
                      Auswählen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirmed Location Card */}
          {resLoc ? (
            <div className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/40 dark:bg-emerald-950/20 flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-bold text-slate-900 dark:text-slate-100">{resLoc.display_name}</span>
                </div>
                <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                  Koordinaten: {resLoc.latitude.toFixed(4)}, {resLoc.longitude.toFixed(4)} · Zeitzone: {resLoc.timezone || 'Europe/Berlin'} · Provider: {resLoc.provider || 'open_meteo'}
                </p>
              </div>

              <button
                onClick={removeResolvedLocation}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 rounded-lg border border-red-200 dark:border-red-800 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Standort entfernen
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 text-sm text-center">
              Noch kein Standort ausgewählt. Gib oben einen Ort ein und wähle den passenden Treffer.
            </div>
          )}

          {/* Weather Opt-in Switch */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">Wetterdaten aktivieren</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Ruft automatische Wetter- und Sonnendaten ab (nur nach bestätigtem Standort).</p>
            </div>
            <button
              type="button"
              aria-label="Wetterdaten aktivieren"
              aria-pressed={Boolean(getEff('weather_enabled') && resLoc)}
              disabled={!resLoc}
              onClick={() => updateDraft('weather_enabled', !getEff('weather_enabled'))}
              className={`w-14 h-8 rounded-full p-1 transition-colors duration-200 ${
                !resLoc ? 'opacity-40 cursor-not-allowed bg-slate-300' : getEff('weather_enabled') ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div className={`w-6 h-6 rounded-full bg-white transition-transform duration-200 ${
                getEff('weather_enabled') && resLoc ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* PV Installed Capacity (kWp) Field (Sprint 5D) */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Anlagen-Nennleistung (kWp)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                aria-label="Anlagen-Nennleistung (kWp)"
                step="0.1"
                min="0.1"
                max="1000"
                placeholder="z.B. 8.5"
                value={getEff('pv_installed_kwp') ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseFloat(e.target.value) : null;
                  updateDraft('pv_installed_kwp', val);
                }}
                className="w-48 px-4 py-2.5 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-sm text-slate-500 font-medium">kWp Peak-Leistung (dient als Obergrenze der Ertragsprognose)</span>
            </div>
          </div>

          {/* Live Connection Test Button & Status Card */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60 space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={testWeatherConnection}
                disabled={weatherTestState.testing || !resLoc}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
              >
                {weatherTestState.testing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Führe Live-Verbindungstest aus...</span>
                  </>
                ) : (
                  <>
                    <CloudRain className="w-4 h-4" />
                    <span>Wetterverbindung testen</span>
                  </>
                )}
              </button>

              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> Data powered by Open-Meteo (CC BY 4.0)
              </span>
            </div>

            {/* Test Result Display Card */}
            {weatherTestState.result && (
              <div className={`p-5 rounded-2xl border space-y-3 ${
                weatherTestState.result.ok
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                    {weatherTestState.result.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                    <span>{weatherTestState.result.message}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    Latenz: {weatherTestState.result.latency_ms} ms
                  </span>
                </div>

                {weatherTestState.result.report?.current && (
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-sm">
                    <div>
                      <span className="text-xs text-slate-500 block">Temperatur</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {weatherTestState.result.report.current.temperature_c != null ? `${weatherTestState.result.report.current.temperature_c} °C` : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-slate-500 block">Bewölkung</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {weatherTestState.result.report.current.cloud_cover_percent != null ? `${weatherTestState.result.report.current.cloud_cover_percent} %` : 'Nicht gemeldet'}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-slate-500 block">Status</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 uppercase text-xs">
                        {weatherTestState.result.report.current.condition}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>


        {/* 3. DATEN & SYSTEM */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-[#E5E5E3] dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E5E5E3] dark:border-slate-800">
            <Folder className="w-6 h-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-[#1C1C1E] dark:text-white">Daten & System</h2>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Exportordner</label>
            <div className="flex items-center gap-3">
              <div className="flex-1 px-4 py-3 rounded-xl border border-[#E5E5E3] dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-sm truncate">
                {getEff('export_directory') || "Standard (Dokumente / EnergyRadar_Exports)"}
              </div>
              <button
                onClick={chooseExportDirectory}
                className="px-4 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-sm transition-colors shrink-0"
              >
                Ordner wählen
              </button>
              <button
                onClick={openExportDirectory}
                title="Ordner im Dateimanager öffnen"
                className="p-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl transition-colors shrink-0"
              >
                <ExternalLink className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
            <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">Datenbankpfad (Schreibgeschützt)</label>
            <div className="px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-[#E5E5E3] dark:border-slate-700/60 text-slate-600 dark:text-slate-400 font-mono text-xs truncate">
              {system?.database_path || "Verbindung wird hergestellt..."}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center gap-3">
              <button
                onClick={openDiagnosticLog}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors"
              >
                <FileText className="w-4 h-4 text-emerald-500" />
                Diagnoseprotokoll öffnen
              </button>

              <button
                onClick={openLogDirectory}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors"
              >
                <Folder className="w-4 h-4 text-slate-500" />
                Log-Ordner öffnen
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                App v{system?.app_version || '–'}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                Schema v{system?.database_schema_version || '2'}
              </span>
            </div>
          </div>

        </section>

      </div>
    </div>
  );
}
