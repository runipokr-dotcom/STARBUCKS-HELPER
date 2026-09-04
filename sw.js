const VERSION = "starbucks-helper-pwa-v6";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // Assets are always network-fetched; the editor now includes its scripts directly.
  // Avoid HTML rewriting so an older service worker cannot change listener order.
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
