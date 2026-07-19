"use strict";

const LANGUAGE = (navigator.languages?.[0] || navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
const LOCALE = LANGUAGE === "de" ? "de-DE" : "en-US";
const messages = {
  de: {
    themeToggle: "Darstellung wechseln", energyState: "Aktueller Energiezustand", currentPower: "Aktuelle Solarleistung",
    insight: "Insight", today: "Heute erzeugt", peak: "Höchste Leistung", year: "Dieses Jahr", lifetime: "Insgesamt",
    todayChart: "Tagesverlauf", updated: "Aktualisiert um", greetingMorning: "Guten Morgen.", greetingDay: "Guten Tag.",
    greetingEvening: "Guten Abend.", greetingNight: "Gute Nacht.", connecting: "Verbindung wird hergestellt",
    noDataSource: "Keine Datenquelle eingerichtet", testingConnection: "Verbindung wird getestet", connected: "Verbunden",
    connectionFailed: "Verbindung fehlgeschlagen", deviceUnreachable: "Anlage momentan nicht erreichbar",
    connectFroniusPrompt: "Verbinde EnergyRadar mit deiner Fronius-Anlage, um Live-Daten zu sehen.",
    checkConnectionPrompt: "Prüfe, ob die Anlage eingeschaltet und im lokalen Netzwerk erreichbar ist.",
    connectSystem: "Energiesystem verbinden", editConnection: "Verbindung bearbeiten", demo: "Demo-Modus",
    productionUnknown: "Noch liegen keine Produktionsdaten vor.", productionNone: "Die Anlage erzeugt momentan keinen Solarstrom.",
    productionLow: "Die Anlage erzeugt momentan wenig Solarstrom.", productionMedium: "Die Anlage produziert gleichmäßig.",
    productionHigh: "Deine Anlage läuft heute hervorragend.", trendRising: "Die Produktion steigt.",
    trendFalling: "Die Produktion geht langsam zurück.", trendStable: "Die Produktion ist stabil.",
    memory: "Heute {energy} kWh erzeugt · Hoch um {time} Uhr", energySystem: "Energiesystem", setupTitle: "Fronius verbinden",
    setupIntro: "Die Verbindung bleibt auf diesem Gerät gespeichert. EnergyRadar akzeptiert nur Ziele im lokalen Netzwerk.",
    provider: "Anbieter", address: "IP-Adresse oder Hostname", addressHint: "Zum Beispiel fronius.local oder eine private IP-Adresse.",
    testConnection: "Verbindung testen", saveLocally: "Lokal speichern", removeConnection: "Verbindung entfernen",
    testSuccess: "Fronius ist erreichbar. Du kannst die Verbindung jetzt speichern.", saveSuccess: "Verbindung lokal gespeichert.",
    removeSuccess: "Verbindung entfernt.", unsafeTarget: "Nur sichere Adressen im lokalen Netzwerk sind erlaubt.",
    invalidAddress: "Bitte gib eine gültige lokale IP-Adresse oder einen Hostnamen ein.", environmentOverride: "FRONIUS_URL ist aktiv und hat Vorrang vor lokalen Einstellungen.",
    heroNone: "Momentan wird kein Solarstrom erzeugt.", heroLow: "Deine Anlage erzeugt gerade wenig Solarstrom.",
    heroMedium: "Deine Anlage erzeugt gerade gleichmäßig Solarstrom.", heroHigh: "Deine Anlage erzeugt gerade viel Solarstrom.",
    heroNight: "Es ist Nacht. Die aktuelle Leistung bleibt jederzeit abrufbar.",
  },
  en: {
    themeToggle: "Switch appearance", energyState: "Current energy status", currentPower: "Current solar power",
    insight: "Insight", today: "Generated today", peak: "Highest power", year: "This year", lifetime: "Lifetime",
    todayChart: "Daily production", updated: "Updated at", greetingMorning: "Good morning.", greetingDay: "Good day.",
    greetingEvening: "Good evening.", greetingNight: "Good night.", connecting: "Connecting",
    noDataSource: "No data source configured", testingConnection: "Testing connection", connected: "Connected",
    connectionFailed: "Connection failed", deviceUnreachable: "System currently unreachable",
    connectFroniusPrompt: "Connect EnergyRadar to your Fronius system to see live data.",
    checkConnectionPrompt: "Check that the system is on and reachable on your local network.",
    connectSystem: "Connect energy system", editConnection: "Edit connection", demo: "Demo mode",
    productionUnknown: "Production data is not available yet.", productionNone: "The system is not producing solar power right now.",
    productionLow: "The system is producing a small amount of solar power.", productionMedium: "The system is producing steadily.",
    productionHigh: "Your system is performing very well today.", trendRising: "Production is rising.",
    trendFalling: "Production is gradually falling.", trendStable: "Production is stable.",
    memory: "Generated {energy} kWh today · peak at {time}", energySystem: "Energy system", setupTitle: "Connect Fronius",
    setupIntro: "The connection is stored on this device. EnergyRadar accepts local-network targets only.",
    provider: "Provider", address: "IP address or hostname", addressHint: "For example fronius.local or a private IP address.",
    testConnection: "Test connection", saveLocally: "Save locally", removeConnection: "Remove connection",
    testSuccess: "Fronius is reachable. You can now save the connection.", saveSuccess: "Connection saved locally.",
    removeSuccess: "Connection removed.", unsafeTarget: "Only safe local-network addresses are allowed.",
    invalidAddress: "Enter a valid local IP address or hostname.", environmentOverride: "FRONIUS_URL is active and takes precedence over local settings.",
    heroNone: "No solar power is being generated right now.", heroLow: "Your system is producing a small amount of solar power.",
    heroMedium: "Your system is producing solar power steadily.", heroHigh: "Your system is producing a high amount of solar power.",
    heroNight: "It is night. Current system data remains available.",
  },
};
const t = (key) => messages[LANGUAGE][key] || key;
const nf = { int: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }), dec2: new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };

