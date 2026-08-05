// Bump this on every deploy that changes any cached file — it forces the
// browser to treat this as a new worker, and the old cache gets dropped
// in 'activate' below. Also see the network-first fetch strategy: even
// without bumping this, a reload while online always prefers the network,
// so stale content should never really get "stuck" behind the cache.
const CACHE = 'orrery-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/orbitalData.js',
  './js/kepler.js',
  './js/physics.js',
  './js/render.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin app files: always try to fetch the latest
// version first (bypassing the HTTP cache too), only falling back to the
// cached copy when there's no network. This is what makes a fresh deploy
// show up on a normal reload instead of requiring a manual cache clear.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin requests pass through untouched

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
