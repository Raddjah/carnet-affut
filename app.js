/* Carnet d'affût v3 — observations naturalistes partagées avec une liste d'abonnés.
   Trois langues : français, allemand, anglais (textes dans i18n.js, espèces dans glossaire.js).
   Photo par appareil photo ou galerie · mode local ou en ligne · synchronisation au choix
   · position des espèces sensibles jamais publiée · j'aime · caméras autonomes. */
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
  var LS = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { toast(t("t_storage_full")); return false; }
    }
  };

  /* ---------- langue ---------- */
  var I18N = window.I18N || {};
  function pickLang() {
    var saved = LS.get("carnet.lang", null);
    if (saved && I18N[saved]) return saved;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "fr";
    var code = String(nav).slice(0, 2).toLowerCase();
    return I18N[code] ? code : "fr";
  }
  var LANG = pickLang();
  var L10N = I18N[LANG] || I18N.fr;
  var DICT = Object.assign({}, (I18N.fr || {}).s, L10N.s);
  function t(k, a, b) {
    var v = DICT[k];
    if (v == null) return k;
    return typeof v === "function" ? v(a, b) : v;
  }
  function tcat(k) { return L10N.cats[k] || I18N.fr.cats[k] || k; }
  function tst(k) { return L10N.st[k] || I18N.fr.st[k] || k; }
  function monthsLabel(m) { return m ? " (" + L10N.months[m[0] - 1] + "–" + L10N.months[m[1] - 1] + ")" : ""; }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString(L10N.locale, { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? String(iso || "") : d.toLocaleDateString(L10N.locale, { day: "numeric", month: "short", year: "numeric" });
  }
  function nowLocal() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  var toastTimer;
  function toast(msg) {
    var el = $("toast"); el.textContent = msg; el.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.style.display = "none"; }, 3800);
  }

  /* ---------- configuration et mode ---------- */
  var VERSION = 5;   // doit correspondre au ?v=5 des balises script d'index.html
  var CFG = window.CARNET_CONFIG || {};
  var ONLINE_OK = !!(CFG.firebase && CFG.firebase.apiKey);
  var MODE = ONLINE_OK ? (LS.get("carnet.mode", null) || "online") : "local";
  var CLOUD = MODE === "online";
  var G = window.GLOSSAIRE || { oiseaux: [], mammiferes: [] };
  var CENTER = [49.6, 6.4];  // centre de la Grande Région

  /* Espèces dans la langue choisie ; les trois langues restent reconnues à la lecture. */
  var LI = { fr: 5, de: 6, en: 7 }[LANG] || 5;
  var SPECIES = [], BY_NAME = {};
  ["oiseaux", "mammiferes"].forEach(function (g) {
    G[g].forEach(function (r) {
      var loc = r[LI] || r[5];
      SPECIES.push({
        sci: r[0], group: g, cat: r[1], catLabel: tcat(r[1]), sensible: !!r[4],
        name: loc[0], habitat: loc[1], note: loc[2], statut: tst(r[2]) + monthsLabel(r[3])
      });
    });
  });
  SPECIES.forEach(function (s) { BY_NAME[norm(s.sci)] = s; BY_NAME[norm(s.name)] = s; });
  ["oiseaux", "mammiferes"].forEach(function (g) {          // noms des autres langues
    G[g].forEach(function (r) {
      var sp = BY_NAME[norm(r[0])];
      if (sp) [5, 6, 7].forEach(function (i) { if (r[i] && !BY_NAME[norm(r[i][0])]) BY_NAME[norm(r[i][0])] = sp; });
    });
  });
  function findSpecies(o) { return BY_NAME[norm(o.sci || "")] || BY_NAME[norm(o.species || "")]; }
  function obsSpecies(o) { var sp = findSpecies(o); return sp ? sp.name : (o.species || ""); }

  var state = {
    mine: [], others: [], subs: [], likes: {},
    user: null, me: null,
    role: CLOUD ? "guest" : "owner",
    loading: CLOUD,
    q: "", gq: "", ggroup: "tous",
    form: null,
    syncPolicy: LS.get("carnet.sync", "choose"),
    sel: {}, who: "all", kind: "all"
  };
  var db = null, auth = null, unsub = [], pendingName = "";
  /* Dernier compte connu : permet d'ouvrir son carnet sur le terrain, sans réseau,
     même quand Firebase ne peut pas se charger. Effacé à la déconnexion. */
  var SESSION = CLOUD ? LS.get("carnet.session", null) : null;
  if (SESSION && SESSION.uid && (SESSION.role === "owner" || SESSION.role === "subscriber")) {
    state.user = { uid: SESSION.uid, email: SESSION.email || "" };
    state.role = SESSION.role; state.me = SESSION.me || null; state.loading = false;
  } else SESSION = null;
  function saveSession(role) {
    var u = state.user; if (!u || !u.uid) return;
    SESSION = { uid: u.uid, email: u.email || "", role: role, me: state.me || null };
    LS.set("carnet.session", SESSION);
  }
  function clearSession() { SESSION = null; try { localStorage.removeItem("carnet.session"); } catch (e) {} }
  function offline() { return CLOUD && !db; }
  /* Actions qui exigent le service en ligne : refusées proprement hors connexion. */
  function needDb() { if (CLOUD && (!db || !auth)) { toast(t("t_need_network")); return true; } return false; }
  var maps = {};

  function isOwner() { return state.role === "owner"; }
  function canRead() { return state.role === "owner" || state.role === "subscriber"; }
  function isCam(o) { return o.kind === "camera"; }
  function camName(o) { return o.species || t("pill_camera"); }
  function title(o) { return isCam(o) ? camName(o) : obsSpecies(o); }
  function myUid() { return state.user ? state.user.uid : null; }
  function myList() {
    if (!CLOUD) return state.mine;
    var u = myUid();
    return state.mine.filter(function (o) { return !o.authorUid || o.authorUid === u; });
  }
  function syncables() { return myList().filter(function (o) { return !isCam(o); }); }
  function obsList() {
    if (!canRead()) return [];
    return CLOUD ? myList().concat(state.others).sort(byDateDesc) : state.mine;
  }
  function findObs(id) { return obsList().filter(function (x) { return x.id === id; })[0]; }
  function isSensitive(o) {
    if (isCam(o)) return false;
    var sp = findSpecies(o);
    return !!(o.hideLoc || o.locHidden || (sp && sp.sensible));
  }
  function authorName() {
    var mail = ((state.user && state.user.email) || "").split("@")[0];
    if (isOwner()) return CFG.auteur || mail;
    return (state.me && state.me.name) || mail;
  }
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
    var old = LS.get("carnet.obs", []);
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
  function cloudOwner() { return CLOUD && canRead() && !!db; }
  function cloudErr(e) { console.error(e); toast(t("t_cloud_fail")); }
  /* Ce qui part en ligne. La position GPS d'une espèce sensible ne quitte jamais l'appareil. */
  function cloudData(o) {
    var d = Object.assign({}, o); delete d.id; delete d.synced; delete d.other;
    d.authorUid = myUid(); d.authorName = authorName();
    d.locHidden = isSensitive(o);
    if (d.locHidden) { delete d.lat; delete d.lng; }
    return d;
  }
  function pushCloud(o) { db.collection("observations").doc(o.id).set(cloudData(o)).catch(cloudErr); }
  function publish(o) {
    if (isCam(o)) return Promise.resolve();   // une caméra ne quitte jamais l'appareil
    o.synced = true; o.authorUid = myUid();
    return upsertMine(o).then(function () { pushCloud(o); });
  }
  function unpublish(o) {
    o.synced = false;
    return upsertMine(o).then(function () { db.collection("observations").doc(o.id).delete().catch(cloudErr); });
  }
  function syncAll() {
    var todo = syncables().filter(function (o) { return !o.synced; });
    return Promise.all(todo.map(publish)).then(function () { return todo.length; });
  }

  var store = {
    saveObs: function (o) {
      o.updatedAt = Date.now();
      if (!o.id) {
        o.id = uid(); o.createdAt = o.updatedAt;
        if (CLOUD) o.authorUid = myUid();
        o.synced = !isCam(o) && cloudOwner() && state.syncPolicy === "all";
      }
      return upsertMine(o).then(function () { if (cloudOwner() && o.synced) pushCloud(o); });
    },
    deleteObs: function (id) {
      var o = findObs(id);
      if (!o || o.other) return Promise.resolve();
      state.mine = state.mine.filter(function (x) { return x.id !== id; });
      return localDel(id).then(function () {
        if (cloudOwner() && o.synced) db.collection("observations").doc(id).delete().catch(cloudErr);
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

  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src;
      s.onload = function () { loaded[src] = true; res(); };
      s.onerror = function () { rej(new Error("Chargement impossible : " + src)); };
      document.head.appendChild(s);
    });
  }
  var cloudBusy = false;
  function initCloud() {
    if (cloudBusy || db) return;
    cloudBusy = true;
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
        toast(SESSION || navigator.onLine === false ? t("t_offline") : t("t_cloud_unreachable"));
        console.error(e);
      })
      .then(function () { cloudBusy = false; });
  }
  window.addEventListener("online", function () { if (CLOUD && !db) initCloud(); });
  function stopListeners() { unsub.forEach(function (f) { try { f(); } catch (e) {} }); unsub = []; }

  /* Rapproche le fil en ligne et mon carnet local ; range à part les observations des autres membres. */
  function onFeedSnapshot(snap) {
    var u = myUid(), cloud = {}, others = [], jobs = [], have = {};
    var fresh = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    snap.docs.forEach(function (d) {
      var x = Object.assign({ id: d.id }, d.data());
      if (x.authorUid === u || (isOwner() && !x.authorUid)) cloud[d.id] = x;
      else { x.other = true; others.push(x); }
    });
    state.others = others.sort(byDateDesc);
    state.mine = state.mine.map(function (o) {
      if (o.authorUid && o.authorUid !== u) return o;
      have[o.id] = 1;
      var c = cloud[o.id];
      if (c && (c.updatedAt || 0) > (o.updatedAt || 0)) {
        if (c.locHidden) { c.lat = o.lat; c.lng = o.lng; }   // la position masquée n'existe qu'en local
        c.synced = true; c.authorUid = u; jobs.push(c); return c;
      }
      if (fresh && !!c !== !!o.synced) { o.synced = !!c; jobs.push(o); }
      // Remise en conformité du document en ligne, dans les deux sens : une espèce sensible ne doit pas
      // y garder sa position, et une espèce qui ne l'est pas doit la retrouver si elle a été masquée à tort.
      if (c && fresh) {
        var masquer = isSensitive(o);
        var conforme = masquer ? (c.locHidden === true && c.lat == null)
                               : (!c.locHidden && (!hasCoords(o) || c.lat != null));
        if (!conforme || (o.place && !c.place) || !c.authorUid) pushCloud(o);
      }
      return o;
    });
    Object.keys(cloud).forEach(function (id) {
      if (!have[id]) { cloud[id].synced = true; cloud[id].authorUid = u; state.mine.push(cloud[id]); jobs.push(cloud[id]); }
    });
    state.mine.sort(byDateDesc);
    Promise.all(jobs.map(localPut)).catch(function () {});
    if (state.syncPolicy === "all" && syncables().some(function (o) { return !o.synced; })) syncAll();
    render();
  }
  function startFeed() {
    startLikes();
    unsub.push(db.collection("observations").onSnapshot({ includeMetadataChanges: true }, onFeedSnapshot,
      function (e) { console.error(e); toast(t("t_read_denied")); }));
  }
  function onAuth(user) {
    stopListeners();
    state.user = user; state.loading = false; state.others = []; state.subs = []; state.me = null; state.likes = {};
    if (!user) { state.role = "guest"; clearSession(); render(); return; }
    var owner = (CFG.ownerEmail || "").trim().toLowerCase();
    if (owner && (user.email || "").toLowerCase() === owner) {
      state.role = "owner"; saveSession("owner");
      startFeed();
      unsub.push(db.collection("subscribers").onSnapshot(function (snap) {
        state.subs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        render();
      }, function (e) { console.error(e); }));
    } else {
      // Abonné déjà accepté sur cet appareil : pas de passage par l'écran d'attente pendant le chargement.
      state.role = SESSION && SESSION.uid === user.uid && SESSION.role === "subscriber" ? "subscriber" : "pending";
      if (state.role === "subscriber") state.me = SESSION.me;
      var feedOn = false;
      unsub.push(db.collection("subscribers").doc(user.uid).onSnapshot(function (d) {
        var ok = d.exists && d.data().approved === true;
        state.me = d.exists ? d.data() : null;
        state.role = ok ? "subscriber" : "pending";
        if (ok) saveSession("subscriber"); else clearSession();
        if (ok && !feedOn) { feedOn = true; startFeed(); }
        if (!ok) state.others = [];
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
    "auth/invalid-credential": "err_credential", "auth/wrong-password": "err_credential",
    "auth/user-not-found": "err_nouser", "auth/email-already-in-use": "err_inuse",
    "auth/weak-password": "err_weak", "auth/invalid-email": "err_email", "auth/network-request-failed": "err_network"
  };
  function authErr(e) { return t(AUTH_ERR[e && e.code] || "err_signin"); }

  /* ---------- j'aime (mode en ligne) ----------
     Un document par personne et par observation, nommé <idObservation>__<uid>. */
  function likesOf(id) { return state.likes[id] || []; }
  function iLike(id) {
    var u = myUid();
    return likesOf(id).some(function (l) { return l.uid === u; });
  }
  function canLike(o) { return CLOUD && canRead() && !isCam(o) && (o.other || o.synced); }
  function startLikes() {
    unsub.push(db.collection("likes").onSnapshot(function (snap) {
      var m = {};
      snap.docs.forEach(function (d) {
        var l = d.data();
        if (l && l.obsId) (m[l.obsId] = m[l.obsId] || []).push(l);
      });
      state.likes = m; paintLikes();
    }, function (e) { console.error(e); }));
  }
  function toggleLike(id) {
    if (!cloudOwner()) return;
    var ref = db.collection("likes").doc(id + "__" + myUid());
    if (iLike(id)) ref.delete().catch(function () { toast(t("t_unlike_fail")); });
    else ref.set({ obsId: id, uid: myUid(), name: authorName(), createdAt: Date.now() })
      .catch(function () { toast(t("t_like_fail")); });
  }
  var HEART = '<path d="M12 20.4C12 20.4 3.8 14.9 3.8 9.2 3.8 6.4 6 4.4 8.4 4.4 10 4.4 11.4 5.3 12 6.5 12.6 5.3 14 4.4 15.6 4.4 18 4.4 20.2 6.4 20.2 9.2 20.2 14.9 12 20.4 12 20.4Z"/>';
  function likeInnerHTML(o) {
    var n = likesOf(o.id).length, on = iLike(o.id);
    var icon = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="' + (on ? "currentColor" : "none") +
      '" stroke="currentColor" stroke-width="2">' + HEART + '</svg><span class="n">' + n + '</span>';
    if (!o.other) return '<span class="like static">' + icon + '</span>';
    return '<button class="like' + (on ? " on" : "") + '" data-act="like" data-id="' + esc(o.id) + '" aria-pressed="' + on +
      '" aria-label="' + esc(on ? t("like_on") : t("like_off")) + '">' + icon + '</button>';
  }
  function likeBarHTML(o) {
    return canLike(o) ? '<span class="likebar" data-like-for="' + esc(o.id) + '">' + likeInnerHTML(o) + '</span>' : "";
  }
  function likersHTML(id) {
    var u = myUid(), names = likesOf(id).map(function (l) { return l.uid === u ? t("you") : (l.name || t("a_member")); });
    if (!names.length) return "";
    var head = names.slice(0, 3), rest = names.length - head.length;
    if (rest > 0) return t("likers", head.join(", ") + " + " + t("n_others", rest));
    return t("likers", head.join(", "));
  }
  /* Mise à jour ciblée : un j'aime ne doit pas redessiner la carte ni refermer la fiche ouverte. */
  function paintLikes() {
    document.querySelectorAll("[data-like-for]").forEach(function (el) {
      var o = findObs(el.getAttribute("data-like-for"));
      if (o) el.innerHTML = likeInnerHTML(o);
    });
    document.querySelectorAll("[data-likers-for]").forEach(function (el) {
      el.innerHTML = esc(likersHTML(el.getAttribute("data-likers-for")));
    });
  }

  /* ---------- photos du glossaire (Wikimedia Commons, licences libres) ---------- */
  var GPKEY = "carnet.gphotos." + LANG;
  var GP = LS.get(GPKEY, null) || { at: 0, items: {} };
  var gpBusy = false;
  function wikiApi(host, params) {
    return fetch("https://" + host + "/w/api.php?action=query&format=json&formatversion=2&origin=*&" + params)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  function chunks(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  function hopMap(q) {
    var hop = {};
    (q.normalized || []).concat(q.redirects || []).forEach(function (x) { hop[x.from] = x.to; });
    return function (tt) { var k = tt, n = 0; while (hop[k] && n++ < 6) k = hop[k]; return k; };
  }
  function plainText(html) {
    try { return (new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70); }
    catch (e) { return ""; }
  }
  function wikiImages(titles) {
    return Promise.all(chunks(titles, 50).map(function (c) {
      return wikiApi(LANG + ".wikipedia.org", "redirects=1&prop=pageimages&piprop=name%7Cthumbnail&pithumbsize=640&pilicense=free&titles=" +
        encodeURIComponent(c.join("|"))).then(function (j) {
        var q = j.query || {}, end = hopMap(q), pages = {}, out = {};
        (q.pages || []).forEach(function (p) { pages[p.title] = p; });
        c.forEach(function (tt) {
          var p = pages[end(tt)];
          if (p && p.pageimage && p.thumbnail && p.thumbnail.source) out[tt] = { file: p.pageimage, thumb: p.thumbnail.source };
        });
        return out;
      });
    })).then(function (parts) { return Object.assign.apply(Object, [{}].concat(parts)); });
  }
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
            out[f] = { a: plainText(m.Artist && m.Artist.value) || t("photo_unknown_author"), l: plainText(m.LicenseShortName.value), u: ii.descriptionurl || "" };
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
      var rest = todo.filter(function (s) { return !found[s.sci]; });   // repli : article au nom courant
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
        GP.items[s.sci] = c ? { t: f.thumb, a: c.a, l: c.l, u: c.u } : 0;   // sans licence lisible, pas de photo
      });
      GP.at = Date.now(); LS.set(GPKEY, GP);
      if (route() === "glossaire" && $("gloss-list")) $("gloss-list").innerHTML = glossListHTML();
    }).catch(function (e) { console.warn("Photos du glossaire indisponibles", e); })
      .then(function () { gpBusy = false; });
  }
  function glossPhotoHTML(s) {
    var p = GP.items[s.sci];
    if (!p || !p.t) return "";
    return '<figure class="gph"><img class="gimg" loading="lazy" crossorigin="anonymous" alt="' + esc(s.name) + '" src="' + esc(p.t) + '">' +
      '<figcaption>' + esc(t("photo_credit", p.a, p.l)) +
      (p.u ? ' · <a href="' + esc(p.u) + '" target="_blank" rel="noopener">' + esc(t("commons")) + '</a>' : "") + '</figcaption></figure>';
  }
  document.addEventListener("error", function (e) {
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains("gimg")) return;
    if (img.hasAttribute("crossorigin")) { var src = img.src; img.removeAttribute("crossorigin"); img.src = ""; img.src = src; }
    else if (img.parentNode) img.parentNode.style.display = "none";
  }, true);

  /* ---------- texte de partage ---------- */
  function obsText(o) {
    var lines;
    if (isCam(o)) {
      lines = [t("sh_camera", camName(o)), t("sh_posted", fmtDate(o.date))];
      if (o.place) lines.push(t("location_label") + " " + o.place);
      if (hasCoords(o)) { lines.push(t("sh_gps") + " " + o.lat.toFixed(5) + ", " + o.lng.toFixed(5)); lines.push(t("sh_map") + " " + osmLink(o)); }
      if (o.notes) { lines.push(""); lines.push(o.notes); }
      return lines.join("\n");
    }
    lines = [obsSpecies(o) + (o.sci ? " (" + o.sci + ")" : "")];
    lines.push(fmtDate(o.date) + (o.count > 1 ? " · " + t("sh_individuals", o.count) : ""));
    if (o.place) lines.push(t("place_label") + " " + o.place);
    if (isSensitive(o)) lines.push(t("sh_gps_hidden"));   // en mode local comme en ligne
    else if (hasCoords(o)) {
      lines.push(t("sh_gps") + " " + o.lat.toFixed(5) + ", " + o.lng.toFixed(5));
      lines.push(t("sh_map") + " " + osmLink(o));
    }
    if (o.notes) { lines.push(""); lines.push(o.notes); }
    var by = o.other ? (o.authorName || CFG.auteur) : (CLOUD ? authorName() : CFG.auteur);
    if (by) { lines.push(""); lines.push("— " + by); }
    return lines.join("\n");
  }
  function subscriberEmails() {
    return state.subs.filter(function (s) { return s.email && (!CLOUD || s.approved !== false); })
      .map(function (s) { return s.email; });
  }
  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || t("t_copied")); },
        function () { toast(t("t_copy_fail")); });
    } else { toast(t("t_copy_fail")); }
  }

  /* ---------- vues ---------- */
  var VIEWS = ["observations", "carte", "glossaire", "abonnes", "reglages"];
  function route() { var h = location.hash.slice(1); return VIEWS.indexOf(h) >= 0 ? h : "observations"; }

  function gateHTML() {
    if (state.loading) return '<p class="empty">' + esc(t("loading")) + '</p>';
    if (state.role === "guest") return authHTML();
    if (state.role === "pending") {
      return '<div class="card"><h2>' + esc(t("pending_title")) + '</h2>' +
        (state.me
          ? '<p>' + esc(t("pending_text", CFG.auteur || t("the_author"))) + '</p>'
          : '<p>' + esc(t("pending_none")) + '</p><div><button class="btn primary" data-act="ask-sub">' + esc(t("ask_sub")) + '</button></div>') +
        '<p class="meta">' + esc(t("connected_as", state.user.email)) + '</p>' +
        '<div><button class="btn small" data-act="signout">' + esc(t("signout")) + '</button></div></div>' +
        '<p class="meta">' + esc(t("gloss_still_open")) + '</p>';
    }
    return "";
  }
  function authHTML() {
    return '<div class="card"><h2>' + esc(CFG.auteur ? t("auth_title", CFG.auteur) : t("auth_title_generic")) + '</h2>' +
      '<p class="meta">' + esc(t("auth_intro")) + '</p>' +
      '<form id="auth-form">' +
      '<label for="au-email">' + esc(t("email")) + '<input id="au-email" type="email" autocomplete="email" required></label>' +
      '<label for="au-pass">' + esc(t("password")) + '<input id="au-pass" type="password" autocomplete="current-password" minlength="6" required></label>' +
      '<label for="au-name">' + esc(t("first_name_hint")) + '<input id="au-name" type="text" autocomplete="name"></label>' +
      '<div class="row"><button class="btn primary" type="submit" data-mode="in">' + esc(t("signin")) + '</button>' +
      '<button class="btn" type="submit" data-mode="up">' + esc(t("signup")) + '</button></div>' +
      '<div><button class="btn small" type="button" data-act="reset-pass">' + esc(t("forgot")) + '</button></div>' +
      '</form></div>';
  }
  function syncPill(o) {
    if (!CLOUD || o.other || isCam(o)) return "";
    return o.synced ? ' <span class="pill ok">' + esc(t("pill_online")) + '</span>'
      : ' <span class="pill">' + esc(t("pill_local")) + '</span>';
  }

  function filteredObs() {
    var q = norm(state.q), all = obsList();
    if (CLOUD && state.who !== "all") all = all.filter(function (o) { return (state.who === "others") === !!o.other; });
    if (state.kind !== "all") all = all.filter(function (o) { return (state.kind === "camera") === isCam(o); });
    if (!q) return all;
    return all.filter(function (o) { return norm([title(o), o.sci, o.place, o.notes].join(" ")).indexOf(q) >= 0; });
  }
  function obsListHTML() {
    var list = filteredObs();
    if (!obsList().length) return '<p class="empty">' + esc(t("empty_obs")) + '</p>';
    if (!list.length) return '<p class="empty">' + esc(t("empty_search")) + '</p>';
    return list.map(function (o) {
      var coords = hasCoords(o) ? o.lat.toFixed(4) + ", " + o.lng.toFixed(4) : t("place_unknown");
      if (isCam(o)) {
        return '<div class="card obs"><button class="main" data-act="open" data-id="' + esc(o.id) + '"><span class="row">' +
          (o.photo ? '<img class="thumb" alt="" src="' + esc(o.photo) + '">' : "") +
          '<span class="grow"><h3>' + esc(camName(o)) + '</h3>' +
          '<span class="meta">' + esc(t("posted_on", shortDate(o.date))) + '</span><br>' +
          '<span class="meta">' + esc(o.place || coords) + '</span>' +
          ' <span class="pill cam">' + esc(t("pill_camera")) + '</span>' +
          '</span></span></button></div>';
      }
      var where = o.other && o.locHidden ? (o.place || t("place_unknown")) + " · " + t("gps_hidden_short") : (o.place || coords);
      return '<div class="card obs"><button class="main" data-act="open" data-id="' + esc(o.id) + '"><span class="row">' +
        (o.photo ? '<img class="thumb" alt="" src="' + esc(o.photo) + '">' : "") +
        '<span class="grow"><h3>' + esc(obsSpecies(o)) + (o.count > 1 ? " × " + esc(o.count) : "") + '</h3>' +
        (o.sci ? '<em class="sci">' + esc(o.sci) + '</em><br>' : "") +
        '<span class="meta">' + esc(fmtDate(o.date)) + '</span><br>' +
        '<span class="meta">' + esc(where) + (o.other ? " · " + esc(t("by_member", o.authorName || CFG.auteur || t("a_member"))) : "") + '</span>' +
        (isSensitive(o) ? ' <span class="pill warn">' + esc(t("pill_sensitive")) + '</span>' : "") + syncPill(o) +
        '</span></span></button>' + likeBarHTML(o) + '</div>';
    }).join("");
  }
  function chipsHTML(act, cur, items) {
    return '<div class="chips">' + items.map(function (c) {
      return '<button class="chip" data-act="' + act + '" data-v="' + c[0] + '" aria-pressed="' + (cur === c[0]) + '">' + esc(c[1]) + '</button>';
    }).join("") + '</div>';
  }
  function viewObservations() {
    var g = gateHTML(); if (g) return g;
    var all = obsList(), nSp = {}, nCam = 0;
    all.forEach(function (o) { if (isCam(o)) nCam++; else nSp[norm(title(o))] = 1; });
    return '<div class="row between"><h2>' + esc(t("n_obs", all.length - nCam)) + " · " + esc(t("n_species", Object.keys(nSp).length)) +
      (nCam ? " · " + esc(t("n_cams", nCam)) : "") + '</h2></div>' +
      '<input id="q" type="search" placeholder="' + esc(t("search_obs")) + '" aria-label="' + esc(t("search_obs_aria")) + '" value="' + esc(state.q) + '">' +
      (nCam ? chipsHTML("kind", state.kind, [["all", t("kind_all")], ["obs", t("kind_obs")], ["camera", t("kind_cams")]]) : "") +
      (CLOUD ? chipsHTML("who", state.who, [["all", t("who_all")], ["mine", t("who_mine")], ["others", t("who_others")]]) : "") +
      '<div id="obs-list" class="stack">' + obsListHTML() + '</div>' +
      '<button class="btn primary fab" data-act="new">' + esc(t("fab_new")) + '</button>';
  }

  function viewCarte() {
    var g = gateHTML(); if (g) return g;
    var n = obsList().filter(function (o) {
      return hasCoords(o) && (state.kind === "all" || (state.kind === "camera") === isCam(o));
    }).length;
    return '<p class="meta">' + esc(t("map_intro", n)) + (CLOUD ? esc(t("map_sensitive")) : "") + '</p>' +
      '<div class="row legend">' + pinHTML("oiseaux", false) + '<span>' + esc(t("legend_bird")) + '</span>' +
      pinHTML("mammiferes", false) + '<span>' + esc(t("legend_mammal")) + '</span>' +
      pinHTML("autre", false) + '<span>' + esc(t("legend_other")) + '</span>' +
      pinHTML("camera", false) + '<span>' + esc(t("legend_camera")) + '</span>' +
      pinHTML("oiseaux", true) + '<span>' + esc(t("legend_sensitive")) + '</span></div>' +
      '<div id="map-all" class="map big"></div>';
  }

  function glossListHTML() {
    var q = norm(state.gq), counts = {};
    obsList().forEach(function (o) {
      if (isCam(o)) return;
      var sp = findSpecies(o); if (!sp) return;
      counts[sp.sci] = (counts[sp.sci] || 0) + 1;
    });
    var list = SPECIES.filter(function (s) {
      if (state.ggroup !== "tous" && s.group !== state.ggroup) return false;
      return !q || norm(s.name + " " + s.sci + " " + s.catLabel + " " + s.habitat).indexOf(q) >= 0;
    });
    if (!list.length) return '<p class="empty">' + esc(t("gloss_empty")) + '</p>';
    var out = "", cat = "";
    list.forEach(function (s) {
      if (s.cat !== cat) { cat = s.cat; out += '<p class="cat">' + esc(s.catLabel) + '</p>'; }
      var c = counts[s.sci] || 0;
      out += '<article class="card">' + glossPhotoHTML(s) +
        '<div class="row between"><h3>' + esc(s.name) + '</h3>' +
        (c && canRead() ? '<span class="pill ok">' + esc(t("n_records", c)) + '</span>' : "") + '</div>' +
        '<em class="sci">' + esc(s.sci) + '</em>' +
        '<div class="row"><span class="pill">' + esc(s.statut) + '</span>' +
        (s.sensible ? '<span class="pill warn">' + esc(t("sensitive_badge")) + '</span>' : "") + '</div>' +
        '<p><strong>' + esc(t("where")) + '</strong> ' + esc(s.habitat) + '</p><p class="meta">' + esc(s.note) + '</p>' +
        (canRead() ? '<div><button class="btn small" data-act="new" data-species="' + esc(s.name) + '">' + esc(t("note_species")) + '</button></div>' : "") +
        '</article>';
    });
    return out;
  }
  function viewGlossaire() {
    return '<h2>' + esc(t("gloss_title")) + '</h2>' +
      '<p class="meta">' + esc(t("gloss_intro", G.oiseaux.length, G.mammiferes.length)) + " " + esc(t("gloss_photos")) + '</p>' +
      '<input id="gq" type="search" placeholder="' + esc(t("gloss_search")) + '" aria-label="' + esc(t("gloss_search_aria")) + '" value="' + esc(state.gq) + '">' +
      chipsHTML("ggroup", state.ggroup, [["tous", t("gloss_all")], ["oiseaux", t("gloss_birds")], ["mammiferes", t("gloss_mammals")]]) +
      '<div id="gloss-list" class="stack">' + glossListHTML() + '</div>';
  }

  function viewAbonnes() {
    if (!isOwner()) {
      var g = gateHTML(); if (g) return g;
      return '<div class="card"><h2>' + esc(t("my_account")) + '</h2><p>' + esc(t("subscriber_is", state.user.email)) + '</p>' +
        '<div class="row"><button class="btn small" data-act="signout">' + esc(t("signout")) + '</button>' +
        '<button class="btn small danger" data-act="unsubscribe">' + esc(t("unsubscribe")) + '</button></div></div>';
    }
    var pending = state.subs.filter(function (s) { return CLOUD && s.approved === false; });
    var active = state.subs.filter(function (s) { return !CLOUD || s.approved !== false; });
    var h = "";
    if (!CLOUD) h += '<p class="notice">' + esc(t("local_share_note")) + '</p>';
    else {
      h += '<div class="card"><h2>' + esc(t("invite")) + '</h2><p class="meta">' + esc(t("invite_note")) + '</p>' +
        '<p style="word-break:break-all">' + esc(location.origin + location.pathname) + '</p>' +
        '<div><button class="btn small" data-act="copy-link">' + esc(t("copy_link")) + '</button></div></div>';
    }
    if (pending.length) {
      h += '<h2>' + esc(t("pending_requests")) + '</h2>' + pending.map(function (s) {
        return '<div class="card"><h3>' + esc(s.name || s.email) + '</h3><p class="meta">' + esc(s.email) + '</p>' +
          '<div class="row"><button class="btn small primary" data-act="approve" data-id="' + esc(s.id) + '">' + esc(t("accept")) + '</button>' +
          '<button class="btn small danger" data-act="del-sub" data-id="' + esc(s.id) + '">' + esc(t("refuse")) + '</button></div></div>';
      }).join("");
    }
    h += '<div class="row between"><h2>' + esc(t("n_subs", active.length)) + '</h2>' +
      (active.length ? '<button class="btn small" data-act="copy-emails">' + esc(t("copy_emails")) + '</button>' : "") + '</div>';
    h += active.length ? active.map(function (s) {
      return '<div class="card"><div class="row between"><div class="grow"><h3>' + esc(s.name || s.email) + '</h3>' +
        '<p class="meta">' + esc(s.email) + '</p></div>' +
        (CLOUD ? '<span class="pill">' + esc(s.account ? t("sub_account") : t("sub_contact")) + '</span>' : "") +
        '<button class="btn small danger" data-act="del-sub" data-id="' + esc(s.id) + '">' + esc(t("remove")) + '</button></div></div>';
    }).join("") : '<p class="empty">' + esc(t("empty_subs")) + '</p>';
    h += '<div class="card"><h2>' + esc(t("add_contact")) + '</h2><form id="sub-form">' +
      '<label for="sb-name">' + esc(t("name")) + '<input id="sb-name" type="text" required></label>' +
      '<label for="sb-email">' + esc(t("email")) + '<input id="sb-email" type="email" required></label>' +
      '<div><button class="btn primary" type="submit">' + esc(t("add")) + '</button></div></form></div>';
    return h;
  }

  function optHTML(name, value, checked, head, desc, disabled) {
    return '<label class="opt" for="' + name + '-' + value + '"><input type="radio" id="' + name + '-' + value + '" name="' + name + '" value="' + value + '"' +
      (checked ? " checked" : "") + (disabled ? " disabled" : "") + '><span><strong>' + esc(head) + '</strong>' +
      (desc ? '<br><span class="meta">' + esc(desc) + '</span>' : "") + '</span></label>';
  }
  function wantOnline(o) { return state.sel[o.id] === undefined ? !!o.synced : state.sel[o.id]; }
  function syncCardHTML() {
    var mine = syncables(), total = mine.length, on = mine.filter(function (o) { return o.synced; }).length;
    var h = '<div class="card"><h2>' + esc(t("sync_title")) + '</h2>' +
      '<p>' + esc(t("sync_count", on, total)) + '</p>' +
      '<p class="notice warn">' + esc(t("sync_sensitive")) + '</p>' +
      optHTML("policy", "all", state.syncPolicy === "all", t("policy_all"), t("policy_all_desc")) +
      optHTML("policy", "choose", state.syncPolicy !== "all", t("policy_choose"), t("policy_choose_desc"));
    if (state.syncPolicy !== "all") {
      if (!total) h += '<p class="meta">' + esc(t("nothing_to_sync")) + '</p>';
      else {
        var changes = mine.filter(function (o) { return wantOnline(o) !== !!o.synced; }).length;
        h += '<div class="row"><button class="btn small" data-act="sel-all">' + esc(t("check_all")) + '</button>' +
          '<button class="btn small" data-act="sel-none">' + esc(t("uncheck_all")) + '</button></div><div class="stack tight">' +
          mine.map(function (o) {
            return '<label class="chk" for="sel-' + esc(o.id) + '"><input type="checkbox" id="sel-' + esc(o.id) + '" data-sel="' + esc(o.id) + '"' +
              (wantOnline(o) ? " checked" : "") + '><span class="grow">' + esc(obsSpecies(o)) + ' <span class="meta">· ' + esc(shortDate(o.date)) +
              (o.place ? " · " + esc(o.place) : "") + '</span></span>' + syncPill(o) + '</label>';
          }).join("") + '</div>' +
          '<div class="row"><button class="btn primary" data-act="sel-apply"' + (changes ? "" : " disabled") + '>' + esc(t("apply")) +
          (changes ? " (" + esc(t("n_changes", changes)) + ")" : "") + '</button>' +
          '<button class="btn" data-act="sync-all">' + esc(t("sync_now")) + '</button></div>';
      }
    }
    return h + '</div>';
  }
  function viewReglages() {
    var h = '<div class="card"><h2>' + esc(t("lang_title")) + '</h2>' +
      Object.keys(I18N).map(function (code) {
        return optHTML("lang", code, code === LANG, I18N[code].label, "");
      }).join("") +
      '<p class="meta">' + esc(t("lang_desc")) + '</p></div>';
    h += '<div class="card"><h2>' + esc(t("mode_title")) + '</h2>' +
      optHTML("mode", "local", !CLOUD, t("mode_local"), t("mode_local_desc")) +
      optHTML("mode", "online", CLOUD, t("mode_online"), t("mode_online_desc"), !ONLINE_OK) +
      (ONLINE_OK ? '<p class="meta">' + esc(t("mode_switch")) + '</p>'
        : '<p class="notice">' + esc(t("mode_need_cfg")) + '</p>') + '</div>';
    if (CLOUD) {
      if (canRead()) h += syncCardHTML();
      else if (state.role === "guest" && !state.loading) h += '<p class="notice">' + esc(t("login_for_sync")) + '</p>';
    }
    if (canRead()) {
      h += '<div class="card"><h2>' + esc(t("backup")) + '</h2><p class="meta">' + esc(t("backup_desc")) + '</p>' +
        '<div class="row"><button class="btn small" data-act="export">' + esc(t("export")) + '</button>' +
        '<label class="btn small" for="import-file">' + esc(t("import")) + '<input id="import-file" type="file" accept="application/json,.json" hidden></label></div></div>';
    }
    if (CLOUD && state.user) {
      h += '<div class="card"><p class="meta">' + esc(t("connected_as", state.user.email)) + '</p>' +
        '<div><button class="btn small" data-act="signout">' + esc(t("signout")) + '</button></div></div>';
    }
    h += '<p class="meta" style="text-align:center">Version ' + VERSION + ' · ' + esc(SPECIES.length) + ' ' +
      esc(t("gloss_all").toLowerCase()) + '</p>';
    return h;
  }

  function render() {
    var v = route();
    document.querySelectorAll("nav.tabs a").forEach(function (a) {
      if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("tab-obs").textContent = t("tab_obs");
    $("tab-map").textContent = t("tab_map");
    $("tab-gloss").textContent = t("tab_gloss");
    $("tab-abonnes").textContent = isOwner() ? t("tab_subs") : t("tab_account");
    $("tab-reglages").textContent = t("tab_settings");
    $("app-title").textContent = CFG.titre || "Carnet d'affût";
    $("app-status").textContent = !CLOUD ? t("st_local")
      : t("st_online") + (isOwner() ? " · " + t("st_author") : state.role === "subscriber" ? " · " + t("st_subscriber") : "") +
        (offline() && state.user ? " · " + t("st_offline") : "");
    killMap("all");
    $("main").innerHTML = { observations: viewObservations, carte: viewCarte, glossaire: viewGlossaire, abonnes: viewAbonnes, reglages: viewReglages }[v]();
    if (v === "carte" && $("map-all")) drawAllMap();
    if (v === "glossaire") loadGlossPhotos();
  }

  /* ---------- cartes ---------- */
  function killMap(k) { if (maps[k]) { try { maps[k].remove(); } catch (e) {} maps[k] = null; } }
  function makeMap(k, el, center, zoom) {
    killMap(k);
    if (!window.L) { el.innerHTML = '<p class="empty">' + esc(t("map_unavailable")) + '</p>'; return null; }
    var m = L.map(el).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
    maps[k] = m;
    setTimeout(function () { m.invalidateSize(); }, 60);
    return m;
  }
  /* Icônes : silhouette d'oiseau, silhouette de renard, appareil photo, ou point neutre. */
  var GLYPH = {
    oiseaux: '<path d="M23.2 9.6 L20.2 8.6 C19.8 6.2 16.2 5.4 14.4 7.8 C11 9.4 7.2 12 4.6 15 L0.8 19.4 L3.2 20.2 L6.8 17.6 C10.4 19.2 16.2 18.6 18.6 13.6 C19.2 12.4 19.8 11.4 20.4 10.6 Z"/><rect x="10.4" y="18" width="1" height="3.6"/><rect x="13" y="17.8" width="1" height="3.6"/>',
    mammiferes: '<path d="M23 11.6 L19.6 8.6 L19.7 4.2 L17.9 7 L16.5 4.6 L15.9 8.6 C14.5 9.6 12 10 8.2 10.4 C5.6 10.2 2.8 7.6 0.8 3.4 C0.2 8.6 2.2 13.2 6.3 14.2 L6.6 20.2 L8.2 20.2 L8.7 15.6 L13.1 15.6 L13.3 20.2 L14.9 20.2 L15.3 15 C16.4 14.6 17.2 13.9 17.6 13.2 L20.2 12.7 Z"/>',
    camera: '<path fill-rule="evenodd" d="M3.2 7.4 H7.4 L9 4.9 H15 L16.6 7.4 H20.8 C21.8 7.4 22.6 8.2 22.6 9.2 V17.8 C22.6 18.8 21.8 19.6 20.8 19.6 H3.2 C2.2 19.6 1.4 18.8 1.4 17.8 V9.2 C1.4 8.2 2.2 7.4 3.2 7.4 Z M12 9.9 C9.8 9.9 8 11.7 8 13.9 C8 16.1 9.8 17.9 12 17.9 C14.2 17.9 16 16.1 16 13.9 C16 11.7 14.2 9.9 12 9.9 Z"/><circle cx="19.6" cy="10.4" r="0.9"/>',
    autre: '<circle cx="12" cy="12" r="4.5"/>'
  };
  function obsGroup(o) {
    if (isCam(o)) return "camera";
    var sp = findSpecies(o);
    return sp ? sp.group : "autre";
  }
  function pinHTML(group, sensible) {
    return '<span class="pin pin-' + group + (sensible ? " pin-sensible" : "") + '"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">' + GLYPH[group] + '</svg></span>';
  }
  function obsMarker(o) {
    var group = obsGroup(o);
    var kindWord = group === "oiseaux" ? t("legend_bird") : group === "mammiferes" ? t("legend_mammal") : group === "camera" ? t("legend_camera") : "";
    return L.marker([o.lat, o.lng], {
      title: title(o), alt: (kindWord ? kindWord + (LANG === "fr" ? " : " : ": ") : "") + title(o),
      icon: L.divIcon({ className: "pin-wrap", html: pinHTML(group, isSensitive(o)), iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] })
    });
  }
  function popupNode(o) {
    var box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = '<strong>' + esc(title(o)) + (!isCam(o) && o.count > 1 ? " × " + esc(o.count) : "") + '</strong>' +
      '<span>' + esc(isCam(o) ? t("cam_posted", shortDate(o.date)) : fmtDate(o.date)) + '</span>' +
      (o.place ? '<span>' + esc(o.place) + '</span>' : "") +
      '<a href="#carte" class="pop-link">' + esc(t("popup_detail")) + '</a>';
    box.querySelector(".pop-link").addEventListener("click", function (e) { e.preventDefault(); openDetail(o.id); });
    return box;
  }
  function drawAllMap() {
    var m = makeMap("all", $("map-all"), CENTER, 8); if (!m) return;
    var pts = [];
    filteredObs().filter(hasCoords).forEach(function (o) {
      obsMarker(o).addTo(m).bindPopup(popupNode(o));
      pts.push([o.lat, o.lng]);
    });
    if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  }

  /* ---------- fiche détaillée ---------- */
  function openCamDetail(o) {
    var d = $("dlg-detail");
    d.innerHTML = '<div class="dlg">' +
      '<div><h2>' + esc(camName(o)) + '</h2><span class="pill cam">' + esc(t("pill_camera")) + '</span></div>' +
      '<p>' + esc(t("posted_on", fmtDate(o.date))) + '</p>' +
      (o.place ? '<p><strong>' + esc(t("location_label")) + '</strong> ' + esc(o.place) + '</p>' : "") +
      (hasCoords(o) ? '<p class="meta">GPS ' + o.lat.toFixed(5) + ", " + o.lng.toFixed(5) +
        ' · <a href="' + osmLink(o) + '" target="_blank" rel="noopener">' + esc(t("open_osm")) + '</a></p><div id="map-detail" class="map"></div>' : "") +
      '<p class="notice">' + esc(t("cam_never_published")) + '</p>' +
      (o.photo ? '<img class="photo" alt="' + esc(t("cam_photo_alt")) + '" src="' + esc(o.photo) + '">' : "") +
      (o.notes ? '<p style="white-space:pre-wrap">' + esc(o.notes) + '</p>' : "") +
      '<div class="row"><button class="btn" data-act="copy-obs" data-id="' + esc(o.id) + '">' + esc(t("copy_sheet")) + '</button></div>' +
      '<div class="row"><button class="btn small" data-act="edit" data-id="' + esc(o.id) + '">' + esc(t("edit")) + '</button>' +
      '<button class="btn small danger" data-act="del" data-id="' + esc(o.id) + '">' + esc(t("del")) + '</button>' +
      '<button class="btn small" data-act="close-detail">' + esc(t("close")) + '</button></div></div>';
    if (!d.open) d.showModal();
    if (hasCoords(o) && $("map-detail")) {
      var m = makeMap("detail", $("map-detail"), [o.lat, o.lng], 14);
      if (m) obsMarker(o).addTo(m);
    }
  }
  function openDetail(id) {
    var o = findObs(id); if (!o) return;
    if (isCam(o)) return openCamDetail(o);
    var d = $("dlg-detail"), cloudMine = CLOUD && !o.other, sens = isSensitive(o);
    var sensMsg = !sens ? "" : o.other ? t("sens_other") : CLOUD ? t("sens_mine_online") : t("sens_local");
    d.innerHTML = '<div class="dlg">' +
      '<div><h2>' + esc(obsSpecies(o)) + (o.count > 1 ? " × " + esc(o.count) : "") + '</h2>' +
      (o.sci ? '<em class="sci">' + esc(o.sci) + '</em>' : "") + '</div>' +
      '<p>' + esc(fmtDate(o.date)) + syncPill(o) + '</p>' +
      (o.other ? '<p class="meta">' + esc(t("published_by", o.authorName || CFG.auteur || t("a_member"))) + '</p>' : "") +
      (o.place ? '<p><strong>' + esc(t("place_label")) + '</strong> ' + esc(o.place) + '</p>' : "") +
      (hasCoords(o) ? '<p class="meta">GPS ' + o.lat.toFixed(5) + ", " + o.lng.toFixed(5) +
        ' · <a href="' + osmLink(o) + '" target="_blank" rel="noopener">' + esc(t("open_osm")) + '</a></p><div id="map-detail" class="map"></div>' : "") +
      (sens ? '<p class="notice warn">' + esc(sensMsg) + '</p>' : "") +
      (o.photo ? '<img class="photo" alt="' + esc(t("photo_alt")) + '" src="' + esc(o.photo) + '">' : "") +
      (o.notes ? '<p style="white-space:pre-wrap">' + esc(o.notes) + '</p>' : "") +
      '<div class="row">' +
      '<button class="btn primary" data-act="share" data-id="' + esc(o.id) + '">' + esc(t("share")) + '</button>' +
      (isOwner() && !o.other ? '<a class="btn" data-act="mail" data-id="' + esc(o.id) + '" href="#">' + esc(t("email_subs")) + '</a>' : "") +
      '<button class="btn" data-act="copy-obs" data-id="' + esc(o.id) + '">' + esc(t("copy")) + '</button></div>' +
      (canLike(o) ? '<div class="row likerow">' + likeBarHTML(o) +
        '<span class="meta" data-likers-for="' + esc(o.id) + '">' + esc(likersHTML(o.id)) + '</span></div>' : "") +
      (cloudMine ? '<div><button class="btn" data-act="toggle-sync" data-id="' + esc(o.id) + '">' +
        esc(o.synced ? t("unpublish") : t("publish")) + '</button></div>' : "") +
      '<div class="row">' +
      (!o.other ? '<button class="btn small" data-act="edit" data-id="' + esc(o.id) + '">' + esc(t("edit")) + '</button>' +
        '<button class="btn small danger" data-act="del" data-id="' + esc(o.id) + '">' + esc(t("del")) + '</button>'
        : isOwner() ? '<button class="btn small danger" data-act="moderate" data-id="' + esc(o.id) + '">' + esc(t("moderate")) + '</button>' : "") +
      '<button class="btn small" data-act="close-detail">' + esc(t("close")) + '</button></div></div>';
    if (!d.open) d.showModal();
    if (hasCoords(o) && $("map-detail")) {
      var m = makeMap("detail", $("map-detail"), [o.lat, o.lng], 14);
      if (m) obsMarker(o).addTo(m);
    }
  }

  /* ---------- formulaire ---------- */
  function coordsLabel(f) { return hasCoords(f) ? f.lat.toFixed(5) + ", " + f.lng.toFixed(5) : t("coords_none"); }
  function photoPreviewHTML(src) {
    return src ? '<img class="photo" alt="' + esc(t("photo_preview")) + '" src="' + esc(src) + '">' +
      '<div><button class="btn small danger" type="button" data-act="rm-photo">' + esc(t("rm_photo")) + '</button></div>' : "";
  }
  function openForm(o, species) {
    var f = state.form = o ? Object.assign({}, o) : {
      species: species || "", date: nowLocal(), count: 1, place: "", lat: null, lng: null, notes: "", photo: "", hideLoc: false, kind: ""
    };
    var cam = isCam(f);
    var d = $("dlg-form");
    d.innerHTML = '<div class="dlg"><h2>' +
      esc(f.id ? (cam ? t("edit_cam") : t("edit_obs")) : cam ? t("new_cam") : t("new_obs")) + '</h2>' +
      '<form id="obs-form">' +
      '<div class="chips">' + [["", t("kind_observation")], ["camera", t("kind_camera")]].map(function (k) {
        return '<button type="button" class="chip" data-act="fkind" data-v="' + k[0] + '" aria-pressed="' + ((f.kind || "") === k[0]) + '">' + esc(k[1]) + '</button>';
      }).join("") + '</div>' +
      (cam ? '<p class="notice">' + esc(t("cam_form_note")) + '</p>' : "") +
      (cam
        ? '<label for="f-species">' + esc(t("f_camname")) + '<input id="f-species" required autocomplete="off" value="' + esc(f.species) + '" placeholder="' + esc(t("f_camname_ph")) + '"></label>'
        : '<label for="f-species">' + esc(t("f_species")) + '<input id="f-species" list="species-list" required autocomplete="off" value="' + esc(f.species) + '" placeholder="' + esc(t("f_species_ph")) + '"></label>' +
          '<datalist id="species-list">' + SPECIES.map(function (s) { return '<option value="' + esc(s.name) + '">' + esc(s.sci) + '</option>'; }).join("") + '</datalist>') +
      (cam
        ? '<label for="f-date">' + esc(t("f_posedate")) + '<input id="f-date" type="datetime-local" required value="' + esc(f.date) + '"></label>'
        : '<div class="two"><label for="f-date">' + esc(t("f_datetime")) + '<input id="f-date" type="datetime-local" required value="' + esc(f.date) + '"></label>' +
          '<label for="f-count">' + esc(t("f_count")) + '<input id="f-count" type="number" min="1" inputmode="numeric" value="' + esc(f.count || 1) + '"></label></div>') +
      '<label for="f-place">' + esc(t("f_place")) + '<input id="f-place" value="' + esc(f.place) + '" placeholder="' + esc(cam ? t("f_camplace_ph") : t("f_place_ph")) + '"></label>' +
      '<div class="row"><button class="btn" type="button" data-act="gps">' + esc(t("gps_button")) + '</button>' +
      '<span class="meta" id="f-coords">' + esc(coordsLabel(f)) + '</span></div>' +
      '<div id="map-form" class="map"></div><p class="meta">' + esc(t("map_hint")) + '</p>' +
      (cam ? "" : '<label class="chk" for="f-hide"><input type="checkbox" id="f-hide"' + (f.hideLoc ? " checked" : "") + '><span class="grow">' +
        esc(t("f_hide")) + '<br><span class="meta">' + esc(t("f_hide_desc")) + '</span></span></label>') +
      '<div class="field"><span class="flabel">' + esc(t("f_photo")) + '</span><div class="row">' +
      '<label class="btn" for="f-cam">' + esc(t("take_photo")) + '<input id="f-cam" type="file" accept="image/*" capture="environment" hidden></label>' +
      '<label class="btn" for="f-photo">' + esc(t("pick_photo")) + '<input id="f-photo" type="file" accept="image/*" hidden></label></div></div>' +
      '<div id="f-preview" class="stack tight">' + photoPreviewHTML(f.photo) + '</div>' +
      '<label for="f-notes">' + esc(t("f_notes")) + '<textarea id="f-notes" rows="3" placeholder="' + esc(cam ? t("cam_notes_ph") : t("notes_ph")) + '">' + esc(f.notes) + '</textarea></label>' +
      '<div class="row"><button class="btn primary" type="submit">' + esc(t("save")) + '</button>' +
      '<button class="btn" type="button" data-act="close-form">' + esc(t("cancel")) + '</button></div></form></div>';
    if ($("dlg-detail").open) $("dlg-detail").close();
    d.showModal();
    var last = myList().filter(hasCoords)[0];
    var start = hasCoords(f) ? [f.lat, f.lng] : last ? [last.lat, last.lng] : CENTER;
    var m = makeMap("form", $("map-form"), start, hasCoords(f) ? 14 : last ? 11 : 8);
    if (m) {
      if (hasCoords(f)) setFormPoint(f.lat, f.lng, false);
      m.on("click", function (e) { setFormPoint(e.latlng.lat, e.latlng.lng, false); });
    }
  }
  /* Relit les champs saisis : la bascule observation / caméra redessine le formulaire. */
  function readForm() {
    var f = state.form; if (!f) return f;
    if ($("f-species")) f.species = $("f-species").value.trim();
    if ($("f-date")) f.date = $("f-date").value;
    if ($("f-count")) f.count = Math.max(1, parseInt($("f-count").value, 10) || 1);
    if ($("f-place")) f.place = $("f-place").value.trim();
    if ($("f-notes")) f.notes = $("f-notes").value.trim();
    f.hideLoc = $("f-hide") ? $("f-hide").checked : !!f.hideLoc;
    return f;
  }
  var formMarker = null;
  function setFormPoint(lat, lng, recenter) {
    state.form.lat = lat; state.form.lng = lng;
    $("f-coords").textContent = coordsLabel(state.form);
    var m = maps.form; if (!m) return;
    if (formMarker) { try { formMarker.remove(); } catch (e) {} }
    formMarker = L.circleMarker([lat, lng], { radius: 9, weight: 2, color: "#ffffff", fillColor: "#0c6b7f", fillOpacity: 1 }).addTo(m);
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
    var NEEDS_NET = ["moderate", "toggle-sync", "sel-apply", "sync-all", "approve", "del-sub", "signout", "ask-sub", "unsubscribe", "reset-pass"];
    if (NEEDS_NET.indexOf(act) >= 0 && needDb()) return;
    if (act === "new") { openForm(null, el.dataset.species || ""); }
    else if (act === "open") { openDetail(id); }
    else if (act === "close-detail") { $("dlg-detail").close(); }
    else if (act === "close-form") { $("dlg-form").close(); }
    else if (act === "edit") { openForm(findObs(id)); }
    else if (act === "rm-photo") { state.form.photo = ""; $("f-preview").innerHTML = ""; }
    else if (act === "fkind") { var ff = readForm(); ff.kind = el.dataset.v; openForm(ff); }
    else if (act === "del") {
      var del = findObs(id);
      if (confirm(del && isCam(del) ? t("c_del_cam") : CLOUD ? t("c_del_obs_online") : t("c_del_obs"))) {
        store.deleteObs(id).then(function () {
          $("dlg-detail").close(); toast(del && isCam(del) ? t("t_deleted_cam") : t("t_deleted_obs")); render();
        }).catch(function () { toast(t("t_delete_fail")); });
      }
    }
    else if (act === "moderate") {
      if (confirm(t("c_moderate"))) {
        db.collection("observations").doc(id).delete().then(function () {
          $("dlg-detail").close(); toast(t("t_moderated"));
        }, cloudErr);
      }
    }
    else if (act === "toggle-sync") {
      o = findObs(id); if (!o) return;
      var was = o.synced;
      (was ? unpublish(o) : publish(o)).then(function () {
        toast(was ? t("t_unpublished") : isSensitive(o) ? t("t_published_nogps") : t("t_published"));
        openDetail(id); render();
      });
    }
    else if (act === "sel-all" || act === "sel-none") {
      syncables().forEach(function (x) { state.sel[x.id] = act === "sel-all"; }); render();
    }
    else if (act === "who") { state.who = el.dataset.v; render(); }
    else if (act === "kind") { state.kind = el.dataset.v; render(); }
    else if (act === "like") { toggleLike(id); }
    else if (act === "sel-apply") {
      var jobs = [], pub = 0, unp = 0;
      syncables().forEach(function (x) {
        var want = wantOnline(x);
        if (want && !x.synced) { pub++; jobs.push(publish(x)); }
        else if (!want && x.synced) { unp++; jobs.push(unpublish(x)); }
      });
      state.sel = {};
      Promise.all(jobs).then(function () { toast(t("t_applied", pub, unp)); render(); });
    }
    else if (act === "sync-all") {
      state.sel = {};
      syncAll().then(function (n) { toast(n ? t("t_synced", n) : t("t_all_synced")); render(); });
    }
    else if (act === "share") {
      o = findObs(id); if (!o) return;
      var text = obsText(o);
      if (navigator.share) { navigator.share({ title: title(o), text: text }).catch(function () {}); }
      else { copy(text, t("t_copied_text")); }
    }
    else if (act === "copy-obs") { o = findObs(id); if (o) copy(obsText(o), t("t_copied_obs")); }
    else if (act === "mail") {
      e.preventDefault();
      o = findObs(id); if (!o) return;
      var emails = subscriberEmails();
      if (!emails.length) { toast(t("t_no_sub_email")); return; }
      location.href = "mailto:?bcc=" + encodeURIComponent(emails.join(",")) +
        "&subject=" + encodeURIComponent(t("sh_subject", title(o), o.place || fmtDate(o.date))) +
        "&body=" + encodeURIComponent(obsText(o));
    }
    else if (act === "gps") {
      if (!navigator.geolocation) { toast(t("t_gps_none")); return; }
      toast(t("t_gps_searching"));
      navigator.geolocation.getCurrentPosition(function (p) {
        setFormPoint(p.coords.latitude, p.coords.longitude, true);
        toast(t("t_gps_ok", Math.round(p.coords.accuracy)));
      }, function () { toast(t("t_gps_fail")); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }
    else if (act === "ggroup") { state.ggroup = el.dataset.v; render(); }
    else if (act === "approve") { store.updateSub(id, { approved: true }).then(function () { toast(t("t_sub_accepted")); render(); }); }
    else if (act === "del-sub") {
      if (confirm(t("c_rm_sub"))) store.deleteSub(id).then(function () { render(); });
    }
    else if (act === "copy-emails") { copy(subscriberEmails().join(", "), t("t_copied_emails")); }
    else if (act === "copy-link") { copy(location.origin + location.pathname, t("t_copied_link")); }
    else if (act === "signout") { auth.signOut(); }
    else if (act === "ask-sub") { requestSubscription("").then(function () { toast(t("t_request_sent")); }); }
    else if (act === "unsubscribe") {
      if (confirm(t("c_unsub"))) {
        db.collection("subscribers").doc(state.user.uid).delete().then(function () { toast(t("t_unsubscribed")); });
      }
    }
    else if (act === "reset-pass") {
      var em = ($("au-email").value || "").trim();
      if (!em) { toast(t("t_reset_need_email")); return; }
      auth.sendPasswordResetEmail(em).then(function () { toast(t("t_reset_sent")); },
        function (err) { toast(AUTH_ERR[err.code] ? authErr(err) : t("t_reset_fail")); });
    }
    else if (act === "export") { exportData(); }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id === "q") { state.q = e.target.value; $("obs-list").innerHTML = obsListHTML(); }
    else if (e.target.id === "gq") { state.gq = e.target.value; $("gloss-list").innerHTML = glossListHTML(); }
  });

  document.addEventListener("change", function (e) {
    var el = e.target;
    if ((el.id === "f-photo" || el.id === "f-cam") && el.files[0]) {
      resizePhoto(el.files[0]).then(function (data) {
        state.form.photo = data; $("f-preview").innerHTML = photoPreviewHTML(data);
      }, function () { toast(t("t_img_fail")); });
      el.value = "";
    } else if (el.id === "import-file" && el.files[0]) {
      importData(el.files[0]);
    } else if (el.name === "mode") {
      LS.set("carnet.mode", el.value); location.reload();
    } else if (el.name === "lang") {
      LS.set("carnet.lang", el.value); location.reload();
    } else if (el.name === "policy") {
      state.syncPolicy = el.value; LS.set("carnet.sync", el.value); state.sel = {};
      if (el.value === "all" && cloudOwner()) syncAll().then(function (n) { if (n) toast(t("t_synced", n)); render(); });
      render();
    } else if (el.dataset && el.dataset.sel) {
      state.sel[el.dataset.sel] = el.checked; render();
    }
  });

  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.id === "obs-form") {
      var o = Object.assign({}, readForm());
      if (isCam(o)) { o.sci = ""; o.count = 1; o.hideLoc = false; }
      else {
        var sp = BY_NAME[norm(o.species)];
        if (sp) { o.species = sp.name; o.sci = sp.sci; }
        else if (!state.form.sci) o.sci = "";
      }
      if (!hasCoords(o) && !o.place) { toast(isCam(o) ? t("t_need_place_cam") : t("t_need_place")); return; }
      store.saveObs(o).then(function () {
        $("dlg-form").close();
        toast(isCam(o) ? t("t_saved_cam") : CLOUD && !o.synced ? t("t_saved_local") : t("t_saved_obs"));
        render();
      }).catch(function (err) { console.error(err); toast(t("t_save_fail")); });
    } else if (f.id === "sub-form") {
      if (needDb()) return;
      var em = $("sb-email").value.trim().toLowerCase();
      if (state.subs.some(function (s) { return (s.email || "").toLowerCase() === em; })) { toast(t("t_sub_dup")); return; }
      store.addSub({ name: $("sb-name").value.trim(), email: em, approved: true, account: false, createdAt: Date.now() })
        .then(function () { toast(t("t_sub_added")); render(); });
    } else if (f.id === "auth-form") {
      if (needDb()) return;
      var mode = (e.submitter && e.submitter.dataset.mode) || "in";
      var email = $("au-email").value.trim(), pass = $("au-pass").value;
      pendingName = $("au-name").value.trim();
      var p = mode === "up"
        ? auth.createUserWithEmailAndPassword(email, pass).then(function (c) {
            var owner = (CFG.ownerEmail || "").trim().toLowerCase();
            if ((c.user.email || "").toLowerCase() !== owner) return requestSubscription(pendingName);
          })
        : auth.signInWithEmailAndPassword(email, pass);
      p.catch(function (err) { toast(authErr(err)); });
    }
  });

  ["dlg-form", "dlg-detail"].forEach(function (id) {
    $(id).addEventListener("close", function () { killMap(id === "dlg-form" ? "form" : "detail"); });
  });

  /* ---------- sauvegarde ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify({
      app: "carnet-affut", version: 3, exportedAt: new Date().toISOString(),
      observations: myList(), abonnes: state.subs
    }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "carnet-affut-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importData(file) {
    file.text().then(function (txt) {
      var data = JSON.parse(txt), obs = data.observations || [], subs = data.abonnes || [];
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
        toast(t("t_imported", jobs.length));
        if (cloudOwner() && state.syncPolicy === "all") syncAll();
        render();
      });
    }).catch(function () { toast(t("t_import_fail")); });
  }

  /* ---------- démarrage ---------- */
  document.documentElement.lang = LANG;
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
