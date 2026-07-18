// ---------- Living Sky – BackgroundManager ----------
//
// Wählt anhand von Tageszeit und Wetterzustand ein lokales Himmelsbild und
// blendet es per CSS-Opacity weich ein (Crossfade, keine JS-Animation).
//
// Datenlage: EnergyRadar besitzt derzeit KEINE Wetterquelle. Die Tageszeit
// kommt aus der lokalen Uhr; der Wetterzustand ist der einzige Eingang, der
// später ergänzt wird. Sobald eine Wetterquelle existiert, genügt es,
//   window.energyRadarWeather = "rain" | "cloudy" | …
// zu setzen (siehe WEATHER-Tabelle) – der Rest funktioniert unverändert.

(function () {
  "use strict";

  const BASE = "/static/assets/backgrounds/";
  const FADE_REFRESH_MS = 5 * 60 * 1000; // Tageszeit periodisch nachführen
  const DEFAULT_WEATHER = "sunny";        // Fallback ohne Wetterdaten

  // Mapping-Tabelle: Wetterzustand -> Tagordner + Nacht-Zuordnung.
  const WEATHER = {
    sunny:         { day: "sunny",         night: "clear_night" },
    partly_cloudy: { day: "partly_cloudy", night: "clear_night" },
    cloudy:        { day: "cloudy",        night: "cloudy_night" },
    rain:          { day: "rain",          night: "cloudy_night" },
    thunderstorm:  { day: "thunderstorm",  night: "cloudy_night" },
    snow:          { day: "snow",          night: "cloudy_night" },
    fog:           { day: "fog",           night: "cloudy_night" },
  };

  // Tageszeit aus der lokalen Uhr (kein Sonnenauf-/-untergang vorhanden).
  function timeOfDay(date) {
    const h = date.getHours();
    if (h >= 5 && h < 10) return "morning";
    if (h >= 10 && h < 16) return "noon";
    if (h >= 16 && h < 20) return "evening";
    return "night";
  }

  function currentWeather() {
    const w = window.energyRadarWeather;
    return w && WEATHER[w] ? w : DEFAULT_WEATHER;
  }

  function resolveImage() {
    const tod = timeOfDay(new Date());
    const map = WEATHER[currentWeather()];
    return tod === "night"
      ? BASE + map.night + "/night.webp"
      : BASE + map.day + "/" + tod + ".webp";
  }

  // Zwei gestapelte Ebenen; die eingehende wird geladen und dann eingeblendet.
  const layers = [
    document.getElementById("sky-a"),
    document.getElementById("sky-b"),
  ];
  let active = 0;
  let currentSrc = "";

  function show(src) {
    if (!layers[0] || !layers[1] || src === currentSrc) return;
    currentSrc = src;

    const incoming = layers[active ^ 1];
    const outgoing = layers[active];

    const reveal = () => {
      incoming.classList.add("is-visible");
      outgoing.classList.remove("is-visible");
      active ^= 1;
    };

    if (incoming.getAttribute("src") === src && incoming.complete) {
      reveal();
    } else {
      incoming.onload = reveal;
      incoming.onerror = () => {
        // Fehlt ein Platzhalter, bleibt ruhig die Basisfarbe stehen.
        currentSrc = "";
      };
      incoming.src = src; // Lazy: nur das benötigte Bild wird geladen.
    }
  }

  function tick() {
    show(resolveImage());
  }

  tick();
  setInterval(tick, FADE_REFRESH_MS);

  // Erweiterungspunkt für eine spätere Wetterquelle.
  window.energyRadarSky = { tick, resolveImage };
})();
