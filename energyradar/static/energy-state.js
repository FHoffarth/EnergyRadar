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
    { at: 0, name: "night" }, { at: 300, name: "sunrise" },
    { at: 480, name: "morning" }, { at: 690, name: "noon" },
    { at: 870, name: "afternoon" }, { at: 1080, name: "sunset" },
    { at: 1260, name: "night" }, { at: 1440, name: "night" },
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

    return { phase: progress < 0.5 ? from.name : to.name };
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
