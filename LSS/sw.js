// Last Ship Sailing: service worker.
// Created 2026-09-29 (v49.88). Registered by index-working.html (Jump: SERVICE WORKER REGISTRATION).
//
// WHY IT EXISTS. The store packages (Google Play as a Trusted Web Activity, the Microsoft Store as
// an installed PWA) are this same site opened full screen. Neither store strictly requires a worker,
// but without one an offline launch lands on the browser's own "no internet" page instead of ours,
// and PWABuilder's report card counts it against the listing. This worker gives the app ONE thing:
// a branded offline screen when a page navigation cannot reach the network.
//
// WHAT IT DELIBERATELY DOES NOT DO: cache the game. _headers already runs the cache policy (index.html
// no-cache so a build bump reaches players at once; lss.js?v=<build>, ships/, frames/ immutable for a
// year; media a week). A worker cache layered on top would be a second copy of that policy that can
// go stale, which is exactly the "players stuck on an old build" failure the v38.64 split was built to
// end. So every subresource goes straight to the network and the browser's HTTP cache, untouched.
//
// COST. Static routing (Chrome 123+) sends every non-navigation request to the network WITHOUT waking
// this worker, so a match's hundreds of GLB/texture/audio fetches pay no service-worker hop at all.
// Browsers without static routing still reach the fetch handler, which returns immediately for
// anything that is not a navigation (no respondWith = the browser fetches it normally). Navigation
// preload overlaps the page request with worker start-up, so the page itself pays none either.
//
// KILL SWITCH. If this worker ever misbehaves in the field, replace this whole file with:
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));
// and deploy. Browsers re-check the worker script on navigation (bypassing the HTTP cache), so every
// installed copy removes itself on its next launch.

const OFFLINE_URL = '/offline.html';
const CACHE = 'lss-offline-v1';   // bump the suffix when offline.html changes

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
    // Every request mode except 'navigate' skips the worker. (No URLPattern catch-all: cross-origin
    // CDN requests are covered by the same mode rules, and mode is the one condition every static
    // routing implementation has supported since it shipped.)
    try {
      if (typeof event.addRoutes === 'function') {
        await event.addRoutes([
          { condition: { requestMode: 'same-origin' }, source: 'network' },
          { condition: { requestMode: 'cors' }, source: 'network' },
          { condition: { requestMode: 'no-cors' }, source: 'network' },
        ]);
      }
    } catch (_) { /* routing unsupported or rejected: the fetch handler below covers it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    } catch (_) {}
    for (const key of await caches.keys()) {
      if (key.startsWith('lss-offline-') && key !== CACHE) await caches.delete(key);
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
