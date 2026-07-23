/**
 * livingSky.ts — Deterministic Sky State Resolver for EnergyRadar (Sprint 5C)
 *
 * Computes exact sky phase, weather effect, motion mode, and background gradients
 * based on confirmed location timezone, ISO sunrise/sunset timestamps, and weather quality.
 */
import { CurrentWeatherData, SunData, WeatherQualityData } from '../types';

export type SkyPhase =
  | 'pre_dawn'
  | 'sunrise_dawn'
  | 'morning'
  | 'day'
  | 'golden_hour'
  | 'sunset_dusk'
  | 'evening'
  | 'night';

export type WeatherEffect =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'fog'
  | 'thunderstorm'
  | 'unknown';

export type SkyMode = 'full' | 'sun_only' | 'clock_only' | 'static';
export type MotionMode = 'full' | 'reduced' | 'none';

export interface LivingSkyInput {
  now?: Date;
  timezone?: string | null;
  sun?: SunData | null;
  currentWeather?: CurrentWeatherData | null;
  weatherQuality?: WeatherQualityData | null;
  isDay?: boolean | null;
  dynamicBackgroundEnabled: boolean;
  userMotionMode?: 'full' | 'reduced' | 'none' | null;
  osPrefersReducedMotion?: boolean;
}

export interface LivingSkyState {
  mode: SkyMode;
  phase: SkyPhase;
  weatherEffect: WeatherEffect | null;
  motion: MotionMode;
  gradientCss: string;
  overlayClass: string;
  dataQuality: 'fresh' | 'stale' | 'fallback';
}

/**
 * Parses an ISO date string safely. Returns timestamp in milliseconds or null.
 */
export function parseIsoTimestamp(isoStr?: string | null): number | null {
  if (!isoStr) return null;
  try {
    const dt = new Date(isoStr);
    const time = dt.getTime();
    return isNaN(time) ? null : time;
  } catch {
    return null;
  }
}

/**
 * Calculates daylight ratio and exact sky phase relative to sunrise & sunset.
 */
export function calculateSkyPhase(
  nowMs: number,
  sunriseMs: number | null,
  sunsetMs: number | null,
  isDayFallback?: boolean | null
): { phase: SkyPhase; mode: 'sun_only' | 'clock_only' } {
  if (sunriseMs !== null && sunsetMs !== null && sunsetMs > sunriseMs) {
    const sunrisePre30 = sunriseMs - 30 * 60 * 1000;
    const sunrisePost20 = sunriseMs + 20 * 60 * 1000;
    const sunsetPre60 = sunsetMs - 60 * 60 * 1000;
    const sunsetPost30 = sunsetMs + 30 * 60 * 1000;
    const sunsetPost90 = sunsetMs + 90 * 60 * 1000;

    const dayWindow = sunsetMs - sunriseMs;
    const morningEnd = sunriseMs + dayWindow * 0.35;

    if (nowMs < sunrisePre30) {
      return { phase: 'night', mode: 'sun_only' };
    }
    if (nowMs >= sunrisePre30 && nowMs < sunriseMs) {
      return { phase: 'pre_dawn', mode: 'sun_only' };
    }
    if (nowMs >= sunriseMs && nowMs < sunrisePost20) {
      return { phase: 'sunrise_dawn', mode: 'sun_only' };
    }
    if (nowMs >= sunrisePost20 && nowMs < morningEnd) {
      return { phase: 'morning', mode: 'sun_only' };
    }
    if (nowMs >= morningEnd && nowMs < sunsetPre60) {
      return { phase: 'day', mode: 'sun_only' };
    }
    if (nowMs >= sunsetPre60 && nowMs < sunsetMs) {
      return { phase: 'golden_hour', mode: 'sun_only' };
    }
    if (nowMs >= sunsetMs && nowMs < sunsetPost30) {
      return { phase: 'sunset_dusk', mode: 'sun_only' };
    }
    if (nowMs >= sunsetPost30 && nowMs < sunsetPost90) {
      return { phase: 'evening', mode: 'sun_only' };
    }
    return { phase: 'night', mode: 'sun_only' };
  }

  // Fallback 1: isDay boolean signal
  if (isDayFallback !== undefined && isDayFallback !== null) {
    return { phase: isDayFallback ? 'day' : 'night', mode: 'clock_only' };
  }

  // Fallback 2: Local clock hour fallback
  const hour = new Date(nowMs).getHours();
  if (hour >= 6 && hour < 8) return { phase: 'sunrise_dawn', mode: 'clock_only' };
  if (hour >= 8 && hour < 11) return { phase: 'morning', mode: 'clock_only' };
  if (hour >= 11 && hour < 17) return { phase: 'day', mode: 'clock_only' };
  if (hour >= 17 && hour < 19) return { phase: 'golden_hour', mode: 'clock_only' };
  if (hour >= 19 && hour < 21) return { phase: 'sunset_dusk', mode: 'clock_only' };
  if (hour >= 21 && hour < 23) return { phase: 'evening', mode: 'clock_only' };
  return { phase: 'night', mode: 'clock_only' };
}

