// ---------- Living Sky v1 ----------
//
// Eine rein CSS-basierte Atmosphäre. JavaScript berechnet nur sehr langsam
// veränderliche Zustandswerte aus lokaler Tageszeit und aktueller PV-Leistung.
// Es gibt keine Render-Schleife, keine Wetterdaten und keine Bilddateien.

(function () {
  "use strict";

  const SKY_REFRESH_MS = 60 * 1000;
  const LOW_POWER = 500;
  const HIGH_POWER = 1500;
  const MAX_POWER = 4000;

  const sky = document.getElementById("living-sky");
  if (!sky) return;

  // Zeitanker in lokalen Minuten. Der doppelte Nachtanker schließt den Kreis
  // über Mitternacht ohne Sonderfall in der Farbmischung.
  const phases = [
    { at: 0,    name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],   horizon: [27, 45, 67],   glow: [90, 119, 160], stars: 0.28, glowX: 50, glowY: 100 },
    { at: 300,  name: "sunrise",   top: [25, 52, 88], mid: [78, 110, 142], horizon: [214, 154, 129], glow: [255, 177, 112], stars: 0.08, glowX: 18, glowY: 76 },
    { at: 480,  name: "morning",   top: [61, 122, 178], mid: [112, 160, 198], horizon: [201, 194, 174], glow: [255, 216, 154], stars: 0, glowX: 32, glowY: 48 },
    { at: 690,  name: "noon",      top: [69, 132, 188], mid: [124, 174, 208], horizon: [213, 202, 174], glow: [255, 222, 158], stars: 0, glowX: 50, glowY: 34 },
    { at: 870,  name: "afternoon", top: [66, 116, 169], mid: [128, 157, 186], horizon: [219, 183, 139], glow: [255, 190, 100], stars: 0, glowX: 68, glowY: 48 },
    { at: 1080, name: "sunset",    top: [49, 69, 118], mid: [162, 105, 132], horizon: [229, 139, 106], glow: [255, 141, 87], stars: 0.03, glowX: 82, glowY: 73 },
    { at: 1260, name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],   horizon: [27, 45, 67],   glow: [90, 119, 160], stars: 0.28, glowX: 50, glowY: 100 },
    { at: 1440, name: "night",     top: [5, 15, 38],  mid: [12, 30, 58],   horizon: [27, 45, 67],   glow: [90, 119, 160], stars: 0.28, glowX: 50, glowY: 100 },
  ];

  let latestEnergy = { power: 0, gridImport: false, disconnected: false };

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

  function timeState(date) {
    const minute = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
    let index = 0;
    while (index < phases.length - 2 && minute >= phases[index + 1].at) index += 1;

    const from = phases[index];
    const to = phases[index + 1];
    const progress = clamp((minute - from.at) / (to.at - from.at));

    return {
      phase: progress < 0.5 ? from.name : to.name,
      top: mixRgb(from.top, to.top, progress),
      mid: mixRgb(from.mid, to.mid, progress),
      horizon: mixRgb(from.horizon, to.horizon, progress),
      glow: mixRgb(from.glow, to.glow, progress),
      stars: mix(from.stars, to.stars, progress),
      glowX: mix(from.glowX, to.glowX, progress),
      glowY: mix(from.glowY, to.glowY, progress),
    };
  }

  function energyState({ power, gridImport, disconnected }) {
    const watts = Math.max(0, Number(power) || 0);
    let brightness = 1;
    let saturation = 1;
    let glow = 0.34;
    let level = "medium";

    if (watts < LOW_POWER) {
      const low = clamp(watts / LOW_POWER);
      brightness = mix(0.88, 1, low);
      saturation = mix(0.88, 1, low);
      glow = mix(0.18, 0.3, low);
      level = "low";
    } else if (watts > HIGH_POWER) {
      const high = clamp((watts - HIGH_POWER) / (MAX_POWER - HIGH_POWER));
      brightness = mix(1, 1.08, high);
      saturation = mix(1, 1.04, high);
      glow = mix(0.34, 0.48, high);
      level = "high";
    }

    // Netzbezug wird nur angewendet, wenn eine künftige Datenquelle ihn
    // ausdrücklich als Boolean liefert. Niedrige PV-Leistung ist kein Beweis.
    if (gridImport === true) {
      brightness *= 0.94;
      saturation *= 0.9;
      glow *= 0.72;
      level = "grid-import";
    }

    if (disconnected) {
      brightness *= 0.92;
      saturation *= 0.9;
      glow *= 0.8;
      level = "offline";
    }

    return { brightness, saturation, glow, level };
  }

  function render() {
    const time = timeState(new Date());
    const energy = energyState(latestEnergy);

    sky.dataset.phase = time.phase;
    sky.dataset.energy = energy.level;
    sky.style.setProperty("--sky-top", rgb(time.top));
    sky.style.setProperty("--sky-mid", rgb(time.mid));
    sky.style.setProperty("--sky-horizon", rgb(time.horizon));
    sky.style.setProperty("--sky-glow", rgb(time.glow));
    sky.style.setProperty("--sky-glow-x", `${time.glowX.toFixed(1)}%`);
    sky.style.setProperty("--sky-glow-y", `${time.glowY.toFixed(1)}%`);
    sky.style.setProperty("--sky-stars-opacity", time.stars.toFixed(3));
    // Hundertstel-Schritte verhindern, dass kleine 5-Sekunden-Schwankungen
    // dauerhaft neue Fullscreen-Composites auslösen.
    sky.style.setProperty("--sky-brightness", energy.brightness.toFixed(2));
    sky.style.setProperty("--sky-saturation", energy.saturation.toFixed(2));
    sky.style.setProperty("--sky-energy-glow", energy.glow.toFixed(2));
  }

  function update(next = {}) {
    latestEnergy = {
      power: Number.isFinite(Number(next.power)) ? Number(next.power) : latestEnergy.power,
      gridImport: next.gridImport === true,
      disconnected: next.disconnected === true,
    };
    render();
  }

  render();
  setInterval(render, SKY_REFRESH_MS);

  window.energyRadarSky = { update };
})();
