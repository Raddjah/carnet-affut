# Carnet d'affût

Application web installable sur Android pour noter vos observations (espèce, date, position GPS, photo) et les partager avec vos abonnés. Elle contient un glossaire de 73 oiseaux et 36 mammifères de la Grande Région.

## 1. Mettre en ligne (obligatoire)

Le GPS et l'installation exigent une adresse en HTTPS. Déposez le contenu de ce dossier sur un hébergement statique gratuit :

- **GitHub Pages** : nouveau dépôt, envoyez les fichiers, puis Settings → Pages → branche `main`.
- **Netlify** : glissez le dossier sur app.netlify.com/drop.

## 2. Installer sur Android

Ouvrez l'adresse dans Chrome, puis menu ⋮ → « Ajouter à l'écran d'accueil » (ou « Installer l'application »).

## 3. Les deux modes

**Mode local (par défaut).** Rien à configurer. Les données restent sur votre téléphone. Vous gérez votre liste d'abonnés dans l'onglet Abonnés et envoyez chaque observation par e-mail (copie cachée à tous) ou par le bouton Partager (WhatsApp, Signal, SMS…). Pensez à exporter une sauvegarde de temps en temps.

**Mode en ligne (comptes abonnés).** Vos abonnés ouvrent la même adresse, créent un compte, et vous validez leur demande. Ils voient alors votre fil et la carte. Il faut un projet Firebase gratuit :

1. Sur console.firebase.google.com, créez un projet, puis ajoutez une application Web.
2. Authentication → Sign-in method → activez « Adresse e-mail/Mot de passe ».
3. Firestore Database → créez la base (mode production, région `eur3`).
4. Firestore → Règles : collez le contenu de `firestore.rules` après avoir remplacé `VOTRE_EMAIL`.
5. Dans `config.js`, renseignez `auteur`, `ownerEmail` et le bloc `firebase` (apiKey, authDomain, projectId, appId) fourni par la console.
6. Remettez en ligne, ouvrez l'application et **créez votre compte en premier** avec l'adresse `ownerEmail`.

En passant du mode local au mode en ligne, exportez vos données avant, puis importez-les après vous être connecté.

## Bon à savoir

- Les photos sont réduites à 900 px pour rester légères ; vos originaux ne sont pas modifiés.
- Les espèces marquées « sensibles » (cigogne noire, grand-duc, chat forestier, lynx…) affichent un rappel de ne pas rediffuser la position exacte.
- Le fond de carte est OpenStreetMap et nécessite une connexion ; le reste fonctionne hors ligne.
- Pour ajouter une espèce au glossaire, ajoutez une ligne dans `glossaire.js`.
