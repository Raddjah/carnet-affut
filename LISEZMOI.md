# Carnet d'affût

Application web installable sur Android pour noter vos observations (espèce, date, position GPS, photo) et les partager avec vos abonnés. Elle contient un glossaire de 73 oiseaux et 36 mammifères de la Grande Région.

## 1. Mettre en ligne (obligatoire)

Le GPS et l'installation exigent une adresse en HTTPS. Déposez le contenu de ce dossier sur un hébergement statique gratuit :

- **GitHub Pages** : nouveau dépôt, envoyez les fichiers, puis Settings → Pages → branche `main`.
- **Netlify** : glissez le dossier sur app.netlify.com/drop.

## 2. Installer sur Android

Ouvrez l'adresse dans Chrome, puis menu ⋮ → « Ajouter à l'écran d'accueil » (ou « Installer l'application »).

## 3. Choisir son mode (onglet Réglages)

Dans les deux modes, vos observations sont enregistrées sur l'appareil.

**Mode local.** Rien à configurer. Vous gérez votre liste d'abonnés dans l'onglet Abonnés et envoyez chaque observation par e-mail (copie cachée à tous) ou par le bouton Partager (WhatsApp, Signal, SMS…).

**Mode en ligne.** Un fil commun. Vos abonnés ouvrent la même adresse, créent un compte, et vous validez leur demande. Un abonné accepté lit le fil et peut y publier ses propres observations ; il garde aussi son carnet sur son appareil. Chacun décide de ce qu'il publie :

- **Tout synchroniser** : chaque observation, existante ou nouvelle, est publiée automatiquement.
- **Choisir observation par observation** : cochez dans Réglages ce qui doit être en ligne, ou utilisez le bouton « Publier dans le fil en ligne » dans le détail d'une observation. Une pastille « En ligne » ou « Local » indique l'état de chacune.

Chacun ne modifie et ne retire que ses propres observations. Vous seul, en tant qu'auteur du carnet, pouvez retirer du fil celle d'un abonné.

**Espèces sensibles.** En mode en ligne, la position GPS d'une espèce sensible au dérangement n'est jamais publiée : elle reste sur l'appareil de l'observateur. Le nom du lieu, lui, est publié : choisissez-le assez large (une vallée, une commune) pour ne pas désigner l'emplacement précis. Cela vaut pour les espèces marquées sensibles dans le glossaire et pour toute observation où la case « Espèce sensible » est cochée. Le texte envoyé par e-mail ou par le bouton Partager omet aussi la position. Les observations sensibles déjà publiées sont mises en conformité à la prochaine connexion de leur auteur. Ce masquage est fait par l'application elle-même.

Le mode en ligne demande un projet Firebase gratuit :

1. Sur console.firebase.google.com, créez un projet, puis ajoutez une application Web.
2. Authentication → Sign-in method → activez « Adresse e-mail/Mot de passe ».
3. Firestore Database → créez la base (mode production, région `eur3`).
4. Firestore → Règles : collez le contenu de `firestore.rules` après avoir remplacé `VOTRE_EMAIL`.
5. Dans `config.js`, renseignez `auteur`, `ownerEmail` et le bloc `firebase` (apiKey, authDomain, projectId, appId) fourni par la console.
6. Remettez en ligne, ouvrez l'application et **créez votre compte en premier** avec l'adresse `ownerEmail`.

Tant que `config.js` n'est pas renseigné, le choix « Mode en ligne » reste grisé.

## 4. Mettre à jour depuis la version 1

1. Avant tout, exportez une sauvegarde depuis l'ancienne version (onglet Abonnés → Exporter).
2. Remplacez `index.html`, `app.js`, `sw.js` et `LISEZMOI.md`. Gardez votre `config.js` si vous l'avez modifié.
3. Si vous utilisez le mode en ligne : republiez `firestore.rules` dans la console Firebase (Firestore → Règles), après y avoir remis votre adresse à la place de `VOTRE_EMAIL`. Sans cela, vos abonnés ne peuvent pas publier.
4. Rouvrez l'application avec du réseau, deux fois si besoin. Vos observations sont reprises automatiquement.

## Bon à savoir

- Photo d'une observation : « Prendre une photo » ouvre l'appareil photo du téléphone, « Choisir un fichier ou dans la galerie » ouvre vos images. Elle est réduite à 1280 px ; vos originaux ne sont pas modifiés.
- Photos du glossaire : elles viennent de Wikimedia Commons (image principale de l'article Wikipédia de l'espèce), avec auteur et licence affichés dessous. Elles se chargent à la première ouverture du glossaire avec du réseau, puis restent disponibles hors ligne.
- Les espèces marquées « sensibles » (cigogne noire, grand-duc, chat forestier, lynx…) affichent un rappel de ne pas rediffuser la position exacte.
- Le fond de carte est OpenStreetMap et nécessite une connexion ; le reste fonctionne hors ligne.
- Pour ajouter une espèce au glossaire, ajoutez une ligne dans `glossaire.js`.
