const CACHE = "ornament-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./shared.js",
  "./controlsSketch.js",
  "./gridSketch.js",
  "./sphereSketch.js",
  "./mappingData.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
