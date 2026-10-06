/* Jason Shop service worker — caches the app shell for offline open.
   API calls to jason-shop-api (and any non-same-origin) always go to the network.
   Safe and small: no background sync, no push, no rewriting of responses. */
const CACHE = "jason-shop-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/app.css",
  "/js/calc.js",
  "/js/model.js",
  "/js/nlu.js",
  "/js/storage.js",
  "/js/features.js",
  "/js/features2.js",
  "/js/features3.js",
  "/js/pdf.js",
  "/js/features4.js",
  "/js/app.js",
  "/js/pwa.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept API / cross-origin (research, photos, summary, health…).
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network first, fall back to cached shell.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Same-origin static assets: cache first, then network.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      // Also try without the ?v= cache-buster so SHELL entries still match.
      const bare = url.pathname;
      return caches.match(bare).then((hit2) => {
        if (hit2) return hit2;
        return fetch(req).then((res) => {
          if (res && res.ok && (url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(bare, copy)).catch(() => {});
          }
          return res;
        });
      });
    })
  );
});
