import React from 'react';
import { useEnergyProvider } from '../providers/EnergyProviderContext';
import { Sun, Home, Zap } from 'lucide-react';
import { useApp, useNumberLocale } from '../context/AppContext';
import { usePrefersReducedMotion } from '../lib/motion';
import { DayTrendChart, hasEnoughEvidence, measuredPoints } from '../components/DayTrendChart';
import { WeatherIntelligence } from '../components/WeatherIntelligence';
import { CurrentEnergyBriefing } from '../components/CurrentEnergyBriefing';
import { UNKNOWN_VALUE, formatKw, formatNumber } from '../lib/format';
import { greetingTitle } from '../lib/greeting';
import { currentEnergyVerdict, recentSolarTrend } from '../lib/energyContext';

/**
 * Colour for a channel the devices have not delivered. Legible enough to read
 * as a deliberate placeholder, still clearly muted against the measured
 * values so an unknown never reads as a measurement.
 */
const UNKNOWN_ACCENT = 'text-slate-500 dark:text-slate-500';

export function NowView() {
  const { snapshot, timeline, devices, sourceType } = useEnergyProvider();
  const { settingsPayload, weatherReport } = useApp();
  const locale = useNumberLocale();

  const animateCharts = !usePrefersReducedMotion();
  const greetingEnabled = Boolean(settingsPayload) && (settingsPayload?.effective_settings?.greeting_enabled ?? true);
  const preferredName = settingsPayload?.effective_settings?.preferred_name ?? null;

  // A value counts as present only when the device actually measured it.
  const hasSolar = snapshot.solar.valueKw !== null && snapshot.solar.origin === 'observed';
  const hasHome = snapshot.homeLoad.valueKw !== null && snapshot.homeLoad.origin === 'observed';
  const hasGrid = snapshot.grid.valueKw !== null && snapshot.grid.origin === 'observed';

  // ── 1. Current assessment ────────────────────────────────────────────
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

  const subline = (() => {
    if (sourceType === 'demo') return `Demo-Daten${snapshot.timestamp ? ` · ${snapshot.timestamp}` : ''}`;
    if (snapshot.quality === 'stale') return `Veraltet${snapshot.timestamp ? ` · ${snapshot.timestamp}` : ''}`;
    // freshness_label already reads like "Aktuell · 19:17" — do not prefix it again.
    return snapshot.timestamp;
  })();
  const greeting = greetingEnabled ? {
    title: greetingTitle(new Date().getHours(), preferredName),
    summary: currentEnergyVerdict(snapshot, devices, locale),
  } : null;

  // ── 2. PV / home / grid ──────────────────────────────────────────────
  const solarTrend = recentSolarTrend(timeline);
  const gridKw = snapshot.grid.valueKw;
  const gridDetail = !hasGrid
    ? null
    : gridKw !== null && gridKw > 0
    ? 'Bezug'
    : gridKw !== null && gridKw < 0
    ? 'Einspeisung'
    : 'Kein Austausch';

  const flowItems = [
    {
      key: 'pv',
      icon: Sun,
      label: 'PV',
      value: hasSolar ? formatKw(snapshot.solar.valueKw, locale) : UNKNOWN_VALUE,
      accent: hasSolar ? 'text-amber-600 dark:text-amber-400' : UNKNOWN_ACCENT,
      detail: hasSolar ? `Gemessen${solarTrend ? ` · ${solarTrend}` : ''}` : 'Nicht verfügbar',
    },
    {
      key: 'home',
      icon: Home,
      label: 'Haus',
      value: hasHome ? formatKw(snapshot.homeLoad.valueKw, locale) : UNKNOWN_VALUE,
      accent: hasHome ? 'text-indigo-600 dark:text-indigo-400' : UNKNOWN_ACCENT,
      detail: hasHome ? 'Gemessen' : 'Nicht verfügbar',
    },
    {
      key: 'grid',
      icon: Zap,
      label: 'Netz',
      value: hasGrid && gridKw !== null ? formatKw(Math.abs(gridKw), locale) : UNKNOWN_VALUE,
      accent: !hasGrid ? UNKNOWN_ACCENT
        : gridKw !== null && gridKw > 0 ? 'text-orange-600 dark:text-orange-400'
        : gridKw !== null && gridKw < 0 ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-700 dark:text-slate-200',
      detail: gridDetail ?? 'Nicht verfügbar',
    },
  ];

  // ── 3. Day trend ─────────────────────────────────────────────────────
  const trendPoints = measuredPoints(timeline);
  const showTrend = hasEnoughEvidence(timeline);

  // ── 4. Device and data-source status ─────────────────────────────────
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

  return (
    <div className="cockpit-page flex flex-col gap-6" data-testid="now-workspace">
      {/* 1 — current assessment */}
      <CurrentEnergyBriefing
        title={greeting?.title ?? headline}
        verdict={greeting?.summary}
        timestamp={subline}
      />

      {/* 2 — PV / home / grid */}
      <section aria-label="Momentane Leistungswerte" className="cockpit-surface px-6 py-5 lg:px-8 lg:py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="cockpit-section-title">Energiefluss</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Live-Messwerte</span>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
          {flowItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <React.Fragment key={item.key}>
                {index > 0 && (
                  <span aria-hidden="true" className="hidden self-center text-center text-lg text-sky-600 dark:text-sky-400 sm:block">
                    →
                  </span>
                )}
                <div className="min-w-0 rounded-xl bg-slate-50/70 px-4 py-4 dark:bg-slate-800/45">
                  <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </div>
                  <div className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${item.accent}`}>
                    {item.value}
                    {item.value !== UNKNOWN_VALUE && (
                      <span className="ml-1.5 text-base font-medium text-slate-400 dark:text-slate-500">kW</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.detail}</p>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </section>

      <div className="cockpit-grid">

      {/* 3 — day trend */}
      <section aria-label="Tagesverlauf" className="cockpit-surface col-span-12 p-5 lg:col-span-8 lg:p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="cockpit-section-title">Tagesverlauf PV</h2>
          {showTrend && (
            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
              {formatNumber(trendPoints.length, locale)} Messpunkte
            </span>
          )}
        </div>
        {showTrend ? (
          <div className="mt-2">
            <DayTrendChart timeline={timeline} locale={locale} animate={animateCharts} size="workspace" />
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Noch nicht genug Messpunkte für einen Tagesverlauf.
          </p>
        )}
        {forecast?.headline && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Prognose: {forecast.headline}
          </p>
        )}
      </section>

      {/* 4 — device and data-source status */}
      <aside className="col-span-12 flex min-w-0 flex-col gap-4 lg:col-span-4">
        {weatherEnabled && <WeatherIntelligence report={weatherReport} locale={locale} compact snapshot={snapshot} />}
      <section
        aria-label="Systemstatus"
        className="cockpit-surface-muted px-5 py-4 text-xs text-slate-500 dark:text-slate-400"
      >
        <h2 className="cockpit-section-title mb-2">Datenquellen</h2>
        <p data-testid="system-status-row" className="leading-relaxed">{statusChips.join(' · ')}</p>
      </section>
      </aside>
      </div>
    </div>
  );
}
