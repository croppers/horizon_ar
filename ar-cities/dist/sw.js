const CACHE = 'arcities-v1';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './cities.json'
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then((res) => {
      if (res) return res;
      return fetch(req).then((net) => {
        // Cache same-origin assets
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin) {
            const copy = net.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
        } catch {}
        return net;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
