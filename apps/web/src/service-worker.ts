/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";
import { mayCacheRequest } from "$lib/services/pwa-cache-policy";

declare const self: ServiceWorkerGlobalScope;

const CACHE = `edgewarden-shell-${version}`;
const ASSETS = [...build, ...files].filter(
  (path) => !path.endsWith("robots.txt"),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("edgewarden-shell-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!mayCacheRequest(request.method, request.url, self.location.origin))
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok)
            await (await caches.open(CACHE)).put(request, response.clone());
          return response;
        })
        .catch(
          async () =>
            (await caches.match(request)) ??
            (await caches.match("/")) ??
            Response.error(),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then(async (response) => {
          if (response.ok && response.type === "basic")
            await (await caches.open(CACHE)).put(request, response.clone());
          return response;
        }),
    ),
  );
});
