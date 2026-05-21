const CACHE_NAME = 'bedtime-stars-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Network-first strategy — always try to get fresh data from the server,
// since the app relies on real-time WebSocket updates
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
