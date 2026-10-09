const CACHE_PREFIX = "chintai-cost-calculator-";
const CACHE_NAME = `${CACHE_PREFIX}v21`;
const APP_FILES = [
  "./",
  "./index.html",
  "./chintai-cost-calculator.html",
  "./jds-device-auth.js",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (event.request.mode === "navigate" || url.pathname.endsWith("/jds-device-auth.js")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: "no-cache" });
        if (!response.ok) throw new Error("page_unavailable");
        await cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(event.request) || await cache.match(url.origin + url.pathname);
        return cached || Response.error();
      }
    })());
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
