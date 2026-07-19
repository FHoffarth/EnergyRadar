// ---------- Energy Intelligence Layer ----------
//
// Einziger Ort, an dem Rohtelemetrie in einen präsentierbaren UI-Zustand
// übersetzt wird. Komponenten abonnieren ausschließlich diesen State.

(function () {
  "use strict";

  const TIME_REFRESH_MS = 60 * 1000;
  const NO_PRODUCTION_MAX = 10;
  const LOW_PRODUCTION_MAX = 500;
  const HIGH_PRODUCTION_MIN = 1500;
  const MAX_VISUAL_POWER = 4000;
  const TREND_WINDOW = 10;
  const TREND_THRESHOLD_WATTS = 150;

  const listeners = new Set();
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const phases = [
    { at: 0,    name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],    horizon: [27, 45, 67],    glow: [90, 119, 160],  stars: 0.28, glowX: 50, glowY: 100 },
    { at: 300,  name: "sunrise",   top: [25, 52, 88], mid: [78, 110, 142],  horizon: [214, 154, 129], glow: [255, 177, 112], stars: 0.08, glowX: 18, glowY: 76 },
    { at: 480,  name: "morning",   top: [61, 122, 178], mid: [112, 160, 198], horizon: [201, 194, 174], glow: [255, 216, 154], stars: 0, glowX: 32, glowY: 48 },
    { at: 690,  name: "noon",      top: [69, 132, 188], mid: [124, 174, 208], horizon: [213, 202, 174], glow: [255, 222, 158], stars: 0, glowX: 50, glowY: 34 },
    { at: 870,  name: "afternoon", top: [66, 116, 169], mid: [128, 157, 186], horizon: [219, 183, 139], glow: [255, 190, 100], stars: 0, glowX: 68, glowY: 48 },
    { at: 1080, name: "sunset",    top: [49, 69, 118], mid: [162, 105, 132], horizon: [229, 139, 106], glow: [255, 141, 87],  stars: 0.03, glowX: 82, glowY: 73 },
    { at: 1260, name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],    horizon: [27, 45, 67],    glow: [90, 119, 160],  stars: 0.28, glowX: 50, glowY: 100 },
    { at: 1440, name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],    horizon: [27, 45, 67],    glow: [90, 119, 160],  stars: 0.28, glowX: 50, glowY: 100 },
  ];

  const accentTokens = {
    unknown: { dark: [138, 155, 173], light: [92, 107, 122] },
    none:    { dark: [143, 180, 217], light: [76, 118, 158] },
    low:     { dark: [255, 229, 143], light: [190, 132, 0] },
    medium:  { dark: [255, 213, 74],  light: [232, 162, 0] },
    high:    { dark: [255, 199, 55],  light: [218, 139, 0] },
    unreachable: { dark: [202, 104, 82], light: [166, 72, 55] },
  };

  let telemetry = {
    connection: "connecting",
    source: null,
    powerWatts: null,
    history: [],
    grid: "unknown",
  };

  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
  }

  function mix(a, b, amount) {
    return a + (b - a) * amount;
  }

  function mixRgb(a, b, amount) {
    return a.map((channel, index) => Math.round(mix(channel, b[index], amount)));
  }

  function rgb(value) {
    return value.join(" ");
  }

  function deriveTime(date) {
    const minute = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
    let index = 0;
    while (index < phases.length - 2 && minute >= phases[index + 1].at) index += 1;

    const from = phases[index];
    const to = phases[index + 1];
    const progress = clamp((minute - from.at) / (to.at - from.at));

    return {
      phase: progress < 0.5 ? from.name : to.name,
      sky: {
        top: rgb(mixRgb(from.top, to.top, progress)),
        mid: rgb(mixRgb(from.mid, to.mid, progress)),
        horizon: rgb(mixRgb(from.horizon, to.horizon, progress)),
        glow: rgb(mixRgb(from.glow, to.glow, progress)),
        starsOpacity: mix(from.stars, to.stars, progress).toFixed(3),
        glowX: `${mix(from.glowX, to.glowX, progress).toFixed(1)}%`,
        glowY: `${mix(from.glowY, to.glowY, progress).toFixed(1)}%`,
      },
    };
  }

  function deriveProduction(powerWatts, connection) {
    if (connection !== "online" || !Number.isFinite(powerWatts)) return "unknown";
    if (powerWatts <= NO_PRODUCTION_MAX) return "none";
    if (powerWatts < LOW_PRODUCTION_MAX) return "low";
    if (powerWatts < HIGH_PRODUCTION_MIN) return "medium";
    return "high";
  }

  function deriveTrend(history, production) {
    if (production === "unknown" || production === "none") return "unknown";
    const powers = (history || [])
      .map((item) => Number(item.power))
      .filter(Number.isFinite);
    if (powers.length < 3) return "unknown";

    const span = Math.min(TREND_WINDOW, powers.length - 1);
    const change = powers[powers.length - 1] - powers[powers.length - 1 - span];
    if (change >= TREND_THRESHOLD_WATTS) return "rising";
    if (change <= -TREND_THRESHOLD_WATTS) return "falling";
    return "stable";
  }

  function deriveAssessment(connection, production, trend) {
    if (connection === "connecting") {
      return { headlineKey: "connecting", detailKey: null };
    }
    if (connection === "unconfigured") {
      return { headlineKey: "noDataSource", detailKey: "connectFroniusPrompt" };
    }
    if (connection === "testing") {
      return { headlineKey: "testingConnection", detailKey: null };
    }
    if (connection === "unreachable") {
      return { headlineKey: "deviceUnreachable", detailKey: "checkConnectionPrompt" };
    }

    const headlineKey = {
      none: "productionNone",
      low: "productionLow",
      medium: "productionMedium",
      high: "productionHigh",
      unknown: "productionUnknown",
    }[production];

    const detailKey = {
      rising: "trendRising",
      falling: "trendFalling",
      stable: "trendStable",
      unknown: null,
    }[trend];

    return { headlineKey, detailKey };
  }

  function deriveEnergyVisual(powerWatts, production, connection, grid) {
    let brightness = 1;
    let saturation = 1;
    let glow = 0.34;

    if (production === "unknown") {
      brightness = 0.9;
      saturation = 0.9;
      glow = 0.2;
    } else if (production === "none" || production === "low") {
      const low = clamp((Number(powerWatts) || 0) / LOW_PRODUCTION_MAX);
      brightness = mix(0.88, 1, low);
      saturation = mix(0.88, 1, low);
      glow = mix(0.18, 0.3, low);
    } else if (production === "high") {
      const high = clamp((powerWatts - HIGH_PRODUCTION_MIN) / (MAX_VISUAL_POWER - HIGH_PRODUCTION_MIN));
      brightness = mix(1, 1.08, high);
      saturation = mix(1, 1.04, high);
      glow = mix(0.34, 0.48, high);
    }

    // Nur ein explizites späteres Netzsignal darf diesen Zustand aktivieren.
    if (grid === "importing") {
      brightness *= 0.94;
      saturation *= 0.9;
      glow *= 0.72;
    }

    if (connection === "unreachable") {
      brightness *= 0.92;
      saturation *= 0.9;
      glow *= 0.8;
    }

    return {
      brightness: brightness.toFixed(2),
      saturation: saturation.toFixed(2),
      glowStrength: glow.toFixed(2),
    };
  }

  function deriveMotion(production, connection) {
    const reduced = motionQuery.matches;
    const calm = connection !== "online" || production === "none" || production === "low";
    return {
      mode: reduced ? "reduced" : calm ? "calm" : "ambient",
      reduced,
      atmosphereDuration: reduced ? "0s" : calm ? "190s" : "140s",
      glowDuration: reduced ? "0s" : calm ? "240s" : "180s",
      entranceDuration: reduced ? "0s" : "420ms",
      valueDurationMs: reduced ? 0 : 520,
    };
  }

  function freezeState(value) {
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object" && !Object.isFrozen(child)) freezeState(child);
    });
    return Object.freeze(value);
  }

  function deriveState() {
    const time = deriveTime(new Date());
    const production = deriveProduction(telemetry.powerWatts, telemetry.connection);
    const trend = deriveTrend(telemetry.history, production);
    const accentKey = telemetry.connection === "unreachable" ? "unreachable" : production;
    const accent = accentTokens[accentKey] || accentTokens.unknown;

    return freezeState({
      phase: time.phase,
      production,
      trend,
      connection: telemetry.connection,
      source: telemetry.source,
      powerWatts: telemetry.powerWatts,
      grid: telemetry.grid,
      assessment: deriveAssessment(telemetry.connection, production, trend),
      appearance: {
        accentDark: rgb(accent.dark),
        accentLight: rgb(accent.light),
        gaugeFraction: clamp((Number(telemetry.powerWatts) || 0) / MAX_VISUAL_POWER),
        sky: {
          ...time.sky,
          ...deriveEnergyVisual(
            telemetry.powerWatts,
            production,
            telemetry.connection,
            telemetry.grid
          ),
        },
      },
      motion: deriveMotion(production, telemetry.connection),
    });
  }

  let state = deriveState();

  function publish() {
    state = deriveState();
    listeners.forEach((listener) => listener(state));
  }

  function updateTelemetry(next = {}) {
    const supportedConnections = new Set([
      "connecting", "unconfigured", "testing", "online", "unreachable",
    ]);
    const connection = supportedConnections.has(next.connection)
      ? next.connection
      : "connecting";
    const online = connection === "online";
    telemetry = {
      connection,
      source: online && (next.source === "live" || next.source === "demo") ? next.source : null,
      powerWatts: online && Number.isFinite(Number(next.powerWatts)) ? Math.max(0, Number(next.powerWatts)) : null,
      history: online && Array.isArray(next.history) ? next.history : [],
      grid: next.gridImport === true ? "importing" : "unknown",
    };
    publish();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function getSnapshot() {
    return state;
  }

  setInterval(publish, TIME_REFRESH_MS);
  motionQuery.addEventListener("change", publish);

  window.energyState = { updateTelemetry, subscribe, getSnapshot };
})();
