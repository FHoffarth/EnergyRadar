// ---------- Sprache & zentrale Texte ----------

// Deutsch und Englisch werden direkt aus der Systemsprache gewählt. Alle
// anderen Sprachen fallen bewusst auf Englisch zurück, bis sie unterstützt sind.
const LANGUAGE = (navigator.languages?.[0] || navigator.language || "en")
  .toLowerCase()
  .startsWith("de") ? "de" : "en";
const LOCALE = LANGUAGE === "de" ? "de-DE" : "en-US";

const messages = {
  de: {
    themeToggle: "Darstellung wechseln",
    energyState: "Aktueller Energiezustand",
    currentPower: "Aktuelle Leistung",
    assessment: "Energy Presence",
    today: "Heute",
    peak: "Peak heute",
    year: "Dieses Jahr",
    lifetime: "Gesamt",
    todayChart: "Heutiger Verlauf",
    connecting: "⚪ Verbinde …",
    live: "🟢 Live von Fronius",
    demo: "🟠 Demo-Modus",
    offline: "🔴 Offline",
    updated: "Zuletzt aktualisiert",
    connectionOffline: "Offline",
    productionUnknown: "Produktionsstatus unbekannt",
    productionNone: "Keine Solarproduktion",
    productionLow: "Geringe Solarproduktion",
    productionMedium: "Mittlere Solarproduktion",
    productionHigh: "Hohe Solarproduktion",
    trendRising: "Produktion steigt",
    trendFalling: "Produktion fällt",
    trendStable: "Produktion ist stabil",
  },
  en: {
    themeToggle: "Switch appearance",
    energyState: "Current energy status",
    currentPower: "Current Power",
    assessment: "Assessment",
    today: "Today",
    peak: "Today's Peak",
    year: "This Year",
    lifetime: "Lifetime",
    todayChart: "Today's Production",
    connecting: "⚪ Connecting …",
    live: "🟢 Live from Fronius",
    demo: "🟠 Demo Mode",
    offline: "🔴 Offline",
    updated: "Last updated",
    connectionOffline: "Offline",
    productionUnknown: "Production status unknown",
    productionNone: "No solar production",
    productionLow: "Low solar production",
    productionMedium: "Medium solar production",
    productionHigh: "High solar production",
    trendRising: "Production is rising",
    trendFalling: "Production is falling",
    trendStable: "Production is stable",
  },
};

function t(key) {
  return messages[LANGUAGE][key];
}

function initLanguage() {
  document.documentElement.lang = LANGUAGE;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
}

// ---------- Zentrale Zahlenformatierung ----------
// Eine einzige Quelle für Rundung und Darstellung, passend zur Systemsprache.

const nf = {
  int: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }),
  dec2: new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

// Leistung: unter 1000 W ganzzahlig in W, ab 1000 W mit zwei Nachkommastellen in kW.
// Die Einheit wird mitgeliefert, weil sie im Layout in einem eigenen Element steht.
function powerParts(watts) {
  return watts >= 1000
    ? { target: watts / 1000, unit: "kW", format: nf.dec2 }
    : { target: watts, unit: "W", format: nf.int };
}

// Energie: unter 1000 kWh mit zwei Nachkommastellen (6,63 kWh),
// ab 1000 kWh ganzzahlig mit Tausenderpunkt (1.619 kWh).
function energyFormat(kwh) {
  return kwh < 1000 ? nf.dec2 : nf.int;
}

// ---------- Theme (System-Erkennung, manueller Umschalter, localStorage) ----------

const THEME_KEY = "energyradar-theme";
const themeQuery = window.matchMedia("(prefers-color-scheme: light)");

function systemTheme() {
  return themeQuery.matches ? "light" : "dark";
}

function storedTheme() {
  return localStorage.getItem(THEME_KEY); // "light" | "dark" | null (= System)
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("theme-toggle").textContent =
    theme === "dark" ? "☀️" : "🌙";
  document.getElementById("meta-theme").content =
    theme === "dark" ? "#07111E" : "#F2F5F8";
  restyleChart();
}

