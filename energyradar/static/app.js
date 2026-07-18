// ---------- Zentrale Zahlenformatierung (deutsch) ----------
// Eine einzige Quelle für Rundung und Darstellung. Erleichtert spätere i18n.

const nf = {
  int: new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }),
  dec2: new Intl.NumberFormat("de-DE", {
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
  const t0 = performance.now();
  const dur = 600;
  function step(t) {
    const p = Math.min((t - t0) / dur, 1);
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

// ---------- Assessment (regelbasiert, nur aus vorhandenen Messwerten) ----------

// Schwellen entsprechen der Backend-Einordnung, ergänzt um Trend-/Streuungsgrenzen.
const P_GOOD = 500;        // W – ab hier "gute" Produktion
const P_EXCELLENT = 1500;  // W – ab hier "exzellente" Produktion
const P_ACTIVE = 10;       // W – darunter gilt als keine Produktion
const RISE_FAST = 300;      // W Anstieg über ~10 Minuten = "schnell"
const NEAR_PEAK_RATIO = 0.9;
const NEAR_PEAK_MIN = 1000; // erst ab einem realen Tagesmaximum aussagekräftig
const NEAR_PEAK_FLAT = 150; // "am Peak" nur bei flachem Verlauf, nicht im Anstieg

// Leistungsänderung über die letzten ~span Messwerte (≈ Minuten).
function recentChange(powers, span = 10) {
  const n = powers.length;
  if (n < 3) return 0;
  const k = Math.min(span, n - 1);
  return powers[n - 1] - powers[n - 1 - k];
}

// Variationskoeffizient der letzten Messwerte – Maß für Schwankung.
function fluctuation(powers, window = 15) {
  const n = powers.length;
  if (n < 6) return 0;
  const w = powers.slice(n - window);
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  if (mean < 300) return 0; // nahe Null nicht als Schwankung werten
  const variance = w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length;
  return Math.sqrt(variance) / mean;
}

// Leitet aus den vorhandenen Daten eine ruhige Einordnung und – optional – eine
// kurze Handlungsempfehlung ab. Reihenfolge = Priorität.
function assess(d) {
  const power = d.power;
  const powers = (d.history || []).map((h) => h.power);
  const change = recentChange(powers);
  const cov = fluctuation(powers);
  const peak = d.peak_today || 0;
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  // "Nahe am Peak" meint ein Plateau auf hohem Niveau – nicht den Anstieg
  // dorthin (solange die Produktion steigt, ist das Tagesmaximum == aktueller
  // Wert und läge sonst fälschlich immer "am Peak").
  const nearPeak =
    peak >= NEAR_PEAK_MIN &&
    power >= NEAR_PEAK_RATIO * peak &&
    Math.abs(change) < NEAR_PEAK_FLAT;

  // Keine Produktion
  if (power <= P_ACTIVE) {
    return { text: "🌙 No solar production", action: "" };
  }

  // Produktion beginnt (morgens, niedrig, nicht fallend)
  if (power < P_GOOD && hour < 12 && change >= 0) {
    return {
      text: "🌅 Solar production has started",
      action: "Peak generation may still be ahead.",
    };
  }

  // Produktion klingt aus (abends, niedrig, fallend)
  if (power < P_GOOD && hour >= 14 && change < 0) {
    return {
      text: "🌇 Solar production is winding down",
      action: "Production is winding down for the day.",
    };
  }

  // Steigt schnell
  if (change >= RISE_FAST && power > P_GOOD) {
    return {
      text: "☀️ Production is increasing quickly",
      action: "Peak generation may still be ahead.",
    };
  }

  // Nahe am Tagesmaximum (hoch und nicht mehr stark steigend)
  if (nearPeak) {
    return {
      text: "🌞 Near today's production peak",
      action: "Good time to run energy-intensive appliances.",
    };
  }

  // Wechselhaft
  if (cov >= 0.35) {
    return {
      text: "🌤 Solar production is fluctuating",
      action: "Production is currently variable.",
    };
  }

  // Exzellente Produktion
  if (power > P_EXCELLENT) {
    return {
      text: "☀️ Excellent solar production",
      action: "Good time to run energy-intensive appliances.",
    };
  }

  // Gute Produktion
  if (power > P_GOOD) {
    return {
      text: "🌤 Good solar production",
      action: "Solar production is stable.",
    };
  }

  // Eingeschränkte Produktion
  return {
    text: "🌥 Limited solar production",
    action: "Production is currently limited.",
  };
}

function renderAssessment(d) {
  const { text, action } = assess(d);
  document.getElementById("recommendation").textContent = text;
  const actionEl = document.getElementById("action");
  actionEl.textContent = action;
  actionEl.hidden = !action;
  document.getElementById("assessment-card").dataset.level = d.level;
}

function clearAssessment(message) {
  document.getElementById("recommendation").textContent = message;
  const actionEl = document.getElementById("action");
  actionEl.textContent = "";
  actionEl.hidden = true;
  document.getElementById("assessment-card").dataset.level = "offline";
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
  gradient.addColorStop(0, `rgba(${s.fill}, 0.25)`);
  gradient.addColorStop(1, `rgba(${s.fill}, 0)`);
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
const chartResizeObserver = new ResizeObserver(() => {
  if (!chart) return;
  chart.data.datasets[0].backgroundColor = chartGradient();
  chart.resize();
  chart.update("none");
});

chartResizeObserver.observe(document.querySelector(".chart-wrap"));

// ---------- Aktualisierung ----------

async function update() {
  try {
    const res = await fetch("/api/live");
    const d = await res.json();
    if (!d.ok) throw new Error("unreachable");

    displayPower(
      document.getElementById("power"),
      document.getElementById("power-unit"),
      d.power
    );

    displayEnergy(document.getElementById("today"), d.today_kwh);
    displayEnergy(document.getElementById("year"), d.year_kwh);
    displayEnergy(document.getElementById("total"), d.total_kwh);

    if (d.peak_today !== null) {
      displayPower(
        document.getElementById("peak"),
        document.getElementById("peak-unit"),
        d.peak_today
      );
      document.getElementById("peak-time").textContent = d.peak_time + " Uhr";
    }

    updateChart(d.history);

    renderAssessment(d);
    setBadge(d.source);
    document.getElementById("updated").textContent =
      "Zuletzt aktualisiert " + new Date().toLocaleTimeString("de-DE");
  } catch {
    setBadge("offline");
    clearAssessment(
      navigator.onLine
        ? "Wechselrichter nicht erreichbar"
        : "Keine Netzwerkverbindung"
    );
  }
}

function setBadge(state) {
  const badge = document.getElementById("badge");
  if (state === "live")      badge.textContent = "🟢 Live from Fronius";
  else if (state === "demo") badge.textContent = "🟠 Demo Mode";
  else                       badge.textContent = "🔴 Offline";
}

// ---------- Start ----------

initTheme();
initChart();
restyleChart();
update();
setInterval(update, 5000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
