/* Service worker v2 : application installable et consultable hors connexion,
   photos du glossaire (Wikimedia Commons) gardées en cache après le premier affichage. */
var CACHE = "carnet-affut-v2";
var PHOTOS = "carnet-affut-photos";
var SHELL = ["./", "index.html", "app.js", "glossaire.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== PHOTOS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.hostname === "upload.wikimedia.org") {            // photos du glossaire : cache d'abord
    e.respondWith(caches.open(PHOTOS).then(function (c) {
      return c.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(function (r) {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        });
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;               // cartes, polices et Firebase passent en direct
  e.respondWith(
    fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match("index.html"); }); })
  );
});
