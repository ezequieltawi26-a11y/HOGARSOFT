const CACHE = "control-textil-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Deja pasar todo directo a internet; solo existe para que la app sea instalable.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
