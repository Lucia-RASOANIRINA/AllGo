/**
 * Point d'entrée pour Phusion Passenger (cPanel « Setup Node.js App »).
 *
 * Passenger attend un fichier de démarrage à la racine de l'application,
 * conventionnellement nommé `app.js` — pointer directement sur
 * `dist/main.js` dans l'interface cPanel fonctionne aussi (même contenu),
 * ce fichier n'est qu'un raccourci qui évite de saisir un chemin dans
 * `dist/`. Nécessite `npm run build` au préalable (§ guide de déploiement,
 * README).
 */
require('./dist/main.js');
