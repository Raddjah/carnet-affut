/* Service worker v3 : application installable et utilisable hors connexion.
   - SHELL : fichiers de l'application, indispensables (l'installation échoue s'il en manque un).
   - LIBS : Leaflet, Firebase et polices, chargés depuis leurs CDN puis gardés en cache,
     pour que le carnet s'ouvre sur le terrain sans réseau. Un échec ici ne bloque pas l'installation.
   - PHOTOS : photos du glossaire (Wikimedia Commons), gardées après le premier affichage.
   Pensez à augmenter CACHE à chaque mise en ligne d'une nouvelle version. */
var CACHE = "carnet-affut-v10";
var LIBS = "carnet-affut-libs-v1";
var PHOTOS = "carnet-affut-photos";
var SHELL = ["./", "index.html", "app.js?v=5", "i18n.js?v=5", "glossaire.js?v=5", "config.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "images/bandeau-foret.jpg", "images/bandeau-foret-960.jpg"];
var FB = "https://www.gstatic.com/firebasejs/10.12.2/";
var LIB_URLS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  FB + "firebase-app-compat.js", FB + "firebase-auth-compat.js", FB + "firebase-firestore-compat.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () {
        return caches.open(LIBS).then(function (c) {
          // Requêtes « no-cors », comme celles des balises <script> et <link> de la page.
          return Promise.all(LIB_URLS.map(function (u) {
            var req = new Request(u, { mode: "no-cors" });
            return fetch(req).then(function (r) { return c.put(req, r); }).catch(function () {});
          }));
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== LIBS && k !== PHOTOS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Bibliothèques externes versionnées : le cache d'abord, le réseau sinon. */
function isLib(url) {
  return url.hostname === "unpkg.com" ||
    (url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0) ||
    url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}
function cacheFirst(name, req) {
  return caches.open(name).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        if (r.ok || r.type === "opaque") c.put(req, r.clone());
        return r;
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.hostname === "upload.wikimedia.org") { e.respondWith(cacheFirst(PHOTOS, e.request)); return; }
  if (isLib(url)) { e.respondWith(cacheFirst(LIBS, e.request)); return; }
  if (url.origin !== location.origin) return;               // fonds de carte et API Firebase passent en direct
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
      return r;
    }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match("index.html"); }); })
  );
});
