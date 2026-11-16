/* Configuration du Carnet d'affût.
   Tant que "firebase" est vide, l'application fonctionne en MODE LOCAL :
   tout est enregistré sur cet appareil et le partage se fait par e-mail ou messagerie.
   Pour activer les comptes abonnés et le fil partagé, suivez LISEZMOI.md. */
window.CARNET_CONFIG = {
  titre: "Carnet d'affût",
  auteur: "",                 // votre nom, affiché aux abonnés
  ownerEmail: "",             // l'e-mail de VOTRE compte (seul autorisé à publier)
  firebase: {
    // apiKey: "...",
    // authDomain: "...",
    // projectId: "...",
    // appId: "..."
  }
};
