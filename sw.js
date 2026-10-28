// Offline for the live site only. On a dev server (localhost) this worker
// removes itself and every cache it made, so stale files are never served
// while the code is changing.
// The cache name is one per build: the build writes its id here (scripts/prerender.tsx), and on
// activate every cache with another name is deleted, so old built files do not pile up.
var CACHE = "morrow-8c07ff2f37edeead";
var DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", function (e) {
  if (DEV) { self.skipWaiting(); return; }
  // the pages, and every built file they name, so the first visit is enough for the tool to work offline
  // the Sealed File opener too, so a holder can open a file offline after one visit (Aarthi, 2026-10-27: S1)
  var pages = ["./", "./plan/", "./received-a-plan/", "./help/", "./open/"];
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(pages.map(function (u) {
      return fetch(u).then(function (res) {
        if (!res.ok) return [];
        // on open.dearmorrow.co "./" is a redirect to the opener; a redirected answer cannot serve a page offline, so its page is
        // kept as a plain answer (Aarthi, 2026-10-27: the opener on its own address)
        var keep = res.redirected ? new Response(res.clone().body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res.clone();
        return c.put(u, keep).then(function () { return res.text(); }).then(function (html) {
          var found = html.match(/(?:\.\.\/|\.\/|\/)assets\/[A-Za-z0-9._-]+/g) || [];
          return found.map(function (f) { return new URL(f, new URL(u, self.location.href)).toString(); });
        });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var assets = Array.from(new Set([].concat.apply(["./manifest.webmanifest"], lists)));
      return Promise.all(assets.map(function (a) { return c.add(a).catch(function () {}); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return DEV || k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () {
    if (DEV) return self.registration.unregister().then(function () { return self.clients.matchAll({ type: "window" }); }).then(function (cs) { cs.forEach(function (c) { c.navigate(c.url); }); });
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (e) {
  if (DEV) return;
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // the payment functions are never cached and never answered from the cache
  if (url.pathname.indexOf("/api/") === 0) return;
  var hashed = url.pathname.indexOf("/assets/") >= 0;
  if (hashed) {
    // built files carry a hash in the name, so a cached copy is always right
    e.respondWith(caches.match(e.request, { ignoreVary: true }).then(function (hit) {
      return hit || fetch(e.request).then(function (res) { if (res.ok) { var copy = res.clone(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(e.request, copy); })); } return res; });
    }));
    return;
  }
  // pages and everything else: the network first, the cache when offline
  e.respondWith(fetch(e.request).then(function (res) {
    // the write is awaited through waitUntil, so the worker is not killed before the copy is in the cache
    if (res.ok) { var copy = res.clone(); e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(e.request, copy); })); }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreVary: true }).then(function (hit) {
      if (hit) return hit;
      // offline with no copy: the tool's own page stands in for the tool only; anything else fails as the browser would show it
      if (e.request.mode === "navigate" && url.pathname.indexOf("/plan") === 0) return caches.match("./plan/", { ignoreVary: true }).then(function (p) { return p || Response.error(); });
      return Response.error();
    });
  }));
});
