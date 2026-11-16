/* Carnet d'affût — observations naturalistes partagées avec une liste d'abonnés. */
(function () {
  "use strict";

  var CFG = window.CARNET_CONFIG || {};
  var CLOUD = !!(CFG.firebase && CFG.firebase.apiKey);
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
    obs: [], subs: [],
    user: null,                       // compte connecté (mode en ligne)
    role: CLOUD ? "guest" : "owner",  // owner | subscriber | pending | guest
    loading: CLOUD,
    q: "", gq: "", ggroup: "tous",
    form: null
  };
  var db = null, auth = null, unsub = [], pendingName = "";
  var maps = {};

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
  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = "none"; }, 3800);
  }
  var LS = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { toast("Stockage de l'appareil plein : supprimez des photos ou exportez vos données."); return false; }
    }
  };
  function hasCoords(o) { return typeof o.lat === "number" && typeof o.lng === "number" && !isNaN(o.lat) && !isNaN(o.lng); }
  function osmLink(o) {
    return "https://www.openstreetmap.org/?mlat=" + o.lat.toFixed(5) + "&mlon=" + o.lng.toFixed(5) +
      "#map=15/" + o.lat.toFixed(5) + "/" + o.lng.toFixed(5);
  }
  function isOwner() { return state.role === "owner"; }
  function canRead() { return state.role === "owner" || state.role === "subscriber"; }

  /* ---------- stockage ---------- */
  function sortObs() { state.obs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }); }

  var store = {
    saveObs: function (o) {
      if (CLOUD) {
        var id = o.id || db.collection("observations").doc().id;
        var data = Object.assign({}, o); delete data.id;
        return db.collection("observations").doc(id).set(data);
      }
      if (!o.id) { o.id = uid(); state.obs.push(o); }
      else { state.obs = state.obs.map(function (x) { return x.id === o.id ? o : x; }); }
      sortObs(); LS.set("carnet.obs", state.obs); return Promise.resolve();
    },
    deleteObs: function (id) {
      if (CLOUD) return db.collection("observations").doc(id).delete();
      state.obs = state.obs.filter(function (x) { return x.id !== id; });
      LS.set("carnet.obs", state.obs); return Promise.resolve();
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
        toast("Connexion au service en ligne impossible. Vérifiez le réseau et config.js.");
        console.error(e);
      });
  }

  function stopListeners() { unsub.forEach(function (f) { try { f(); } catch (e) {} }); unsub = []; }
  function listenObs() {
    unsub.push(db.collection("observations").orderBy("date", "desc").onSnapshot(function (snap) {
      state.obs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render();
    }, function (e) { console.error(e); toast("Lecture des observations refusée."); }));
  }
  function onAuth(user) {
    stopListeners();
    state.user = user; state.loading = false; state.obs = []; state.subs = [];
    if (!user) { state.role = "guest"; render(); return; }
    var owner = (CFG.ownerEmail || "").trim().toLowerCase();
    if (owner && (user.email || "").toLowerCase() === owner) {
      state.role = "owner";
      listenObs();
      unsub.push(db.collection("subscribers").onSnapshot(function (snap) {
        state.subs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        render();
      }, function (e) { console.error(e); }));
    } else {
      state.role = "pending";
      var obsOn = false;
      unsub.push(db.collection("subscribers").doc(user.uid).onSnapshot(function (d) {
        var ok = d.exists && d.data().approved === true;
        state.me = d.exists ? d.data() : null;
        state.role = ok ? "subscriber" : "pending";
        if (ok && !obsOn) { obsOn = true; listenObs(); }
        if (!ok) state.obs = [];
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
  var VIEWS = ["observations", "carte", "glossaire", "abonnes"];
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

  function filteredObs() {
    var q = norm(state.q);
    if (!q) return state.obs;
    return state.obs.filter(function (o) { return norm([o.species, o.sci, o.place, o.notes].join(" ")).indexOf(q) >= 0; });
  }
  function obsListHTML() {
    var list = filteredObs();
    if (!state.obs.length) {
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
        (sp && sp.sensible ? ' <span class="pill warn">Espèce sensible</span>' : "") +
        '</span></span></button>';
    }).join("");
  }
  function viewObservations() {
    var g = gateHTML(); if (g) return g;
    var nSp = {}; state.obs.forEach(function (o) { nSp[norm(o.species)] = 1; });
    return '<div class="row between"><h2>' + state.obs.length + " observation" + (state.obs.length > 1 ? "s" : "") +
      " · " + Object.keys(nSp).length + " espèce" + (Object.keys(nSp).length > 1 ? "s" : "") + '</h2></div>' +
      '<input id="q" type="search" placeholder="Chercher une espèce, un lieu…" aria-label="Chercher dans les observations" value="' + esc(state.q) + '">' +
      '<div id="obs-list" style="display:flex;flex-direction:column;gap:10px">' + obsListHTML() + '</div>' +
      (isOwner() ? '<button class="btn primary fab" data-act="new">+ Observation</button>' : "");
  }

  function viewCarte() {
    var g = gateHTML(); if (g) return g;
    var n = state.obs.filter(hasCoords).length;
    return '<p class="meta">' + n + " observation" + (n > 1 ? "s" : "") + ' localisée' + (n > 1 ? "s" : "") + '. Touchez un point pour le détail.</p>' +
      '<div id="map-all" class="map big"></div>';
  }

  function glossListHTML() {
    var q = norm(state.gq), counts = {};
    state.obs.forEach(function (o) { var k = (o.species || "").toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    var list = SPECIES.filter(function (s) {
      if (state.ggroup !== "tous" && s.group !== state.ggroup) return false;
      return !q || norm(s.name + " " + s.sci + " " + s.cat + " " + s.habitat).indexOf(q) >= 0;
    });
    if (!list.length) return '<p class="empty">Aucune espèce ne correspond. L\'observation d\'une espèce absente du glossaire reste possible en saisie libre.</p>';
    var out = "", cat = "";
    list.forEach(function (s) {
      if (s.cat !== cat) { cat = s.cat; out += '<p class="cat">' + esc(cat) + '</p>'; }
      var c = counts[s.name.toLowerCase()] || 0;
      out += '<article class="card"><div class="row between"><h3>' + esc(s.name) + '</h3>' +
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
      ' mammifères parmi les plus observables au Luxembourg, en Lorraine, Wallonie, Sarre et Rhénanie-Palatinat.</p>' +
      '<input id="gq" type="search" placeholder="Chercher un nom, un milieu…" aria-label="Chercher dans le glossaire" value="' + esc(state.gq) + '">' +
      '<div class="chips">' + chip("tous", "Tous") + chip("oiseaux", "Oiseaux") + chip("mammiferes", "Mammifères") + '</div>' +
      '<div id="gloss-list" style="display:flex;flex-direction:column;gap:10px">' + glossListHTML() + '</div>';
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
      h += '<p class="notice">Mode local : vos données restent sur cet appareil et le partage passe par e-mail ou messagerie. ' +
        'Pour que les abonnés suivent votre fil dans l\'application, activez le mode en ligne (voir LISEZMOI).</p>';
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
    h += '<div class="row between"><h2>' + active.length + " abonné" + (active.length > 1 ? "s" : "") + '</h2>' +
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
    h += '<div class="card"><h2>Sauvegarde</h2><p class="meta">Exportez vos observations et abonnés dans un fichier, ou restaurez une sauvegarde.</p>' +
      '<div class="row"><button class="btn small" data-act="export">Exporter (.json)</button>' +
      '<label class="btn small" for="import-file" style="flex-direction:row;color:var(--ink)">Importer<input id="import-file" type="file" accept="application/json,.json" hidden></label></div></div>';
    if (CLOUD) h += '<div class="card"><p class="meta">Connecté : ' + esc(state.user.email) + '</p><div><button class="btn small" data-act="signout">Se déconnecter</button></div></div>';
    return h;
  }

  function render() {
    var v = route();
    document.querySelectorAll("nav.tabs a").forEach(function (a) {
      if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("tab-abonnes").textContent = isOwner() ? "Abonnés" : "Compte";
    $("app-title").textContent = CFG.titre || "Carnet d'affût";
    $("app-status").textContent = !CLOUD ? "Mode local" : isOwner() ? "Auteur" : state.role === "subscriber" ? "Abonné" : "";
    killMap("all");
    $("main").innerHTML = { observations: viewObservations, carte: viewCarte, glossaire: viewGlossaire, abonnes: viewAbonnes }[v]();
    if (v === "carte" && $("map-all")) drawAllMap();
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
  function drawAllMap() {
    var m = makeMap("all", $("map-all"), CENTER, 8); if (!m) return;
    var pts = [];
    state.obs.filter(hasCoords).forEach(function (o) {
      var sp = BY_NAME[(o.species || "").toLowerCase()];
      var mk = dot([o.lat, o.lng], sp && sp.sensible).addTo(m);
      mk.bindTooltip(o.species);
      mk.on("click", function () { openDetail(o.id); });
      pts.push([o.lat, o.lng]);
    });
    if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  }

  /* ---------- détail ---------- */
  function openDetail(id) {
    var o = state.obs.filter(function (x) { return x.id === id; })[0]; if (!o) return;
    var sp = BY_NAME[(o.species || "").toLowerCase()];
    var d = $("dlg-detail");
    d.innerHTML = '<div class="dlg">' +
      '<div><h2>' + esc(o.species) + (o.count > 1 ? " × " + esc(o.count) : "") + '</h2>' + (o.sci ? '<em class="sci">' + esc(o.sci) + '</em>' : "") + '</div>' +
      '<p>' + esc(fmtDate(o.date)) + '</p>' +
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
      '<div class="row">' +
      (isOwner() ? '<button class="btn small" data-act="edit" data-id="' + esc(o.id) + '">Modifier</button>' +
        '<button class="btn small danger" data-act="del" data-id="' + esc(o.id) + '">Supprimer</button>' : "") +
      '<button class="btn small" data-act="close-detail">Fermer</button></div></div>';
    if (!d.open) d.showModal();
    if (hasCoords(o) && $("map-detail")) {
      var m = makeMap("detail", $("map-detail"), [o.lat, o.lng], 14);
      if (m) dot([o.lat, o.lng], sp && sp.sensible).addTo(m);
    }
  }

  /* ---------- formulaire ---------- */
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
      '<label for="f-photo">Photo (facultative, réduite automatiquement)<input id="f-photo" type="file" accept="image/*"></label>' +
      '<div id="f-preview">' + (f.photo ? '<img class="photo" alt="Aperçu" src="' + esc(f.photo) + '">' : "") + '</div>' +
      '<label for="f-notes">Notes<textarea id="f-notes" rows="3" placeholder="Comportement, lumière, matériel…">' + esc(f.notes) + '</textarea></label>' +
      '<div class="row"><button class="btn primary" type="submit">Enregistrer</button>' +
      '<button class="btn" type="button" data-act="close-form">Annuler</button></div></form></div>';
    if ($("dlg-detail").open) $("dlg-detail").close();
    d.showModal();
    var start = hasCoords(f) ? [f.lat, f.lng] : (state.obs.filter(hasCoords)[0] ? [state.obs.filter(hasCoords)[0].lat, state.obs.filter(hasCoords)[0].lng] : CENTER);
    var m = makeMap("form", $("map-form"), start, hasCoords(f) ? 14 : (start === CENTER ? 8 : 11));
    if (m) {
      if (hasCoords(f)) setFormPoint(f.lat, f.lng, false);
      m.on("click", function (e) { setFormPoint(e.latlng.lat, e.latlng.lng, false); });
    }
  }
  function coordsLabel(f) { return hasCoords(f) ? f.lat.toFixed(5) + ", " + f.lng.toFixed(5) : "Position non définie"; }
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
        var max = 900, r = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("image")); };
      img.src = url;
    });
  }

  /* ---------- actions ---------- */
  function findObs(id) { return state.obs.filter(function (x) { return x.id === id; })[0]; }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var act = el.dataset.act, id = el.dataset.id, o;
    if (act === "new") { openForm(null, el.dataset.species || ""); }
    else if (act === "open") { openDetail(id); }
    else if (act === "close-detail") { $("dlg-detail").close(); killMap("detail"); }
    else if (act === "close-form") { $("dlg-form").close(); killMap("form"); }
    else if (act === "edit") { openForm(findObs(id)); }
    else if (act === "del") {
      if (confirm("Supprimer définitivement cette observation ?")) {
        store.deleteObs(id).then(function () { $("dlg-detail").close(); toast("Observation supprimée."); render(); })
          .catch(function () { toast("Suppression impossible."); });
      }
    }
    else if (act === "share") {
      o = findObs(id); if (!o) return;
      var text = obsText(o);
      if (navigator.share) {
        navigator.share({ title: o.species, text: text }).catch(function () {});
      } else { copy(text, "Texte copié : collez-le dans votre messagerie."); }
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
    if (e.target.id === "f-photo" && e.target.files[0]) {
      resizePhoto(e.target.files[0]).then(function (data) {
        state.form.photo = data;
        $("f-preview").innerHTML = '<img class="photo" alt="Aperçu" src="' + data + '">';
      }, function () { toast("Image illisible. Essayez un fichier JPEG ou PNG."); });
    } else if (e.target.id === "import-file" && e.target.files[0]) {
      importData(e.target.files[0]);
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
      if (!o.createdAt) o.createdAt = Date.now();
      store.saveObs(o).then(function () {
        $("dlg-form").close(); killMap("form"); toast("Observation enregistrée."); render();
      }).catch(function (err) { console.error(err); toast("Enregistrement impossible. Vérifiez la connexion."); });
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
    var blob = new Blob([JSON.stringify({ app: "carnet-affut", version: 1, exportedAt: new Date().toISOString(), observations: state.obs, abonnes: state.subs }, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "carnet-affut-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function importData(file) {
    file.text().then(function (t) {
      var data = JSON.parse(t), obs = data.observations || [], subs = data.abonnes || [];
      var haveO = {}, haveS = {};
      state.obs.forEach(function (o) { haveO[o.id] = 1; });
      state.subs.forEach(function (s) { haveS[(s.email || "").toLowerCase()] = 1; });
      var jobs = [];
      obs.forEach(function (o) { if (o && o.species && !haveO[o.id]) jobs.push(importObs(o)); });
      subs.forEach(function (s) {
        if (s && s.email && !haveS[s.email.toLowerCase()] && !s.account)
          jobs.push(store.addSub({ name: s.name || "", email: s.email, approved: true, account: false, createdAt: s.createdAt || Date.now() }));
      });
      return Promise.all(jobs).then(function () { toast(jobs.length + " élément(s) importé(s)."); render(); });
    }).catch(function () { toast("Fichier de sauvegarde illisible."); });
  }
  function importObs(o) {
    if (CLOUD) return store.saveObs(o);
    state.obs.push(o); sortObs(); LS.set("carnet.obs", state.obs); return Promise.resolve();
  }

  /* ---------- démarrage ---------- */
  window.addEventListener("hashchange", render);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  if (CLOUD) { render(); initCloud(); }
  else {
    state.obs = LS.get("carnet.obs", []); state.subs = LS.get("carnet.subs", []);
    sortObs(); render();
  }
})();
