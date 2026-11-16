/* Configuration du Carnet d'affût.
   Tant que "firebase" est vide, l'application fonctionne en MODE LOCAL :
   tout est enregistré sur cet appareil et le partage se fait par e-mail ou messagerie.
   Pour activer les comptes abonnés et le fil partagé, suivez LISEZMOI.md. */
window.CARNET_CONFIG = {
  titre: "Carnet d'affût",
  auteur: "Eric S.",                 // votre nom, affiché aux abonnés
  ownerEmail: "eszturma@gmail.com",             // l'e-mail de VOTRE compte (seul autorisé à publier)
  firebase: {
    apiKey: "AIzaSyCmzvUlFdIiOKcrdmupXSzXD-SpGyk_wlI",
    authDomain: "carnet-affut.firebaseapp.com",
    projectId: "carnet-affut",
    appId: "1:39739146120:web:32203a34687f403eacc43d",
    measurementId: "G-676V255EH7"
  }
};