function initTheme() {
  applyTheme(storedTheme() || systemTheme());

  // Solange keine manuelle Wahl getroffen wurde, dem System folgen
  themeQuery.addEventListener("change", () => {
    if (!storedTheme()) applyTheme(systemTheme());
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// ---------- Anzeige-Helfer ----------

// Animiert einen Zahlenwert und formatiert jeden Zwischenschritt über die
// übergebene, zentrale Formatierungsfunktion.
function animateNumber(el, target, format) {
  const start = parseFloat((el.dataset.v ?? "0")) || 0;
  const duration = window.energyState.getSnapshot().motion.valueDurationMs;
  if (duration === 0 || start === target) {
    el.textContent = format.format(target);
    el.dataset.v = target;
    return;
  }
  const t0 = performance.now();
  function step(t) {
    const p = Math.min((t - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const v = start + (target - start) * eased;
    el.textContent = format.format(v);
    if (p < 1) requestAnimationFrame(step);
  }
  el.dataset.v = target;
  requestAnimationFrame(step);
}

// Leistung anzeigen (Wert + Einheit) – Werte kommen aus der API.
function displayPower(el, unitEl, watts) {
  const p = powerParts(watts);
  // Beim Wechsel der Einheit nicht über die Skalen hinweg animieren.
  if (unitEl.textContent !== p.unit) el.dataset.v = p.target;
  unitEl.textContent = p.unit;
  animateNumber(el, p.target, p.format);
}

// Energie anzeigen (Einheit steht statisch im Markup).
function displayEnergy(el, kwh) {
  animateNumber(el, kwh, energyFormat(kwh));
}

// ---------- Energy State consumer ----------

function applyEnergyState(state) {
  const root = document.documentElement;
  root.dataset.production = state.production;
  root.dataset.connection = state.connection;
  root.dataset.motion = state.motion.mode;
  root.style.setProperty("--energy-accent-dark", state.appearance.accentDark);
  root.style.setProperty("--energy-accent-light", state.appearance.accentLight);
  root.style.setProperty("--presence-enter-duration", state.motion.entranceDuration);

  const powerEl = document.getElementById("power");
  const unitEl = document.getElementById("power-unit");
  if (Number.isFinite(state.powerWatts)) {
    displayPower(powerEl, unitEl, state.powerWatts);
  } else {
    powerEl.textContent = "–";
    powerEl.removeAttribute("data-v");
    unitEl.textContent = "W";
  }

  document.getElementById("recommendation").textContent =
    t(state.assessment.headlineKey);
  const detailEl = document.getElementById("action");
  detailEl.textContent = state.assessment.detailKey
    ? t(state.assessment.detailKey)
    : "";
  detailEl.hidden = !state.assessment.detailKey;

  const badge = document.getElementById("badge");
  if (state.connection === "connecting") badge.textContent = t("connecting");
  else if (state.connection === "offline") badge.textContent = t("offline");
  else if (state.source === "demo") badge.textContent = t("demo");
  else badge.textContent = t("live");

  restyleChart();
}

// ---------- Tagesdiagramm ----------

let chart = null;

function themeStyles() {
  const cs = getComputedStyle(document.documentElement);
  return {
    line: cs.getPropertyValue("--chart-line").trim(),
    fill: cs.getPropertyValue("--chart-fill").trim(),
    grid: cs.getPropertyValue("--chart-grid").trim(),
    muted: cs.getPropertyValue("--muted").trim(),
    tooltipBg: cs.getPropertyValue("--tooltip-bg").trim(),
  };
}

function chartGradient() {
  const s = themeStyles();
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  const height = canvas.parentElement.clientHeight || canvas.clientHeight || 240;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `rgb(${s.fill} / 0.25)`);
  gradient.addColorStop(1, `rgb(${s.fill} / 0)`);
  return gradient;
}

function initChart() {
  const s = themeStyles();
  const ctx = document.getElementById("chart").getContext("2d");

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: s.line,
        backgroundColor: chartGradient(),
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: s.tooltipBg,
          borderColor: "rgba(122, 141, 160, 0.3)",
          borderWidth: 1,
          titleColor: "#7A8DA0",
          bodyColor: "#FFFFFF",
          displayColors: false,
          callbacks: {
            label: (item) => nf.int.format(item.parsed.y) + " W",
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: s.muted,
            maxTicksLimit: 8,
            maxRotation: 0,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: s.grid },
          border: { display: false },
          ticks: {
            color: s.muted,
            font: { size: 11 },
            callback: (v) => nf.int.format(v) + " W",
          },
        },
      },
    },
  });
}

function restyleChart() {
  if (!chart) return;
  const s = themeStyles();
  chart.data.datasets[0].borderColor = s.line;
  chart.data.datasets[0].backgroundColor = chartGradient();
  chart.options.plugins.tooltip.backgroundColor = s.tooltipBg;
  chart.options.scales.x.ticks.color = s.muted;
  chart.options.scales.y.ticks.color = s.muted;
  chart.options.scales.y.grid.color = s.grid;
  chart.update("none");
}

function updateChart(history) {
  if (!chart) return;
  chart.data.labels = history.map((h) => h.time);
  chart.data.datasets[0].data = history.map((h) => h.power);
  chart.update("none");
}

// Die Diagrammfläche folgt dem verfügbaren Workspace statt einer festen Höhe.
// Bei Fensteränderungen wird auch der Verlauf an die neue Canvas-Höhe angepasst.
let chartResizeFrame = 0;
let chartWidth = 0;
let chartHeight = 0;

const chartResizeObserver = new ResizeObserver(([entry]) => {
  if (!chart || !entry) return;
  const width = Math.round(entry.contentRect.width);
  const height = Math.round(entry.contentRect.height);
  if (width === chartWidth && height === chartHeight) return;

  chartWidth = width;
  chartHeight = height;
  cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(() => {
    chart.data.datasets[0].backgroundColor = chartGradient();
    chart.update("none");
  });
});

chartResizeObserver.observe(document.querySelector(".chart-wrap"));

// ---------- Aktualisierung ----------

async function update() {
  try {
    const res = await fetch("/api/live");
    const d = await res.json();
    if (!d.ok) throw new Error("unreachable");

    window.energyState.updateTelemetry({
      connection: "online",
      source: d.source,
      powerWatts: d.power,
      history: d.history,
      gridImport: d.grid_import,
    });

    displayEnergy(document.getElementById("today"), d.today_kwh);
    displayEnergy(document.getElementById("year"), d.year_kwh);
    displayEnergy(document.getElementById("total"), d.total_kwh);

    if (d.peak_today !== null) {
      displayPower(
        document.getElementById("peak"),
        document.getElementById("peak-unit"),
        d.peak_today
      );
      document.getElementById("peak-time").textContent =
        LANGUAGE === "de" ? d.peak_time + " Uhr" : d.peak_time;
    }

    updateChart(d.history);

    document.getElementById("updated").textContent =
      t("updated") + " " + new Date().toLocaleTimeString(LOCALE);
  } catch {
    window.energyState.updateTelemetry({ connection: "offline" });
  }
}

// ---------- Start ----------

initLanguage();
initTheme();
initChart();
window.energyState.subscribe(applyEnergyState);
restyleChart();
update();
setInterval(update, 5000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