/**
 * Returns tailored CSS gradient variables based on sky phase and weather condition.
 */
export function getSkyGradient(phase: SkyPhase, weather?: WeatherEffect | null): string {
  if (weather === 'thunderstorm') {
    return 'linear-gradient(180deg, #1A1C29 0%, #2A2D40 50%, #151722 100%)';
  }
  if (weather === 'heavy_rain' || weather === 'rain') {
    return 'linear-gradient(180deg, #2B3542 0%, #3B4758 50%, #232B36 100%)';
  }
  if (weather === 'cloudy' || weather === 'fog') {
    return 'linear-gradient(180deg, #3C4453 0%, #515B6E 50%, #2E3543 100%)';
  }

  switch (phase) {
    case 'pre_dawn':
      return 'linear-gradient(180deg, #0B1021 0%, #1B264B 60%, #3B3C68 100%)';
    case 'sunrise_dawn':
      return 'linear-gradient(180deg, #1E295D 0%, #7B4B70 40%, #E8837B 80%, #F8C390 100%)';
    case 'morning':
      return 'linear-gradient(180deg, #2E6CB5 0%, #5B95D6 50%, #A2C8EC 100%)';
    case 'day':
      return 'linear-gradient(180deg, #1C5EA8 0%, #3B82C4 50%, #76AEE3 100%)';
    case 'golden_hour':
      return 'linear-gradient(180deg, #2D4373 0%, #9B5665 40%, #E67A58 75%, #F4B86A 100%)';
    case 'sunset_dusk':
      return 'linear-gradient(180deg, #161D42 0%, #4D335A 45%, #C25056 80%, #E28459 100%)';
    case 'evening':
      return 'linear-gradient(180deg, #0E1329 0%, #1F2544 50%, #393E62 100%)';
    case 'night':
    default:
      return 'linear-gradient(180deg, #060913 0%, #0E1528 50%, #161F36 100%)';
  }
}

/**
 * Pure, deterministic Living Sky Resolver Function (Directive 2).
 */
export function resolveLivingSky(input: LivingSkyInput): LivingSkyState {
  // Determine effective motion mode (User choice overrides OS preference)
  let motion: MotionMode = 'full';
  if (input.userMotionMode) {
    motion = input.userMotionMode;
  } else if (input.osPrefersReducedMotion) {
    motion = 'reduced';
  }

  // 1. Static Theme Fallback (Disabled or Motion = 'none' or Dynamic BG = false)
  if (!input.dynamicBackgroundEnabled || motion === 'none') {
    return {
      mode: 'static',
      phase: 'day',
      weatherEffect: null,
      motion: 'none',
      gradientCss: 'none',
      overlayClass: 'static-bg',
      dataQuality: 'fallback',
    };
  }

  const nowMs = input.now ? input.now.getTime() : Date.now();
  const sunriseMs = parseIsoTimestamp(input.sun?.sunrise);
  const sunsetMs = parseIsoTimestamp(input.sun?.sunset);

  const { phase, mode: baseMode } = calculateSkyPhase(nowMs, sunriseMs, sunsetMs, input.isDay);

  // Weather Effect Quality Check (Directive 5)
  // Only 'fresh' or 'stale' data can drive weather effects. 'expired' or 'unknown' reverts to sun/time phase only.
  const freshness = input.weatherQuality?.freshness || 'unknown';
  let weatherEffect: WeatherEffect | null = null;
  let dataQuality: 'fresh' | 'stale' | 'fallback' = 'fallback';

  if (freshness === 'fresh') {
    weatherEffect = (input.currentWeather?.condition as WeatherEffect) || null;
    dataQuality = 'fresh';
  } else if (freshness === 'stale') {
    // Stale: use weather effect without dynamic intensification
    weatherEffect = (input.currentWeather?.condition as WeatherEffect) || null;
    dataQuality = 'stale';
  }

  const mode: SkyMode = weatherEffect && weatherEffect !== 'unknown' ? 'full' : baseMode;
  const gradientCss = getSkyGradient(phase, weatherEffect);

  return {
    mode,
    phase,
    weatherEffect,
    motion,
    gradientCss,
    overlayClass: `sky-phase-${phase} weather-${weatherEffect || 'none'} motion-${motion}`,
    dataQuality,
  };
}
