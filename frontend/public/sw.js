const CACHE_NAME = "finlog-v2";
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/offline.html",
];

// Install — cache offline page
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache, then app shell (/)
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Skip API requests and external/dev-server requests
  if (url.pathname.startsWith("/api/") || url.port === "8000" || url.hostname === "localhost") {
    return;
  }

  // Navigation requests — always serve app shell (/) to let React handle routing
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match("/"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful static assets
        if (response.status === 200 && (
          url.pathname.startsWith("/_next/") || 
          url.pathname.startsWith("/icons/") ||
          url.pathname === "/manifest.json"
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(async () => {
        // Try cache for assets
        const cached = await caches.match(event.request);
        if (cached) return cached;

        return new Response("Offline", { status: 503 });
      })
  );
});
