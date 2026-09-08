/* This file is completed by tools/build-site.mjs. */
const CACHE_NAME = "f3-vault-__BUILD_ID__";
const ASSETS = __ASSETS__;

async function cacheEverything() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(ASSETS);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheEverything().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("f3-vault-") && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_ALL") return;
  event.waitUntil(
    cacheEverything()
      .then(() => event.source?.postMessage({ type: "CACHE_COMPLETE" }))
      .catch(() => event.source?.postMessage({ type: "CACHE_FAILED" })),
  );
});
