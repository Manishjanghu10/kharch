/* App-shell service worker: caches everything needed to run with no
   network at all after the first visit. Cache-first, with a background
   refresh from the network when available. */
const CACHE_NAME = 'kharch-v4';
const PRECACHE = [
  'index.html',
  'login.html',
  'signup.html',
  'reset.html',
  'style.css',
  'manifest.json',
  'js/app.js',
  'js/dataStore.js',
  'js/parser.js',
  'js/crypto.js',
  'js/pwToggle.js',
  'js/webauthn.js',
  'js/charts.js',
  'js/pinPad.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
