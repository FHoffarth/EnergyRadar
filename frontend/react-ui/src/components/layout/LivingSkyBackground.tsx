import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveLivingSky, LivingSkyState } from '../../lib/livingSky';

export function LivingSkyBackground() {
  const { settingsPayload, weatherReport } = useApp();

  const effective = settingsPayload?.effective_settings;

  // OS Reduced Motion Detection
  const [osReducedMotion, setOsReducedMotion] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setOsReducedMotion(mq.matches);

    const listener = (e: MediaQueryListEvent) => setOsReducedMotion(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  // Update timer (Directive 10: 60-second update interval, unmount cleanup)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Compute Sky State
  const skyState: LivingSkyState = resolveLivingSky({
    now,
    timezone: weatherReport?.location?.timezone || settingsPayload?.settings?.resolved_location?.timezone || null,
    sun: weatherReport?.sun || null,
    currentWeather: weatherReport?.current || null,
    weatherQuality: weatherReport?.quality || null,
    isDay: weatherReport?.current?.is_day ?? null,
    dynamicBackgroundEnabled: effective?.dynamic_bg_enabled ?? true,
    userMotionMode: effective?.motion_mode ?? 'full',
    osPrefersReducedMotion: osReducedMotion,
  });

  if (skyState.mode === 'static' || skyState.motion === 'none') {
    return null; // Renders standard static CSS background from Theme
  }

  return (
    <div
      aria-hidden="true"
      aria-label="Living Sky Background Layer"
      className={`fixed inset-0 pointer-events-none z-0 transition-opacity duration-1000 ${skyState.overlayClass}`}
      style={{
        background: skyState.gradientCss,
        opacity: skyState.motion === 'reduced' ? 0.85 : 1,
      }}
    >
      {/* Weather Overlay Texture (Clouds, Fog, Rain Scrims) */}
      {skyState.weatherEffect && skyState.weatherEffect !== 'clear' && (
        <div
          className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 ${
            skyState.weatherEffect === 'rain' || skyState.weatherEffect === 'heavy_rain'
              ? 'bg-slate-950/20'
              : skyState.weatherEffect === 'cloudy'
              ? 'bg-slate-900/15'
              : skyState.weatherEffect === 'fog'
              ? 'bg-slate-200/10 dark:bg-slate-800/20'
              : ''
          }`}
        />
      )}

      {/* Stable Readability Scrim (Directive 9) */}
      <div
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-slate-950/10 to-slate-950/30 dark:via-slate-950/30 dark:to-slate-950/60"
      />
    </div>
  );
}
