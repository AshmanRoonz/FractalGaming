// Fractal Reality Labs: service worker (scope /labs/).
// Created 2026-09-29. Registered by labs/index.html, the start page of the Labs app (store/PLAN.md).
//
// WHY IT EXISTS. The store packages (Microsoft Store now, Google Play later) open these pages full
// screen. Without a worker, an offline launch lands on the browser's own "no internet" page; with it,
// a page navigation that cannot reach the network gets offline.html instead. That is all it does.
//
// WHAT IT DOES NOT DO: cache the labs. They load three.js and friends from public CDNs and are
// edited often; a worker copy would be a second cache that can go stale. Every subresource goes
// straight to the network and the browser's HTTP cache.
//
// COST. Static routing (Chrome 123+) sends every non-navigation request to the network without waking
// this worker. Older browsers reach the fetch handler, which returns at once for anything that is not
// a navigation. Navigation preload overlaps the page request with worker start-up.
//
// KILL SWITCH. To remove the worker from every installed copy, replace this file with:
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
// and deploy; browsers re-check the worker script on navigation, bypassing the HTTP cache.

const OFFLINE_URL = new URL('offline.html', self.location).href;
const CACHE = 'labs-offline-v1';   // bump the suffix when offline.html changes

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    try {
      if (typeof event.addRoutes === 'function') {
        await event.addRoutes([
          { condition: { requestMode: 'same-origin' }, source: 'network' },
          { condition: { requestMode: 'cors' }, source: 'network' },
          { condition: { requestMode: 'no-cors' }, source: 'network' },
        ]);
      }
    } catch (_) { /* routing unsupported: the fetch handler below covers it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    } catch (_) {}
    for (const key of await caches.keys()) {
      if (key.startsWith('labs-offline-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;   // subresources: never touched
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(event.request);
    } catch (_) {
      const cache = await caches.open(CACHE);
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }
  })());
});
