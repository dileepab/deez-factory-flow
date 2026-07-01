// Legacy cleanup worker.
//
// Older builds registered next-pwa at /sw.js, which can keep serving stale
// development chunks on localhost. Production PWA builds now use /sw-prod.js,
// so this worker only retires the old registration and its Workbox caches.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();

      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
