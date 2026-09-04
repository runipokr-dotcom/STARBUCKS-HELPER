const VERSION = "starbucks-helper-pwa-v4";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isCatalogEditor =
    url.origin === self.location.origin &&
    /\/catalog-editor\.html$/.test(url.pathname);

  if (!isCatalogEditor) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith((async () => {
    const response = await fetch(event.request, { cache: "no-store" });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) return response;

    let html = await response.text();
    if (!html.includes("catalog-online-import.js")) {
      html = html.replace(
        /<\/body>/i,
        '<script src="catalog-online-import.js?v=20260904-2"></script>\n<script src="catalog-sync.js?v=20260904-2"></script>\n</body>'
      );
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })());
});