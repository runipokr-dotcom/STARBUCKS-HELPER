const VERSION = "starbucks-helper-pwa-v7";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  // Always use the network for HELPER pages/assets so versioned tool links
  // and current HTML are not replaced by stale PWA cache entries.
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