function initLanguage() {
  document.documentElement.lang = LANGUAGE;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}

const THEME_KEY = "energyradar-theme";
const themeQuery = window.matchMedia("(prefers-color-scheme: light)");
const storedTheme = () => localStorage.getItem(THEME_KEY);
const systemTheme = () => themeQuery.matches ? "light" : "dark";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("theme-toggle").textContent = theme === "dark" ? "☀" : "◐";
  document.getElementById("meta-theme").content = theme === "dark" ? "#07111E" : "#F6F3ED";
  restyleChart();
}
function initTheme() {
  applyTheme(storedTheme() || systemTheme());
  themeQuery.addEventListener("change", () => { if (!storedTheme()) applyTheme(systemTheme()); });
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next); applyTheme(next);
  });
}

function animateNumber(el, target, format) {
  const start = Number(el.dataset.v || 0); const duration = window.energyState.getSnapshot().motion.valueDurationMs;
  if (!duration || start === target) { el.textContent = format.format(target); el.dataset.v = target; return; }
  const started = performance.now();
  const step = (now) => { const p = Math.min((now - started) / duration, 1); const value = start + (target - start) * (1 - Math.pow(1 - p, 3)); el.textContent = format.format(value); if (p < 1) requestAnimationFrame(step); };
  el.dataset.v = target; requestAnimationFrame(step);
}
function powerParts(watts) { return watts >= 1000 ? { target: watts / 1000, unit: "kW", format: nf.dec2 } : { target: watts, unit: "W", format: nf.int }; }
function displayPower(el, unitEl, watts) { const p = powerParts(watts); if (unitEl.textContent !== p.unit) el.dataset.v = p.target; unitEl.textContent = p.unit; animateNumber(el, p.target, p.format); }
function displayEnergy(el, value) { animateNumber(el, value, value < 1000 ? nf.dec2 : nf.int); }
function clearTelemetry() {
  [["power", "–"], ["today", "–"], ["peak", "–"], ["year", "–"], ["total", "–"]].forEach(([id, value]) => { const el = document.getElementById(id); el.textContent = value; delete el.dataset.v; });
  document.getElementById("peak-time").textContent = "";
  const memory = document.getElementById("memory"); memory.textContent = ""; memory.hidden = true;
  updateChart([]);
}
function greetingForPhase(phase) { return t(phase === "morning" || phase === "sunrise" ? "greetingMorning" : phase === "sunset" ? "greetingEvening" : phase === "night" ? "greetingNight" : "greetingDay"); }
function heroMessage(state) {
  if (state.connection !== "online") return t(state.assessment.headlineKey);
  if (state.phase === "night") return t("heroNight");
  return t({ none: "heroNone", low: "heroLow", medium: "heroMedium", high: "heroHigh", unknown: "productionUnknown" }[state.production]);
}
function setGauge(fraction) { document.getElementById("gauge-fill").style.strokeDashoffset = String(264 * (1 - Math.min(1, Math.max(0, fraction)))); }

