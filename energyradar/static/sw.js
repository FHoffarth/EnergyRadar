// Version bei jeder Änderung an den Shell-Dateien erhöhen, sonst liefert der
// Service Worker (Cache-first) die alten Dateien weiter aus.
const CACHE = "energyradar-v16";

const SHELL = [
  "/",
  "/static/style.css?v=11",
  "/static/energy-state.js?v=3",
  "/static/app.js?v=10",
  "/static/background.js?v=4",
  "/static/vendor/chart.umd.js",
  "/static/offline.html",
  "/static/fonts/Inter-Regular.woff2",
  "/static/fonts/Inter-Medium.woff2",
  "/static/fonts/Inter-SemiBold.woff2",
  "/static/fonts/Inter-Bold.woff2",
  "/static/manifest.webmanifest",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/apple-touch-icon.png",
  "/static/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Live-Daten niemals cachen – die App zeigt bei Fehlern selbst den Offline-Status
  if (url.pathname.startsWith("/api/")) return;

  // Seitenaufrufe: Netz zuerst, sonst Cache, sonst Offline-Screen
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match("/"))
        .then((res) => res || caches.match("/static/offline.html"))
    );
    return;
  }

  // Statische Dateien: Cache zuerst, sonst Netz (und nachcachen)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
