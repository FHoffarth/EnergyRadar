// ---------- Living Sky consumer ----------
//
// Keine Rohdaten und keine Schwellenwerte: Diese Komponente wendet nur die
// fertigen Präsentationstokens des zentralen Energy State an.

(function () {
  "use strict";

  const sky = document.getElementById("living-sky");
  if (!sky || !window.energyState) return;

  function render(state) {
    const visual = state.appearance.sky;

    sky.dataset.phase = state.phase;
    sky.dataset.production = state.production;
    sky.dataset.connection = state.connection;
    sky.dataset.motion = state.motion.mode;
    sky.style.setProperty("--sky-top", visual.top);
    sky.style.setProperty("--sky-mid", visual.mid);
    sky.style.setProperty("--sky-horizon", visual.horizon);
    sky.style.setProperty("--sky-glow", visual.glow);
    sky.style.setProperty("--sky-glow-x", visual.glowX);
    sky.style.setProperty("--sky-glow-y", visual.glowY);
    sky.style.setProperty("--sky-stars-opacity", visual.starsOpacity);
    sky.style.setProperty("--sky-brightness", visual.brightness);
    sky.style.setProperty("--sky-saturation", visual.saturation);
    sky.style.setProperty("--sky-energy-glow", visual.glowStrength);
    sky.style.setProperty("--sky-atmosphere-duration", state.motion.atmosphereDuration);
    sky.style.setProperty("--sky-glow-duration", state.motion.glowDuration);
  }

  window.energyState.subscribe(render);
})();