function applyEnergyState(state) {
  const root = document.documentElement;
  root.dataset.production = state.production; root.dataset.connection = state.connection; root.dataset.motion = state.motion.mode;
  root.style.setProperty("--energy-accent-dark", state.appearance.accentDark); root.style.setProperty("--energy-accent-light", state.appearance.accentLight);
  root.style.setProperty("--presence-enter-duration", state.motion.entranceDuration);
  document.getElementById("greeting").textContent = greetingForPhase(state.phase);
  document.getElementById("message").textContent = heroMessage(state);
  document.getElementById("recommendation").textContent = t(state.assessment.headlineKey);
  const detail = document.getElementById("action"); detail.textContent = state.assessment.detailKey ? t(state.assessment.detailKey) : ""; detail.hidden = !state.assessment.detailKey;
  if (Number.isFinite(state.powerWatts)) displayPower(document.getElementById("power"), document.getElementById("power-unit"), state.powerWatts);
  else { document.getElementById("power").textContent = "–"; document.getElementById("power-unit").textContent = "W"; }
  setGauge(state.appearance.gaugeFraction);
  const badge = document.getElementById("badge");
  badge.textContent = state.connection === "unconfigured" ? t("noDataSource") : state.connection === "testing" ? t("testingConnection") : state.connection === "unreachable" ? t("deviceUnreachable") : state.connection === "online" ? (state.source === "demo" ? t("demo") : t("connected")) : t("connecting");
  const cta = document.getElementById("setup-cta"); cta.hidden = !["unconfigured", "unreachable"].includes(state.connection); cta.textContent = state.connection === "unconfigured" ? t("connectSystem") : t("editConnection");
  restyleChart();
}

let chart = null;
function themeStyles() { const cs = getComputedStyle(document.documentElement); return { line: cs.getPropertyValue("--chart-line").trim(), fill: cs.getPropertyValue("--chart-fill").trim(), grid: cs.getPropertyValue("--chart-grid").trim(), muted: cs.getPropertyValue("--muted").trim(), tooltip: cs.getPropertyValue("--tooltip-bg").trim() }; }
function chartGradient() { const s = themeStyles(); const canvas = document.getElementById("chart"); const gradient = canvas.getContext("2d").createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 220); gradient.addColorStop(0, `rgb(${s.fill} / .16)`); gradient.addColorStop(1, `rgb(${s.fill} / 0)`); return gradient; }
function initChart() {
  const s = themeStyles(); chart = new Chart(document.getElementById("chart"), { type: "line", data: { labels: [], datasets: [{ data: [], borderColor: s.line, backgroundColor: chartGradient(), borderWidth: 1.5, fill: true, pointRadius: 0, tension: .4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: s.tooltip, displayColors: false, callbacks: { label: (item) => nf.int.format(item.parsed.y) + " W" } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: s.muted, maxTicksLimit: 6, maxRotation: 0 } }, y: { beginAtZero: true, border: { display: false }, grid: { color: s.grid }, ticks: { color: s.muted, maxTicksLimit: 4, callback: (v) => v >= 1000 ? nf.dec2.format(v / 1000) + " kW" : nf.int.format(v) + " W" } } } } });
}
function restyleChart() { if (!chart) return; const s = themeStyles(); chart.data.datasets[0].borderColor = s.line; chart.data.datasets[0].backgroundColor = chartGradient(); chart.options.plugins.tooltip.backgroundColor = s.tooltip; chart.options.scales.x.ticks.color = s.muted; chart.options.scales.y.ticks.color = s.muted; chart.options.scales.y.grid.color = s.grid; chart.update("none"); }
function updateChart(history) {
  if (!chart) return;
  const hasHistory = history.length > 0;
  chart.canvas.parentElement.dataset.empty = String(!hasHistory);
  chart.data.labels = history.map((h) => h.time);
  chart.data.datasets[0].data = history.map((h) => h.power);
  chart.options.scales.x.display = hasHistory;
  chart.options.scales.y.display = hasHistory;
  chart.update("none");
}
new ResizeObserver(() => restyleChart()).observe(document.querySelector(".chart-wrap"));

