/* Carnet d'affût v2 — observations naturalistes partagées avec une liste d'abonnés.
   Nouveautés : photo par appareil photo ou galerie, choix du mode (local / en ligne) dans l'application,
   synchronisation totale ou observation par observation, photos libres dans le glossaire. */
(function () {
  "use strict";

  /* ---------- utilitaires ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowLocal() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) +
      " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? String(iso || "") : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = "none"; }, 3800);
  }
  var LS = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { toast("Stockage de l'appareil plein : exportez vos données puis supprimez des photos."); return false; }
    }
  };
  function plural(n, word) { return n + " " + word + (n > 1 ? "s" : ""); }

  /* ---------- configuration et mode ---------- */
  var CFG = window.CARNET_CONFIG || {};
  var ONLINE_OK = !!(CFG.firebase && CFG.firebase.apiKey);   // Firebase renseigné dans config.js
  var MODE = ONLINE_OK ? (LS.get("carnet.mode", null) || "online") : "local";
  var CLOUD = MODE === "online";
  var G = window.GLOSSAIRE || { oiseaux: [], mammiferes: [] };
  var CENTER = [49.6, 6.4]; // centre de la Grande Région

  var SPECIES = [];
  [["oiseaux", "Oiseau"], ["mammiferes", "Mammifère"]].forEach(function (g) {
    G[g[0]].forEach(function (s) {
      SPECIES.push({ name: s[0], sci: s[1], cat: s[2], statut: s[3], habitat: s[4], note: s[5], sensible: !!s[6], group: g[0], groupLabel: g[1] });
    });
  });
  var BY_NAME = {};
  SPECIES.forEach(function (s) { BY_NAME[s.name.toLowerCase()] = s; });

  var state = {
    mine: [],                         // mes observations, toujours enregistrées sur cet appareil
    feed: [],                         // fil reçu en tant qu'abonné (mode en ligne)
    subs: [],
    user: null, me: null,
    role: CLOUD ? "guest" : "owner",  // owner | subscriber | pending | guest
    loading: CLOUD,
    q: "", gq: "", ggroup: "tous",
    form: null,
    syncPolicy: LS.get("carnet.sync", "choose"),  // "all" = tout synchroniser, "choose" = au choix
    sel: {}                           // sélection en cours dans l'écran de synchronisation
  };
  var db = null, auth = null, unsub = [], pendingName = "";
  var maps = {};

  function isOwner() { return state.role === "owner"; }
  function canRead() { return state.role === "owner" || state.role === "subscriber"; }
  function obsList() { return isOwner() ? state.mine : state.feed; }
  function findObs(id) { return obsList().filter(function (x) { return x.id === id; })[0]; }
  function hasCoords(o) { return typeof o.lat === "number" && typeof o.lng === "number" && !isNaN(o.lat) && !isNaN(o.lng); }
  function osmLink(o) {
    return "https://www.openstreetmap.org/?mlat=" + o.lat.toFixed(5) + "&mlon=" + o.lng.toFixed(5) +
      "#map=15/" + o.lat.toFixed(5) + "/" + o.lng.toFixed(5);
  }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }

  /* ---------- stockage local (IndexedDB, repli sur localStorage) ---------- */
  var idb = null;
  function idbOpen() {
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      var r;
      try { r = indexedDB.open("carnet-affut", 1); } catch (e) { return res(null); }
      r.onupgradeneeded = function () { r.result.createObjectStore("obs", { keyPath: "id" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { res(null); };
    });
  }
  function idbTx(mode, fn) {
    return new Promise(function (res, rej) {
      var tx = idb.transaction("obs", mode), req = fn(tx.objectStore("obs"));
      tx.oncomplete = function () { res(req ? req.result : undefined); };
      tx.onerror = tx.onabort = function () { rej(tx.error); };
    });
  }
  function localLoad() {
    var old = LS.get("carnet.obs", []);   // données de la version 1
    return idbOpen().then(function (d) {
      idb = d;
      if (!idb) { state.mine = old; return; }
      return idbTx("readonly", function (s) { return s.getAll(); }).then(function (all) {
        state.mine = all || [];
        if (!old.length) return;
        var have = {}; state.mine.forEach(function (o) { have[o.id] = 1; });
        var add = old.filter(function (o) { return o && o.id && !have[o.id]; });
        return idbTx("readwrite", function (s) { add.forEach(function (o) { s.put(o); }); }).then(function () {
          state.mine = state.mine.concat(add);
          try { localStorage.removeItem("carnet.obs"); } catch (e) {}
        });
      });
    }).catch(function () { idb = null; state.mine = old; })
      .then(function () { state.mine.sort(byDateDesc); });
  }
  function localPut(o) {
    if (idb) return idbTx("readwrite", function (s) { s.put(o); });
    LS.set("carnet.obs", state.mine); return Promise.resolve();
  }
  function localDel(id) {
    if (idb) return idbTx("readwrite", function (s) { s.delete(id); });
    LS.set("carnet.obs", state.mine); return Promise.resolve();
  }
  function upsertMine(o) {
    var found = false;
    state.mine = state.mine.map(function (x) { if (x.id === o.id) { found = true; return o; } return x; });
    if (!found) state.mine.push(o);
    state.mine.sort(byDateDesc);
    return localPut(o);
  }

  /* ---------- synchronisation en ligne ---------- */
  function cloudOwner() { return CLOUD && isOwner() && !!db; }
  function cloudErr(e) { console.error(e); toast("Synchronisation impossible : vérifiez la connexion et vos droits."); }
  function cloudData(o) { var d = Object.assign({}, o); delete d.id; delete d.synced; return d; }
  function pushCloud(o) { db.collection("observations").doc(o.id).set(cloudData(o)).catch(cloudErr); }
  function publish(o) {
    o.synced = true;
    return upsertMine(o).then(function () { pushCloud(o); });
  }
  function unpublish(o) {
    o.synced = false;
    return upsertMine(o).then(function () { db.collection("observations").doc(o.id).delete().catch(cloudErr); });
  }
  function syncAll() {
    var todo = state.mine.filter(function (o) { return !o.synced; });
    return Promise.all(todo.map(publish)).then(function () { return todo.length; });
  }

  var store = {
    saveObs: function (o) {
      o.updatedAt = Date.now();
      if (!o.id) {
        o.id = uid(); o.createdAt = o.updatedAt;
        o.synced = cloudOwner() && state.syncPolicy === "all";
      }
      return upsertMine(o).then(function () { if (cloudOwner() && o.synced) pushCloud(o); });
    },
    deleteObs: function (id) {
      var o = findObs(id);
      state.mine = state.mine.filter(function (x) { return x.id !== id; });
      return localDel(id).then(function () {
        if (cloudOwner() && o && o.synced) db.collection("observations").doc(id).delete().catch(cloudErr);
      });
    },
    addSub: function (s) {
      if (CLOUD) return db.collection("subscribers").add(s);
      s.id = uid(); state.subs.push(s); LS.set("carnet.subs", state.subs); return Promise.resolve();
    },
    updateSub: function (id, patch) {
      if (CLOUD) return db.collection("subscribers").doc(id).update(patch);
      state.subs = state.subs.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; });
      LS.set("carnet.subs", state.subs); return Promise.resolve();
    },
    deleteSub: function (id) {
      if (CLOUD) return db.collection("subscribers").doc(id).delete();
      state.subs = state.subs.filter(function (x) { return x.id !== id; });
      LS.set("carnet.subs", state.subs); return Promise.resolve();
    }
  };

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error("Chargement impossible : " + src)); };
      document.head.appendChild(s);
    });
  }
  function initCloud() {
    var base = "https://www.gstatic.com/firebasejs/10.12.2/";
    return loadScript(base + "firebase-app-compat.js")
      .then(function () { return loadScript(base + "firebase-auth-compat.js"); })
      .then(function () { return loadScript(base + "firebase-firestore-compat.js"); })
      .then(function () {
        firebase.initializeApp(CFG.firebase);
        db = firebase.firestore(); auth = firebase.auth();
        db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
        auth.onAuthStateChanged(onAuth);
      })
      .catch(function (e) {
        state.loading = false; render();
        toast("Service en ligne injoignable. Vous pouvez repasser en mode local dans Réglages.");
        console.error(e);
      });
  }
  function stopListeners() { unsub.forEach(function (f) { try { f(); } catch (e) {} }); unsub = []; }

  /* Auteur : rapproche le fil en ligne et le carnet local. */
  function onOwnerSnapshot(snap) {
    var cloud = {}, fresh = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites, jobs = [];
    snap.docs.forEach(function (d) { cloud[d.id] = Object.assign({ id: d.id }, d.data()); });
    var have = {};
    state.mine = state.mine.map(function (o) {
      have[o.id] = 1;
      var c = cloud[o.id];
      if (c && (c.updatedAt || 0) > (o.updatedAt || 0)) { c.synced = true; jobs.push(c); return c; }  // modifiée sur un autre appareil
      if (fresh && !!c !== !!o.synced) { o.synced = !!c; jobs.push(o); }
      return o;
    });
    Object.keys(cloud).forEach(function (id) {       // présente en ligne, absente ici (nouvel appareil)
      if (!have[id]) { cloud[id].synced = true; state.mine.push(cloud[id]); jobs.push(cloud[id]); }
    });
    state.mine.sort(byDateDesc);
    Promise.all(jobs.map(localPut)).catch(function () {});
    if (state.syncPolicy === "all" && state.mine.some(function (o) { return !o.synced; })) syncAll();
    render();
  }
  function onAuth(user) {
    stopListeners();
    state.user = user; state.loading = false; state.feed = []; state.subs = []; state.me = null;
    if (!user) { state.role = "guest"; render(); return; }
    var owner = (CFG.ownerEmail || "").trim().toLowerCase();
    if (owner && (user.email || "").toLowerCase() === owner) {
      state.role = "owner";
      unsub.push(db.collection("observations").onSnapshot({ includeMetadataChanges: true }, onOwnerSnapshot,
        function (e) { console.error(e); toast("Lecture du fil en ligne refusée."); }));
      unsub.push(db.collection("subscribers").onSnapshot(function (snap) {
        state.subs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        render();
      }, function (e) { console.error(e); }));
    } else {
      state.role = "pending";
      var feedOn = false;
      unsub.push(db.collection("subscribers").doc(user.uid).onSnapshot(function (d) {
        var ok = d.exists && d.data().approved === true;
        state.me = d.exists ? d.data() : null;
        state.role = ok ? "subscriber" : "pending";
        if (ok && !feedOn) {
          feedOn = true;
          unsub.push(db.collection("observations").orderBy("date", "desc").onSnapshot(function (snap) {
            state.feed = snap.docs.map(function (x) { return Object.assign({ id: x.id }, x.data()); });
            render();
          }, function (e) { console.error(e); toast("Lecture des observations refusée."); }));
        }
        if (!ok) state.feed = [];
        render();
      }, function (e) { console.error(e); }));
    }
    render();
  }
  function requestSubscription(name) {
    var u = state.user; if (!u) return Promise.resolve();
    return db.collection("subscribers").doc(u.uid).set({
      name: name || (u.email || "").split("@")[0], email: u.email, approved: false, account: true, createdAt: Date.now()
    });
  }
  var AUTH_ERR = {
    "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
    "auth/wrong-password": "E-mail ou mot de passe incorrect.",
    "auth/user-not-found": "Aucun compte avec cet e-mail.",
    "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail : connectez-vous.",
    "auth/weak-password": "Mot de passe trop court (6 caractères minimum).",
    "auth/invalid-email": "Adresse e-mail invalide.",
    "auth/network-request-failed": "Pas de réseau."
  };

  /* ---------- photos du glossaire (Wikimedia Commons, licences libres) ---------- */
  var GP = LS.get("carnet.gphotos", null) || { at: 0, items: {} };
  var gpBusy = false;
  function wikiApi(host, params) {
    return fetch("https://" + host + "/w/api.php?action=query&format=json&formatversion=2&origin=*&" + params)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function chunks(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  function hopMap(q) {
    var hop = {};
    (q.normalized || []).concat(q.redirects || []).forEach(function (x) { hop[x.from] = x.to; });
    return function (t) { var k = t, n = 0; while (hop[k] && n++ < 6) k = hop[k]; return k; };
  }
  function plainText(html) {
    try { return (new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70); }
    catch (e) { return ""; }
  }
  /* titres d'articles -> { titre: { file, thumb } } : image principale libre de l'article Wikipédia */
  function wikiImages(titles) {
    return Promise.all(chunks(titles, 50).map(function (c) {
      return wikiApi("fr.wikipedia.org", "redirects=1&prop=pageimages&piprop=name%7Cthumbnail&pithumbsize=640&pilicense=free&titles=" +
        encodeURIComponent(c.join("|"))).then(function (j) {
        var q = j.query || {}, end = hopMap(q), pages = {}, out = {};
        (q.pages || []).forEach(function (p) { pages[p.title] = p; });
        c.forEach(function (t) {
          var p = pages[end(t)];
          if (p && p.pageimage && p.thumbnail && p.thumbnail.source) out[t] = { file: p.pageimage, thumb: p.thumbnail.source };
        });
        return out;
      });
    })).then(function (parts) { return Object.assign.apply(Object, [{}].concat(parts)); });
  }
  /* noms de fichiers -> { fichier: { a: auteur, l: licence, u: page Commons } } */
  function commonsCredits(files) {
    return Promise.all(chunks(files, 50).map(function (c) {
      var titles = c.map(function (f) { return "File:" + f; });
      return wikiApi("commons.wikimedia.org", "prop=imageinfo&iiprop=extmetadata%7Curl&iiextmetadatafilter=Artist%7CLicenseShortName&titles=" +
        encodeURIComponent(titles.join("|"))).then(function (j) {
        var q = j.query || {}, end = hopMap(q), pages = {}, out = {};
        (q.pages || []).forEach(function (p) { pages[p.title] = p; });
        c.forEach(function (f) {
          var p = pages[end("File:" + f)], ii = p && p.imageinfo && p.imageinfo[0], m = ii && ii.extmetadata;
          if (m && m.LicenseShortName && m.LicenseShortName.value) {
            out[f] = { a: plainText(m.Artist && m.Artist.value) || "auteur indiqué sur Commons", l: plainText(m.LicenseShortName.value), u: ii.descriptionurl || "" };
          }
        });
        return out;
      });
    })).then(function (parts) { return Object.assign.apply(Object, [{}].concat(parts)); });
  }
  function loadGlossPhotos() {
    if (gpBusy || !window.fetch || navigator.onLine === false) return;
    var stale = Date.now() - (GP.at || 0) > 30 * 864e5;
    var todo = SPECIES.filter(function (s) { return stale || !(s.sci in GP.items); });
    if (!todo.length) return;
    gpBusy = true;
    var found = {};
    wikiImages(todo.map(function (s) { return s.sci; })).then(function (bySci) {
      todo.forEach(function (s) { if (bySci[s.sci]) found[s.sci] = bySci[s.sci]; });
      var rest = todo.filter(function (s) { return !found[s.sci]; });   // repli : article au nom français
      if (!rest.length) return;
      return wikiImages(rest.map(function (s) { return s.name; })).then(function (byName) {
        rest.forEach(function (s) { if (byName[s.name]) found[s.sci] = byName[s.name]; });
      });
    }).then(function () {
      var files = Object.keys(found).map(function (k) { return found[k].file; });
      return files.length ? commonsCredits(files) : {};
    }).then(function (cred) {
      todo.forEach(function (s) {
        var f = found[s.sci], c = f && cred[f.file];
        // Une photo n'est affichée que si sa licence a pu être lue.
        GP.items[s.sci] = c ? { t: f.thumb, a: c.a, l: c.l, u: c.u } : 0;
      });
      GP.at = Date.now(); LS.set("carnet.gphotos", GP);
      if (route() === "glossaire" && $("gloss-list")) $("gloss-list").innerHTML = glossListHTML();
    }).catch(function (e) { console.warn("Photos du glossaire indisponibles", e); })
      .then(function () { gpBusy = false; });
  }
  function glossPhotoHTML(s) {
    var p = GP.items[s.sci];
    if (!p || !p.t) return "";
    return '<figure class="gph"><img class="gimg" loading="lazy" crossorigin="anonymous" alt="' + esc(s.name) + '" src="' + esc(p.t) + '">' +
      '<figcaption>Photo : ' + esc(p.a) + ' · ' + esc(p.l) +
      (p.u ? ' · <a href="' + esc(p.u) + '" target="_blank" rel="noopener">Wikimedia Commons</a>' : "") + '</figcaption></figure>';
  }
  document.addEventListener("error", function (e) {   // image refusée : second essai sans CORS, sinon on masque
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains("gimg")) return;
    if (img.hasAttribute("crossorigin")) { var src = img.src; img.removeAttribute("crossorigin"); img.src = ""; img.src = src; }
    else if (img.parentNode) img.parentNode.style.display = "none";
  }, true);

  /* ---------- texte de partage ---------- */
  function obsText(o) {
    var L = [o.species + (o.sci ? " (" + o.sci + ")" : "")];
    L.push(fmtDate(o.date) + (o.count > 1 ? " · " + o.count + " individus" : ""));
    if (o.place) L.push("Lieu : " + o.place);
    if (hasCoords(o)) { L.push("GPS : " + o.lat.toFixed(5) + ", " + o.lng.toFixed(5)); L.push("Carte : " + osmLink(o)); }
    if (o.notes) { L.push(""); L.push(o.notes); }
    if (CFG.auteur) { L.push(""); L.push("— " + CFG.auteur); }
    return L.join("\n");
  }
  function subscriberEmails() {
    return state.subs.filter(function (s) { return s.email && (!CLOUD || s.approved !== false); })
      .map(function (s) { return s.email; });
  }
  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || "Copié."); },
        function () { toast("Copie impossible sur cet appareil."); });
    } else { toast("Copie impossible sur cet appareil."); }
  }

  /* ---------- vues ---------- */
  var VIEWS = ["observations", "carte", "glossaire", "abonnes", "reglages"];
  function route() { var h = location.hash.slice(1); return VIEWS.indexOf(h) >= 0 ? h : "observations"; }

  function gateHTML() {
    if (state.loading) return '<p class="empty">Connexion…</p>';
    if (state.role === "guest") return authHTML();
    if (state.role === "pending") {
      return '<div class="card"><h2>Abonnement en attente</h2>' +
        (state.me
          ? '<p>Votre demande est enregistrée. Les observations s\'afficheront dès que ' + esc(CFG.auteur || "l'auteur") + ' l\'aura validée.</p>'
          : '<p>Ce compte n\'est pas encore abonné.</p><div><button class="btn primary" data-act="ask-sub">Demander l\'abonnement</button></div>') +
        '<p class="meta">Connecté : ' + esc(state.user.email) + '</p>' +
        '<div><button class="btn small" data-act="signout">Se déconnecter</button></div></div>' +
        '<p class="meta">Le glossaire reste consultable sans abonnement.</p>';
    }
    return "";
  }
  function authHTML() {
    return '<div class="card"><h2>' + esc(CFG.auteur ? "Les observations de " + CFG.auteur : "Observations réservées aux abonnés") + '</h2>' +
      '<p class="meta">Connectez-vous, ou créez un compte pour demander l\'abonnement.</p>' +
      '<form id="auth-form">' +
      '<label for="au-email">E-mail<input id="au-email" type="email" autocomplete="email" required></label>' +
      '<label for="au-pass">Mot de passe<input id="au-pass" type="password" autocomplete="current-password" minlength="6" required></label>' +
      '<label for="au-name">Votre nom (pour une première inscription)<input id="au-name" type="text" autocomplete="name"></label>' +
      '<div class="row"><button class="btn primary" type="submit" data-mode="in">Se connecter</button>' +
      '<button class="btn" type="submit" data-mode="up">Créer un compte</button></div>' +
      '<div><button class="btn small" type="button" data-act="reset-pass">Mot de passe oublié</button></div>' +
      '</form></div>';
  }
  function syncPill(o) {
    if (!(CLOUD && isOwner())) return "";
    return o.synced ? ' <span class="pill ok">En ligne</span>' : ' <span class="pill">Local</span>';
  }

  function filteredObs() {
    var q = norm(state.q), all = obsList();
    if (!q) return all;
    return all.filter(function (o) { return norm([o.species, o.sci, o.place, o.notes].join(" ")).indexOf(q) >= 0; });
  }
  function obsListHTML() {
    var list = filteredObs();
    if (!obsList().length) {
      return '<p class="empty">' + (isOwner()
        ? "Aucune observation pour l'instant. Notez la première avec le bouton ci-dessous."
        : "Aucune observation publiée pour l'instant.") + '</p>';
    }
    if (!list.length) return '<p class="empty">Aucune observation ne correspond à cette recherche.</p>';
    return list.map(function (o) {
      var sp = BY_NAME[(o.species || "").toLowerCase()];
      return '<button class="card" data-act="open" data-id="' + esc(o.id) + '"><span class="row">' +
        (o.photo ? '<img class="thumb" alt="" src="' + esc(o.photo) + '">' : "") +
        '<span class="grow"><h3>' + esc(o.species) + (o.count > 1 ? " × " + esc(o.count) : "") + '</h3>' +
        (o.sci ? '<em class="sci">' + esc(o.sci) + '</em><br>' : "") +
        '<span class="meta">' + esc(fmtDate(o.date)) + '</span><br>' +
        '<span class="meta">' + esc(o.place || (hasCoords(o) ? o.lat.toFixed(4) + ", " + o.lng.toFixed(4) : "Lieu non précisé")) + '</span>' +
        (sp && sp.sensible ? ' <span class="pill warn">Espèce sensible</span>' : "") + syncPill(o) +
        '</span></span></button>';
    }).join("");
  }
  function viewObservations() {
    var g = gateHTML(); if (g) return g;
    var all = obsList(), nSp = {}; all.forEach(function (o) { nSp[norm(o.species)] = 1; });
    return '<div class="row between"><h2>' + plural(all.length, "observation") + " · " + plural(Object.keys(nSp).length, "espèce") + '</h2></div>' +
      '<input id="q" type="search" placeholder="Chercher une espèce, un lieu…" aria-label="Chercher dans les observations" value="' + esc(state.q) + '">' +
      '<div id="obs-list" class="stack">' + obsListHTML() + '</div>' +
      (isOwner() ? '<button class="btn primary fab" data-act="new">+ Observation</button>' : "");
  }

  function viewCarte() {
    var g = gateHTML(); if (g) return g;
    var n = obsList().filter(hasCoords).length;
    return '<p class="meta">' + plural(n, "observation") + ' sur la carte. Touchez une icône, puis « Voir le détail ».</p>' +
      '<div class="row legend">' + pinHTML("oiseaux", false) + '<span>Oiseau</span>' + pinHTML("mammiferes", false) + '<span>Mammifère</span>' +
      pinHTML("autre", false) + '<span>Autre</span>' + pinHTML("oiseaux", true) + '<span>Espèce sensible</span></div>' +
      '<div id="map-all" class="map big"></div>';
  }

  function glossListHTML() {
    var q = norm(state.gq), counts = {};
    obsList().forEach(function (o) { var k = (o.species || "").toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    var list = SPECIES.filter(function (s) {
      if (state.ggroup !== "tous" && s.group !== state.ggroup) return false;
      return !q || norm(s.name + " " + s.sci + " " + s.cat + " " + s.habitat).indexOf(q) >= 0;
    });
    if (!list.length) return '<p class="empty">Aucune espèce ne correspond. L\'observation d\'une espèce absente du glossaire reste possible en saisie libre.</p>';
    var out = "", cat = "";
    list.forEach(function (s) {
      if (s.cat !== cat) { cat = s.cat; out += '<p class="cat">' + esc(cat) + '</p>'; }
      var c = counts[s.name.toLowerCase()] || 0;
      out += '<article class="card">' + glossPhotoHTML(s) +
        '<div class="row between"><h3>' + esc(s.name) + '</h3>' +
        (c && canRead() ? '<span class="pill ok">' + c + " obs.</span>" : "") + '</div>' +
        '<em class="sci">' + esc(s.sci) + '</em>' +
        '<div class="row"><span class="pill">' + esc(s.statut) + '</span>' +
        (s.sensible ? '<span class="pill warn">Sensible au dérangement</span>' : "") + '</div>' +
        '<p><strong>Où :</strong> ' + esc(s.habitat) + '</p><p class="meta">' + esc(s.note) + '</p>' +
        (isOwner() ? '<div><button class="btn small" data-act="new" data-species="' + esc(s.name) + '">Noter une observation</button></div>' : "") +
        '</article>';
    });
    return out;
  }
  function viewGlossaire() {
    function chip(v, label) {
      return '<button class="chip" data-act="ggroup" data-v="' + v + '" aria-pressed="' + (state.ggroup === v) + '">' + label + '</button>';
    }
    return '<h2>Oiseaux et mammifères de la Grande Région</h2>' +
      '<p class="meta">' + G.oiseaux.length + " oiseaux et " + G.mammiferes.length +
      ' mammifères parmi les plus observables au Luxembourg, en Lorraine, Wallonie, Sarre et Rhénanie-Palatinat. ' +
      'Photos sous licence libre issues de Wikimedia Commons, auteur et licence indiqués sous chacune.</p>' +
      '<input id="gq" type="search" placeholder="Chercher un nom, un milieu…" aria-label="Chercher dans le glossaire" value="' + esc(state.gq) + '">' +
      '<div class="chips">' + chip("tous", "Tous") + chip("oiseaux", "Oiseaux") + chip("mammiferes", "Mammifères") + '</div>' +
      '<div id="gloss-list" class="stack">' + glossListHTML() + '</div>';
  }

  function viewAbonnes() {
    if (!isOwner()) {
      var g = gateHTML(); if (g) return g;
      return '<div class="card"><h2>Mon compte</h2><p>Abonné : ' + esc(state.user.email) + '</p>' +
        '<div class="row"><button class="btn small" data-act="signout">Se déconnecter</button>' +
        '<button class="btn small danger" data-act="unsubscribe">Me désabonner</button></div></div>';
    }
    var pending = state.subs.filter(function (s) { return CLOUD && s.approved === false; });
    var active = state.subs.filter(function (s) { return !CLOUD || s.approved !== false; });
    var h = "";
    if (!CLOUD) {
      h += '<p class="notice">Mode local : le partage passe par e-mail ou messagerie. ' +
        'Pour que vos abonnés suivent votre fil dans l\'application, passez en mode en ligne dans Réglages.</p>';
    } else {
      h += '<div class="card"><h2>Inviter</h2><p class="meta">Envoyez ce lien : chaque personne crée son compte, puis vous validez sa demande ici.</p>' +
        '<p style="word-break:break-all">' + esc(location.origin + location.pathname) + '</p>' +
        '<div><button class="btn small" data-act="copy-link">Copier le lien</button></div></div>';
    }
    if (pending.length) {
      h += '<h2>Demandes en attente</h2>' + pending.map(function (s) {
        return '<div class="card"><h3>' + esc(s.name || s.email) + '</h3><p class="meta">' + esc(s.email) + '</p>' +
          '<div class="row"><button class="btn small primary" data-act="approve" data-id="' + esc(s.id) + '">Accepter</button>' +
          '<button class="btn small danger" data-act="del-sub" data-id="' + esc(s.id) + '">Refuser</button></div></div>';
      }).join("");
    }
    h += '<div class="row between"><h2>' + plural(active.length, "abonné") + '</h2>' +
      (active.length ? '<button class="btn small" data-act="copy-emails">Copier les e-mails</button>' : "") + '</div>';
    h += active.length ? active.map(function (s) {
      return '<div class="card"><div class="row between"><div class="grow"><h3>' + esc(s.name || s.email) + '</h3>' +
        '<p class="meta">' + esc(s.email) + '</p></div>' +
        (CLOUD ? '<span class="pill">' + (s.account ? "Compte" : "Contact e-mail") + '</span>' : "") +
        '<button class="btn small danger" data-act="del-sub" data-id="' + esc(s.id) + '">Retirer</button></div></div>';
    }).join("") : '<p class="empty">Aucun abonné. Ajoutez un premier contact ci-dessous.</p>';
    h += '<div class="card"><h2>Ajouter un contact</h2><form id="sub-form">' +
      '<label for="sb-name">Nom<input id="sb-name" type="text" required></label>' +
      '<label for="sb-email">E-mail<input id="sb-email" type="email" required></label>' +
      '<div><button class="btn primary" type="submit">Ajouter</button></div></form></div>';
    return h;
  }

  function optHTML(name, value, checked, title, desc, disabled) {
    return '<label class="opt" for="' + name + '-' + value + '"><input type="radio" id="' + name + '-' + value + '" name="' + name + '" value="' + value + '"' +
      (checked ? " checked" : "") + (disabled ? " disabled" : "") + '><span><strong>' + title + '</strong><br><span class="meta">' + desc + '</span></span></label>';
  }
  function wantOnline(o) { return state.sel[o.id] === undefined ? !!o.synced : state.sel[o.id]; }
  function syncCardHTML() {
    var total = state.mine.length, on = state.mine.filter(function (o) { return o.synced; }).length;
    var h = '<div class="card"><h2>Synchronisation</h2>' +
      '<p>' + on + " sur " + plural(total, "observation") + ' visible' + (on > 1 ? "s" : "") + ' par vos abonnés.</p>' +
      optHTML("policy", "all", state.syncPolicy === "all", "Tout synchroniser", "Chaque observation, existante ou nouvelle, est publiée automatiquement.") +
      optHTML("policy", "choose", state.syncPolicy !== "all", "Choisir observation par observation", "Rien n'est publié sans votre accord. Cochez ci-dessous ce que vos abonnés peuvent voir.");
    if (state.syncPolicy !== "all") {
      if (!total) h += '<p class="meta">Aucune observation à synchroniser pour l\'instant.</p>';
      else {
        var changes = state.mine.filter(function (o) { return wantOnline(o) !== !!o.synced; }).length;
        h += '<div class="row"><button class="btn small" data-act="sel-all">Tout cocher</button>' +
          '<button class="btn small" data-act="sel-none">Tout décocher</button></div><div class="stack tight">' +
          state.mine.map(function (o) {
            return '<label class="chk" for="sel-' + esc(o.id) + '"><input type="checkbox" id="sel-' + esc(o.id) + '" data-sel="' + esc(o.id) + '"' +
              (wantOnline(o) ? " checked" : "") + '><span class="grow">' + esc(o.species) + ' <span class="meta">· ' + esc(shortDate(o.date)) +
              (o.place ? " · " + esc(o.place) : "") + '</span></span>' + syncPill(o) + '</label>';
          }).join("") + '</div>' +
          '<div class="row"><button class="btn primary" data-act="sel-apply"' + (changes ? "" : " disabled") + '>Appliquer' +
          (changes ? " (" + plural(changes, "changement") + ")" : "") + '</button>' +
          '<button class="btn" data-act="sync-all">Tout synchroniser maintenant</button></div>';
      }
    }
    return h + '</div>';
  }
  function viewReglages() {
    var h = '<div class="card"><h2>Mode de fonctionnement</h2>' +
      optHTML("mode", "local", !CLOUD, "Mode local", "Tout reste sur cet appareil. Partage par e-mail ou messagerie.") +
      optHTML("mode", "online", CLOUD, "Mode en ligne", "Vos abonnés suivent votre fil dans l'application. Vous choisissez ce qui est publié.", !ONLINE_OK) +
      (ONLINE_OK ? '<p class="meta">Changer de mode recharge l\'application. Vos observations restent sur cet appareil dans les deux modes.</p>'
        : '<p class="notice">Le mode en ligne demande un projet Firebase renseigné dans config.js (voir LISEZMOI).</p>') + '</div>';
    if (CLOUD) {
      if (isOwner()) h += syncCardHTML();
      else if (state.role === "guest" && !state.loading) h += '<p class="notice">Connectez-vous dans l\'onglet Observations pour gérer la synchronisation ou suivre le fil.</p>';
    }
    if (isOwner()) {
      h += '<div class="card"><h2>Sauvegarde</h2><p class="meta">Exportez vos observations et abonnés dans un fichier, ou restaurez une sauvegarde.</p>' +
        '<div class="row"><button class="btn small" data-act="export">Exporter (.json)</button>' +
        '<label class="btn small" for="import-file">Importer<input id="import-file" type="file" accept="application/json,.json" hidden></label></div></div>';
    }
    if (CLOUD && state.user) h += '<div class="card"><p class="meta">Connecté : ' + esc(state.user.email) + '</p><div><button class="btn small" data-act="signout">Se déconnecter</button></div></div>';
    return h;
  }

  function render() {
    var v = route();
    document.querySelectorAll("nav.tabs a").forEach(function (a) {
      if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("tab-abonnes").textContent = isOwner() ? "Abonnés" : "Compte";
    $("app-title").textContent = CFG.titre || "Carnet d'affût";
    $("app-status").textContent = !CLOUD ? "Mode local" : "En ligne" + (isOwner() ? " · Auteur" : state.role === "subscriber" ? " · Abonné" : "");
    killMap("all");
    $("main").innerHTML = { observations: viewObservations, carte: viewCarte, glossaire: viewGlossaire, abonnes: viewAbonnes, reglages: viewReglages }[v]();
    if (v === "carte" && $("map-all")) drawAllMap();
    if (v === "glossaire") loadGlossPhotos();
  }

  /* ---------- cartes ---------- */
  function killMap(k) { if (maps[k]) { try { maps[k].remove(); } catch (e) {} maps[k] = null; } }
  function makeMap(k, el, center, zoom) {
    killMap(k);
    if (!window.L) { el.innerHTML = '<p class="empty">Carte indisponible hors connexion.</p>'; return null; }
    var m = L.map(el).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
    maps[k] = m;
    setTimeout(function () { m.invalidateSize(); }, 60);
    return m;
  }
  function dot(latlng, sensible) {
    return L.circleMarker(latlng, { radius: 9, weight: 2, color: "#ffffff", fillColor: sensible ? "#c4621b" : "#0c6b7f", fillOpacity: 1 });
  }
  /* Icônes de carte : silhouette d'oiseau, silhouette de renard pour les mammifères, ou point neutre pour une espèce hors glossaire. */
  var GLYPH = {
    oiseaux: '<path d="M23.2 9.6 L20.2 8.6 C19.8 6.2 16.2 5.4 14.4 7.8 C11 9.4 7.2 12 4.6 15 L0.8 19.4 L3.2 20.2 L6.8 17.6 C10.4 19.2 16.2 18.6 18.6 13.6 C19.2 12.4 19.8 11.4 20.4 10.6 Z"/><rect x="10.4" y="18" width="1" height="3.6"/><rect x="13" y="17.8" width="1" height="3.6"/>',
    mammiferes: '<path d="M23 11.6 L19.6 8.6 L19.7 4.2 L17.9 7 L16.5 4.6 L15.9 8.6 C14.5 9.6 12 10 8.2 10.4 C5.6 10.2 2.8 7.6 0.8 3.4 C0.2 8.6 2.2 13.2 6.3 14.2 L6.6 20.2 L8.2 20.2 L8.7 15.6 L13.1 15.6 L13.3 20.2 L14.9 20.2 L15.3 15 C16.4 14.6 17.2 13.9 17.6 13.2 L20.2 12.7 Z"/>',
    autre: '<circle cx="12" cy="12" r="4.5"/>'
  };
  function obsGroup(o) { var sp = BY_NAME[(o.species || "").toLowerCase()]; return sp ? sp.group : "autre"; }
  function pinHTML(group, sensible) {
    return '<span class="pin pin-' + group + (sensible ? " pin-sensible" : "") + '"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">' + GLYPH[group] + '</svg></span>';
  }
  function obsMarker(o) {
    var sp = BY_NAME[(o.species || "").toLowerCase()], group = obsGroup(o);
    return L.marker([o.lat, o.lng], {
      title: o.species, alt: (group === "oiseaux" ? "Oiseau : " : group === "mammiferes" ? "Mammifère : " : "") + o.species,
      icon: L.divIcon({ className: "pin-wrap", html: pinHTML(group, sp && sp.sensible), iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] })
    });
  }
  function popupNode(o) {
    var box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = '<strong>' + esc(o.species) + (o.count > 1 ? " × " + esc(o.count) : "") + '</strong>' +
      '<span>' + esc(fmtDate(o.date)) + '</span>' + (o.place ? '<span>' + esc(o.place) + '</span>' : "") +
      '<a href="#carte" class="pop-link">Voir le détail de l\'observation</a>';
    // Leaflet bloque la propagation des clics dans une bulle : le lien porte son propre écouteur.
    box.querySelector(".pop-link").addEventListener("click", function (e) { e.preventDefault(); openDetail(o.id); });
    return box;
  }
  function drawAllMap() {
    var m = makeMap("all", $("map-all"), CENTER, 8); if (!m) return;
    var pts = [];
    obsList().filter(hasCoords).forEach(function (o) {
      obsMarker(o).addTo(m).bindPopup(popupNode(o));
      pts.push([o.lat, o.lng]);
    });
    if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  }

  /* ---------- détail ---------- */
  function openDetail(id) {
    var o = findObs(id); if (!o) return;
    var sp = BY_NAME[(o.species || "").toLowerCase()];
    var d = $("dlg-detail"), cloudMine = CLOUD && isOwner();
    d.innerHTML = '<div class="dlg">' +
      '<div><h2>' + esc(o.species) + (o.count > 1 ? " × " + esc(o.count) : "") + '</h2>' + (o.sci ? '<em class="sci">' + esc(o.sci) + '</em>' : "") + '</div>' +
      '<p>' + esc(fmtDate(o.date)) + syncPill(o) + '</p>' +
      (o.place ? '<p><strong>Lieu :</strong> ' + esc(o.place) + '</p>' : "") +
      (hasCoords(o) ? '<p class="meta">GPS ' + o.lat.toFixed(5) + ", " + o.lng.toFixed(5) +
        ' · <a href="' + osmLink(o) + '" target="_blank" rel="noopener">Ouvrir dans OpenStreetMap</a></p><div id="map-detail" class="map"></div>' : "") +
      (sp && sp.sensible ? '<p class="notice warn">Espèce sensible au dérangement : merci de ne pas rediffuser cette position.</p>' : "") +
      (o.photo ? '<img class="photo" alt="Photo de l\'observation" src="' + esc(o.photo) + '">' : "") +
      (o.notes ? '<p style="white-space:pre-wrap">' + esc(o.notes) + '</p>' : "") +
      '<div class="row">' +
      '<button class="btn primary" data-act="share" data-id="' + esc(o.id) + '">Partager</button>' +
      (isOwner() ? '<a class="btn" data-act="mail" data-id="' + esc(o.id) + '" href="#">E-mail aux abonnés</a>' : "") +
      '<button class="btn" data-act="copy-obs" data-id="' + esc(o.id) + '">Copier</button></div>' +
      (cloudMine ? '<div><button class="btn" data-act="toggle-sync" data-id="' + esc(o.id) + '">' +
        (o.synced ? "Retirer du fil des abonnés" : "Publier pour les abonnés") + '</button></div>' : "") +
      '<div class="row">' +
      (isOwner() ? '<button class="btn small" data-act="edit" data-id="' + esc(o.id) + '">Modifier</button>' +
        '<button class="btn small danger" data-act="del" data-id="' + esc(o.id) + '">Supprimer</button>' : "") +
      '<button class="btn small" data-act="close-detail">Fermer</button></div></div>';
    if (!d.open) d.showModal();
    if (hasCoords(o) && $("map-detail")) {
      var m = makeMap("detail", $("map-detail"), [o.lat, o.lng], 14);
      if (m) obsMarker(o).addTo(m);
    }
  }

  /* ---------- formulaire ---------- */
  function coordsLabel(f) { return hasCoords(f) ? f.lat.toFixed(5) + ", " + f.lng.toFixed(5) : "Position non définie"; }
  function photoPreviewHTML(src) {
    return src ? '<img class="photo" alt="Aperçu de la photo" src="' + esc(src) + '">' +
      '<div><button class="btn small danger" type="button" data-act="rm-photo">Retirer la photo</button></div>' : "";
  }
  function openForm(o, species) {
    var f = state.form = o ? Object.assign({}, o) : {
      species: species || "", date: nowLocal(), count: 1, place: "", lat: null, lng: null, notes: "", photo: ""
    };
    var d = $("dlg-form");
    d.innerHTML = '<div class="dlg"><h2>' + (o ? "Modifier l'observation" : "Nouvelle observation") + '</h2>' +
      '<form id="obs-form">' +
      '<label for="f-species">Espèce<input id="f-species" list="species-list" required autocomplete="off" value="' + esc(f.species) + '" placeholder="Nom du glossaire ou saisie libre"></label>' +
      '<datalist id="species-list">' + SPECIES.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.sci) + '</option>'; }).join("") + '</datalist>' +
      '<div class="two"><label for="f-date">Date et heure<input id="f-date" type="datetime-local" required value="' + esc(f.date) + '"></label>' +
      '<label for="f-count">Nombre d\'individus<input id="f-count" type="number" min="1" inputmode="numeric" value="' + esc(f.count || 1) + '"></label></div>' +
      '<label for="f-place">Lieu (nom)<input id="f-place" value="' + esc(f.place) + '" placeholder="ex. Haff Réimech, étang nord"></label>' +
      '<div class="row"><button class="btn" type="button" data-act="gps">Ma position GPS</button>' +
      '<span class="meta" id="f-coords">' + coordsLabel(f) + '</span></div>' +
      '<div id="map-form" class="map"></div><p class="meta">Touchez la carte pour placer ou corriger le point.</p>' +
      '<div class="field"><span class="flabel">Photo (facultative, réduite automatiquement)</span><div class="row">' +
      '<label class="btn" for="f-cam">Prendre une photo<input id="f-cam" type="file" accept="image/*" capture="environment" hidden></label>' +
      '<label class="btn" for="f-photo">Choisir un fichier ou dans la galerie<input id="f-photo" type="file" accept="image/*" hidden></label></div></div>' +
      '<div id="f-preview" class="stack tight">' + photoPreviewHTML(f.photo) + '</div>' +
      '<label for="f-notes">Notes<textarea id="f-notes" rows="3" placeholder="Comportement, lumière, matériel…">' + esc(f.notes) + '</textarea></label>' +
      '<div class="row"><button class="btn primary" type="submit">Enregistrer</button>' +
      '<button class="btn" type="button" data-act="close-form">Annuler</button></div></form></div>';
    if ($("dlg-detail").open) $("dlg-detail").close();
    d.showModal();
    var last = state.mine.filter(hasCoords)[0];
    var start = hasCoords(f) ? [f.lat, f.lng] : last ? [last.lat, last.lng] : CENTER;
    var m = makeMap("form", $("map-form"), start, hasCoords(f) ? 14 : last ? 11 : 8);
    if (m) {
      if (hasCoords(f)) setFormPoint(f.lat, f.lng, false);
      m.on("click", function (e) { setFormPoint(e.latlng.lat, e.latlng.lng, false); });
    }
  }
  var formMarker = null;
  function setFormPoint(lat, lng, recenter) {
    state.form.lat = lat; state.form.lng = lng;
    $("f-coords").textContent = coordsLabel(state.form);
    var m = maps.form; if (!m) return;
    if (formMarker) { try { formMarker.remove(); } catch (e) {} }
    formMarker = dot([lat, lng], false).addTo(m);
    if (recenter) m.setView([lat, lng], 15);
  }
  function resizePhoto(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1280, r = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("image")); };
      img.src = url;
    });
  }

  /* ---------- actions ---------- */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var act = el.dataset.act, id = el.dataset.id, o;
    if (act === "new") { openForm(null, el.dataset.species || ""); }
    else if (act === "open") { openDetail(id); }
    else if (act === "close-detail") { $("dlg-detail").close(); }
    else if (act === "close-form") { $("dlg-form").close(); }
    else if (act === "edit") { openForm(findObs(id)); }
    else if (act === "rm-photo") { state.form.photo = ""; $("f-preview").innerHTML = ""; }
    else if (act === "del") {
      if (confirm("Supprimer définitivement cette observation" + (CLOUD ? ", ici et dans le fil des abonnés" : "") + " ?")) {
        store.deleteObs(id).then(function () { $("dlg-detail").close(); toast("Observation supprimée."); render(); })
          .catch(function () { toast("Suppression impossible."); });
      }
    }
    else if (act === "toggle-sync") {
      o = findObs(id); if (!o) return;
      var was = o.synced;
      (was ? unpublish(o) : publish(o)).then(function () {
        toast(was ? "Retirée du fil des abonnés." : "Publiée pour les abonnés."); openDetail(id); render();
      });
    }
    else if (act === "sel-all" || act === "sel-none") {
      state.mine.forEach(function (x) { state.sel[x.id] = act === "sel-all"; }); render();
    }
    else if (act === "sel-apply") {
      var jobs = [], pub = 0, unp = 0;
      state.mine.forEach(function (x) {
        var want = wantOnline(x);
        if (want && !x.synced) { pub++; jobs.push(publish(x)); }
        else if (!want && x.synced) { unp++; jobs.push(unpublish(x)); }
      });
      state.sel = {};
      Promise.all(jobs).then(function () { toast(pub + " publiée(s), " + unp + " retirée(s)."); render(); });
    }
    else if (act === "sync-all") {
      state.sel = {};
      syncAll().then(function (n) { toast(n ? plural(n, "observation") + " publiée" + (n > 1 ? "s." : ".") : "Tout est déjà en ligne."); render(); });
    }
    else if (act === "share") {
      o = findObs(id); if (!o) return;
      var text = obsText(o);
      if (navigator.share) { navigator.share({ title: o.species, text: text }).catch(function () {}); }
      else { copy(text, "Texte copié : collez-le dans votre messagerie."); }
    }
    else if (act === "copy-obs") { o = findObs(id); if (o) copy(obsText(o), "Observation copiée."); }
    else if (act === "mail") {
      e.preventDefault();
      o = findObs(id); if (!o) return;
      var emails = subscriberEmails();
      if (!emails.length) { toast("Aucun abonné avec e-mail. Ajoutez-en dans l'onglet Abonnés."); return; }
      location.href = "mailto:?bcc=" + encodeURIComponent(emails.join(",")) +
        "&subject=" + encodeURIComponent("Observation : " + o.species + " — " + (o.place || fmtDate(o.date))) +
        "&body=" + encodeURIComponent(obsText(o));
    }
    else if (act === "gps") {
      if (!navigator.geolocation) { toast("Localisation indisponible sur cet appareil."); return; }
      toast("Recherche de la position…");
      navigator.geolocation.getCurrentPosition(function (p) {
        setFormPoint(p.coords.latitude, p.coords.longitude, true);
        toast("Position relevée (± " + Math.round(p.coords.accuracy) + " m).");
      }, function () { toast("Position refusée ou introuvable. Placez le point sur la carte."); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }
    else if (act === "ggroup") { state.ggroup = el.dataset.v; render(); }
    else if (act === "approve") { store.updateSub(id, { approved: true }).then(function () { toast("Abonné accepté."); render(); }); }
    else if (act === "del-sub") {
      if (confirm("Retirer cette personne de la liste ?")) store.deleteSub(id).then(function () { render(); });
    }
    else if (act === "copy-emails") { copy(subscriberEmails().join(", "), "Adresses copiées."); }
    else if (act === "copy-link") { copy(location.origin + location.pathname, "Lien copié."); }
    else if (act === "signout") { auth.signOut(); }
    else if (act === "ask-sub") { requestSubscription("").then(function () { toast("Demande envoyée."); }); }
    else if (act === "unsubscribe") {
      if (confirm("Vous désabonner ? Vous ne verrez plus les observations.")) {
        db.collection("subscribers").doc(state.user.uid).delete().then(function () { toast("Désabonné."); });
      }
    }
    else if (act === "reset-pass") {
      var em = ($("au-email").value || "").trim();
      if (!em) { toast("Saisissez d'abord votre e-mail."); return; }
      auth.sendPasswordResetEmail(em).then(function () { toast("E-mail de réinitialisation envoyé."); },
        function (err) { toast(AUTH_ERR[err.code] || "Envoi impossible."); });
    }
    else if (act === "export") { exportData(); }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id === "q") { state.q = e.target.value; $("obs-list").innerHTML = obsListHTML(); }
    else if (e.target.id === "gq") { state.gq = e.target.value; $("gloss-list").innerHTML = glossListHTML(); }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if ((t.id === "f-photo" || t.id === "f-cam") && t.files[0]) {
      resizePhoto(t.files[0]).then(function (data) {
        state.form.photo = data; $("f-preview").innerHTML = photoPreviewHTML(data);
      }, function () { toast("Image illisible. Essayez un fichier JPEG ou PNG."); });
      t.value = "";
    } else if (t.id === "import-file" && t.files[0]) {
      importData(t.files[0]);
    } else if (t.name === "mode") {
      LS.set("carnet.mode", t.value); location.reload();
    } else if (t.name === "policy") {
      state.syncPolicy = t.value; LS.set("carnet.sync", t.value); state.sel = {};
      if (t.value === "all" && cloudOwner()) syncAll().then(function (n) { if (n) toast(plural(n, "observation") + " publiée" + (n > 1 ? "s." : ".")); render(); });
      render();
    } else if (t.dataset && t.dataset.sel) {
      state.sel[t.dataset.sel] = t.checked; render();
    }
  });

  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.id === "obs-form") {
      var name = $("f-species").value.trim(), sp = BY_NAME[name.toLowerCase()];
      var o = Object.assign({}, state.form, {
        species: sp ? sp.name : name, sci: sp ? sp.sci : (state.form.sci && state.form.species === name ? state.form.sci : ""),
        date: $("f-date").value, count: Math.max(1, parseInt($("f-count").value, 10) || 1),
        place: $("f-place").value.trim(), notes: $("f-notes").value.trim()
      });
      if (!hasCoords(o) && !o.place) { toast("Indiquez un lieu : position GPS, point sur la carte ou nom."); return; }
      store.saveObs(o).then(function () {
        $("dlg-form").close();
        toast(CLOUD && !o.synced ? "Enregistrée sur cet appareil (non publiée)." : "Observation enregistrée.");
        render();
      }).catch(function (err) { console.error(err); toast("Enregistrement impossible : stockage de l'appareil plein ?"); });
    } else if (f.id === "sub-form") {
      var em = $("sb-email").value.trim().toLowerCase();
      if (state.subs.some(function (s) { return (s.email || "").toLowerCase() === em; })) { toast("Cette adresse est déjà dans la liste."); return; }
      store.addSub({ name: $("sb-name").value.trim(), email: em, approved: true, account: false, createdAt: Date.now() })
        .then(function () { toast("Contact ajouté."); render(); });
    } else if (f.id === "auth-form") {
      var mode = (e.submitter && e.submitter.dataset.mode) || "in";
      var email = $("au-email").value.trim(), pass = $("au-pass").value;
      pendingName = $("au-name").value.trim();
      var p = mode === "up"
        ? auth.createUserWithEmailAndPassword(email, pass).then(function (c) {
            var owner = (CFG.ownerEmail || "").trim().toLowerCase();
            if ((c.user.email || "").toLowerCase() !== owner) return requestSubscription(pendingName);
          })
        : auth.signInWithEmailAndPassword(email, pass);
      p.catch(function (err) { toast(AUTH_ERR[err.code] || "Connexion impossible."); });
    }
  });

  ["dlg-form", "dlg-detail"].forEach(function (id) {
    $(id).addEventListener("close", function () { killMap(id === "dlg-form" ? "form" : "detail"); });
  });

  /* ---------- sauvegarde ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify({ app: "carnet-affut", version: 2, exportedAt: new Date().toISOString(), observations: state.mine, abonnes: state.subs }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "carnet-affut-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importData(file) {
    file.text().then(function (t) {
      var data = JSON.parse(t), obs = data.observations || [], subs = data.abonnes || [];
      var haveO = {}, haveS = {};
      state.mine.forEach(function (o) { haveO[o.id] = 1; });
      state.subs.forEach(function (s) { haveS[(s.email || "").toLowerCase()] = 1; });
      var jobs = [];
      obs.forEach(function (o) {
        if (!o || !o.species) return;
        if (!o.id) o.id = uid();
        if (haveO[o.id]) return;
        haveO[o.id] = 1; o.synced = false;       // une observation importée n'est jamais publiée d'office
        jobs.push(upsertMine(o));
      });
      subs.forEach(function (s) {
        if (s && s.email && !haveS[s.email.toLowerCase()] && !s.account)
          jobs.push(store.addSub({ name: s.name || "", email: s.email, approved: true, account: false, createdAt: s.createdAt || Date.now() }));
      });
      return Promise.all(jobs).then(function () {
        toast(jobs.length + " élément(s) importé(s).");
        if (cloudOwner() && state.syncPolicy === "all") syncAll();
        render();
      });
    }).catch(function () { toast("Fichier de sauvegarde illisible."); });
  }

  /* ---------- démarrage ---------- */
  window.addEventListener("hashchange", render);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  if (!CLOUD) state.subs = LS.get("carnet.subs", []);
  render();
  localLoad().then(function () {
    render();
    if (CLOUD) initCloud();
  });
})();
