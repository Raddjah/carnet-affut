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

**Caméras autonomes.** Dans le formulaire d'une nouvelle observation, la bascule en haut permet de choisir « Caméra » : vous saisissez alors un nom de caméra, une date de pose et un emplacement. La caméra apparaît sur la carte avec une icône d'appareil photo (pastille prune) et porte la mention « Caméra » dans la liste. Un filtre « Tout / Observations / Caméras » s'affiche dès qu'une caméra existe.

L'emplacement d'une caméra n'est jamais publié dans le fil en ligne, quel que soit le réglage de synchronisation : il reste sur votre appareil. La fiche d'une caméra n'offre donc ni bouton de publication ni envoi groupé aux abonnés ; le bouton « Copier la fiche » reste disponible si vous voulez transmettre l'emplacement à quelqu'un de précis.

**J'aime.** Sur le fil en ligne, chacun peut marquer d'un j'aime les observations des autres membres : un bouton en forme de cœur figure sous chaque observation reçue, et la fiche détaillée indique qui l'a aimée. Vos propres observations affichent seulement le compteur. Les j'aime n'existent pas en mode local.

**Espèces sensibles.** En mode en ligne, la position GPS d'une espèce sensible au dérangement n'est jamais publiée : elle reste sur l'appareil de l'observateur. Le nom du lieu, lui, est publié : choisissez-le assez large (une vallée, une commune) pour ne pas désigner l'emplacement précis. Cela vaut pour les espèces marquées sensibles dans le glossaire et pour toute observation où la case « Espèce sensible » est cochée. Le texte envoyé par e-mail ou par le bouton Partager omet aussi la position. Les observations sensibles déjà publiées sont mises en conformité à la prochaine connexion de leur auteur. Ce masquage est fait par l'application elle-même.

Le mode en ligne demande un projet Firebase gratuit :

1. Sur console.firebase.google.com, créez un projet, puis ajoutez une application Web.
2. Authentication → Sign-in method → activez « Adresse e-mail/Mot de passe ».
3. Firestore Database → créez la base (mode production, région `eur3`).
4. Firestore → Règles : collez le contenu de `firestore.rules`, en vérifiant que l'adresse de la fonction `isOwner()` est bien la vôtre (en minuscules).
5. Dans `config.js`, renseignez `auteur`, `ownerEmail` et le bloc `firebase` (apiKey, authDomain, projectId, appId) fourni par la console.
6. Remettez en ligne, ouvrez l'application et **créez votre compte en premier** avec l'adresse `ownerEmail`.

Tant que `config.js` n'est pas renseigné, le choix « Mode en ligne » reste grisé.

## 4. Mettre à jour depuis la version 1

1. Avant tout, exportez une sauvegarde depuis l'ancienne version (onglet Abonnés → Exporter).
2. Remplacez `index.html`, `app.js`, `i18n.js`, `sw.js`, `firestore.rules` et `LISEZMOI.md`, et ajoutez `icon-180.png`. Gardez votre `config.js` si vous l'avez modifié.
3. Si vous utilisez le mode en ligne : republiez `firestore.rules` dans la console Firebase (Firestore → Règles), en vérifiant l'adresse de `isOwner()`. Sans cela, vos abonnés ne peuvent ni publier ni aimer.
4. Rouvrez l'application avec du réseau, deux fois si besoin. Vos observations sont reprises automatiquement.

## Bon à savoir

- Photo d'une observation : « Prendre une photo » ouvre l'appareil photo du téléphone, « Choisir un fichier ou dans la galerie » ouvre vos images. Elle est réduite à 1280 px ; vos originaux ne sont pas modifiés.
- Photos du glossaire : elles viennent de Wikimedia Commons (image principale de l'article Wikipédia de l'espèce), avec auteur et licence affichés dessous. Elles se chargent à la première ouverture du glossaire avec du réseau, puis restent disponibles hors ligne.
- Les espèces marquées « sensibles » (cigogne noire, grand-duc, chat forestier, lynx…) affichent un rappel de ne pas rediffuser la position exacte.
- Le fond de carte est OpenStreetMap et nécessite une connexion ; le reste fonctionne hors ligne.
- Hors connexion en mode en ligne : si vous vous êtes déjà connecté une fois sur l'appareil, votre carnet s'ouvre quand même. Vos nouvelles observations restent sur l'appareil et la mention « hors connexion » s'affiche en haut. Avec « Tout synchroniser », elles partent au retour du réseau.
- Espèces sensibles : la position GPS est retirée du texte partagé (e-mail, Partager, Copier) dans les deux modes. Elle reste visible pour vous dans la fiche.
- Pour ajouter une espèce au glossaire, ajoutez une ligne dans `glossaire.js`.