const dialog = document.getElementById("setup-dialog");
const addressInput = document.getElementById("source-address");
const setupStatus = document.getElementById("setup-status");
let sourceConfig = { configured: false, source: null, address: "", editable: true };
function setupMessage(key, tone = "") { setupStatus.textContent = t(key); setupStatus.dataset.tone = tone; }
async function loadSourceConfig() {
  const response = await fetch("/api/data-source"); sourceConfig = await response.json();
  addressInput.value = sourceConfig.address || ""; addressInput.disabled = sourceConfig.editable === false;
  document.getElementById("save-connection").disabled = sourceConfig.editable === false;
  document.getElementById("remove-connection").hidden = !sourceConfig.configured || sourceConfig.editable === false;
  if (sourceConfig.source === "environment") setupMessage("environmentOverride", "info");
}
async function openSetup() { try { await loadSourceConfig(); } catch { setupMessage("connectionFailed", "error"); } if (!dialog.open) dialog.showModal(); addressInput.focus(); }
async function callConnection(method, path) {
  const buttons = dialog.querySelectorAll("button"); buttons.forEach((button) => { button.disabled = true; });
  setupMessage("testingConnection", "info"); window.energyState.updateTelemetry({ connection: "testing" });
  try {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify({ provider: "fronius", address: addressInput.value }) });
    const result = await response.json();
    if (!response.ok || !result.ok) { const key = result.message === "unsafe_target" ? "unsafeTarget" : result.message === "invalid_address" ? "invalidAddress" : result.message === "environment_override_active" ? "environmentOverride" : "connectionFailed"; setupMessage(key, "error"); window.energyState.updateTelemetry({ connection: sourceConfig.configured ? "unreachable" : "unconfigured" }); return false; }
    return true;
  } catch { setupMessage("connectionFailed", "error"); window.energyState.updateTelemetry({ connection: sourceConfig.configured ? "unreachable" : "unconfigured" }); return false; }
  finally { buttons.forEach((button) => { button.disabled = false; }); document.getElementById("save-connection").disabled = sourceConfig.editable === false; }
}
document.getElementById("connection-button").addEventListener("click", openSetup);
document.getElementById("setup-cta").addEventListener("click", openSetup);
document.getElementById("setup-close").addEventListener("click", () => dialog.close());
document.getElementById("test-connection").addEventListener("click", async () => { if (await callConnection("POST", "/api/data-source/test")) { setupMessage("testSuccess", "success"); await update(); } });
document.getElementById("save-connection").addEventListener("click", async () => { if (await callConnection("POST", "/api/data-source")) { setupMessage("saveSuccess", "success"); await loadSourceConfig(); await update(); } });
document.getElementById("remove-connection").addEventListener("click", async () => { if (await callConnection("DELETE", "/api/data-source")) { setupMessage("removeSuccess", "success"); await loadSourceConfig(); clearTelemetry(); window.energyState.updateTelemetry({ connection: "unconfigured" }); } });
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

async function update() {
  try {
    const response = await fetch("/api/live"); const data = await response.json();
    if (!data.ok) { clearTelemetry(); window.energyState.updateTelemetry({ connection: data.status === "no_data_source_configured" ? "unconfigured" : "unreachable" }); return; }
    window.energyState.updateTelemetry({ connection: "online", source: data.source, powerWatts: data.power, history: data.history, gridImport: data.grid_import });
    displayEnergy(document.getElementById("today"), data.today_kwh); displayEnergy(document.getElementById("year"), data.year_kwh); displayEnergy(document.getElementById("total"), data.total_kwh);
    if (data.peak_today !== null) { displayPower(document.getElementById("peak"), document.getElementById("peak-unit"), data.peak_today); document.getElementById("peak-time").textContent = LANGUAGE === "de" ? `${data.peak_time} Uhr` : data.peak_time; }
    updateChart(data.history || []);
    const memory = document.getElementById("memory");
    memory.textContent = data.peak_time ? t("memory").replace("{energy}", nf.dec2.format(data.today_kwh)).replace("{time}", data.peak_time) : "";
    memory.hidden = !data.peak_time;
    document.getElementById("updated").textContent = `${t("updated")} ${new Date().toLocaleTimeString(LOCALE)}`;
  } catch { clearTelemetry(); window.energyState.updateTelemetry({ connection: sourceConfig.configured ? "unreachable" : "unconfigured" }); }
}

initLanguage(); initTheme(); initChart(); window.energyState.subscribe(applyEnergyState);
loadSourceConfig().finally(update); setInterval(update, 5000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
