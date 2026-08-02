import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { useApp, useNumberLocale } from '../context/AppContext';
import { WeatherIntelligence } from '../components/WeatherIntelligence';
import { CurrentEnergyBriefing } from '../components/CurrentEnergyBriefing';
import { EnergyFlow } from '../components/energy/EnergyFlow';
import { RecordingHeartbeat } from '../components/energy/RecordingHeartbeat';
import { describeRecording, localClock } from '../lib/freshness';
import { formatKw } from '../lib/format';
import { greetingTitle } from '../lib/greeting';
import { currentEnergyVerdict } from '../lib/energyContext';

export function NowView() {
  const { snapshot, devices, sourceType } = useEnergyProvider();
  const { settingsPayload, weatherReport } = useApp();
  const locale = useNumberLocale();

  const greetingEnabled = Boolean(settingsPayload) && (settingsPayload?.effective_settings?.greeting_enabled ?? true);
  const preferredName = settingsPayload?.effective_settings?.preferred_name ?? null;

  // A value counts as present only when the device actually measured it.
  const hasSolar = snapshot.solar.valueKw !== null && snapshot.solar.origin === 'observed';
  const hasHome = snapshot.homeLoad.valueKw !== null && snapshot.homeLoad.origin === 'observed';
  const hasGrid = snapshot.grid.valueKw !== null && snapshot.grid.origin === 'observed';

  // ── Plain-language state ─────────────────────────────────────────────
  // Stated strictly from what is measured. Nothing is inferred for a
  // channel the meter has not delivered.
  const headline = (() => {
    if (snapshot.quality === 'error') return 'Gerät momentan nicht erreichbar.';
    if (!hasSolar && !hasHome && !hasGrid) {
      if (snapshot.quality === 'stale') return 'Nur veraltete Messwerte vorhanden.';
      return 'Keine Datenquelle eingerichtet.';
    }

    const sentences: string[] = [];
    if (hasSolar) {
      sentences.push(`PV liefert aktuell ${formatKw(snapshot.solar.valueKw, locale)} kW.`);
    }

    const missing = [!hasHome ? 'Verbrauch' : null, !hasGrid ? 'Netz' : null].filter(Boolean);
    if (missing.length === 2) {
      sentences.push('Verbrauch und Netz sind noch nicht verfügbar.');
    } else if (missing.length === 1) {
      sentences.push(`${missing[0]} ist noch nicht verfügbar.`);
    } else if (snapshot.assessment?.verdict && snapshot.quality === 'live') {
      sentences.push(snapshot.assessment.verdict);
    }

    return sentences.join(' ');
  })();

  const greeting = greetingEnabled ? {
    title: greetingTitle(new Date().getHours(), preferredName),
    summary: currentEnergyVerdict(snapshot, devices, locale),
  } : null;

  // ── Recording heartbeat (authoritative system state) ─────────────────
  const recording = describeRecording(settingsPayload?.system, { locale });

  // ── Data-source status (diagnostics only) ────────────────────────────
  const statusChips: string[] = [];
  devices.forEach(device => {
    const state =
      device.status === 'active' ? 'online'
      : device.status === 'last_known' ? 'veraltet'
      : device.status === 'unknown' ? 'Fehler'
      : 'nicht verbunden';
    statusChips.push(`${device.name} ${state}`);
  });
  if (devices.length === 0) {
    statusChips.push(sourceType === 'demo' ? 'Demo-Quelle aktiv' : 'Keine Geräte verbunden');
  }

  const weatherEnabled = Boolean(settingsPayload?.effective_settings?.weather_enabled);
  const forecast = snapshot.solarForecast;

  const observedClock = localClock(snapshot.timestamp, locale);
  const recordingSinceClock = localClock(settingsPayload?.system?.recording_since, locale);

  return (
    <div className="cockpit-page flex flex-col gap-8" data-testid="now-workspace">
      {/* 1 — plain-language state */}
      <CurrentEnergyBriefing title={greeting?.title ?? headline} verdict={greeting?.summary} />

      {/* 2 — energy flow (the centre) + heartbeat */}
      <div className="flex flex-col items-stretch gap-5">
        <EnergyFlow snapshot={snapshot} locale={locale} />
        {recording && (
          <div className="flex justify-center">
            <RecordingHeartbeat descriptor={recording} />
          </div>
        )}
      </div>

      {/* 3 — supporting context */}
      {(weatherEnabled || forecast?.headline) && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {weatherEnabled && (
            <WeatherIntelligence report={weatherReport} locale={locale} compact snapshot={snapshot} />
          )}
          {forecast?.headline && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Prognose: {forecast.headline}</p>
          )}
        </div>
      )}

      {/* 4 — technical details on demand */}
      <details className="mx-auto w-full max-w-2xl text-sm text-slate-600 dark:text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">Technische Details</summary>
        <div className="mt-3 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <p data-testid="system-status-row" className="leading-relaxed">{statusChips.join(' · ')}</p>
          {observedClock && <p>Letzte Messung: {observedClock} Uhr</p>}
          {recordingSinceClock && <p>Aufzeichnung seit: {recordingSinceClock} Uhr</p>}
          {settingsPayload?.system?.fronius_state && <p>Wechselrichter: {settingsPayload.system.fronius_state}</p>}
          {settingsPayload?.system?.smart_meter_state && <p>Netzzähler: {settingsPayload.system.smart_meter_state}</p>}
        </div>
      </details>
    </div>
  );
}
