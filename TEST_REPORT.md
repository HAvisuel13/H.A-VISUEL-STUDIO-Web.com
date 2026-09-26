# H.A VISUEL STUDIO — V3.0.1 — Rapport de validation

Date de validation : 26 septembre 2026

## Résultats

| Contrôle | Résultat |
|---|---|
| Décompression du projet | PASS |
| `package.json` | PASS |
| Node.js disponible | PASS — v22.16.0 |
| npm disponible | PASS — v10.9.2 |
| Syntaxe `server.js` | PASS |
| Syntaxe `public/app.js` | PASS |
| Références DOM utilisées par `app.js` | PASS — aucune référence manquante détectée |
| Routes critiques présentes | PASS |
| Middleware CSRF admin | PASS |
| CSRF du logout | PASS |
| Validation serveur du consentement | PASS |
| Résolution serveur du service | PASS |
| Validation par signature des uploads | PASS — inspection statique |
| Suppression globale du portfolio | PASS — route + interface présentes |
| Import JSON | PASS — route + interface présentes |
| Fichiers statiques via serveur HTTP simple | PASS — `/`, `index.html`, `app.js`, `robots.txt`, `sitemap.xml`, `logo.png` répondent 200 |
| Installation npm complète | NON EXÉCUTÉE À TERME — réseau indisponible dans l'environnement |
| Démarrage réel Express/SQLite | NON VALIDÉ — dépendances npm indisponibles |
| Tests HTTP Express de bout en bout | NON VALIDÉ — même blocage de dépendances |

## Blocage externe

L'installation npm a échoué parce que l'environnement ne peut pas résoudre `registry.npmjs.org` (`EAI_AGAIN`). Les paquets ne sont pas présents localement. Il est donc impossible de prétendre qu'un démarrage réel avec Express, better-sqlite3, Multer, Helmet et Nodemailer a été exécuté ici.

Commande utilisée pour le diagnostic :

```text
npm install --no-audit --no-fund --ignore-scripts --fetch-timeout 10000 --fetch-retries 0
```

## Corrections finales incluses

- CSRF sur toutes les opérations d'administration, y compris la déconnexion.
- Cookie de session renforcé en production avec préfixe `__Host-`.
- `TRUST_PROXY` configurable via `.env`.
- Validation du contenu réel des uploads par signatures de fichiers.
- Détection DOCX basée sur le conteneur ZIP et rejet des conteneurs contenant `vbaProject.bin`.
- Consentement obligatoire contrôlé côté serveur.
- Service actif résolu côté serveur à partir de `serviceId`.
- Limite spécifique des demandes publiques.
- Suppression globale du portfolio fonctionnelle.
- Import de sauvegarde JSON fonctionnel et limité.
- SEO : favicon, canonical, Open Graph, Twitter Card, robots.txt et sitemap.xml.
- Accessibilité : focus visible et état ARIA du menu mobile.

## Pour une validation finale sur une machine avec Internet

```text
npm install
npm start
```

Puis tester notamment :

- `GET /api/public/bootstrap`
- `POST /api/auth/login`
- `GET /api/admin/me`
- requêtes admin avec et sans `X-CSRF-Token`
- `POST /api/requests` avec et sans consentement
- upload d'un fichier valide et d'un fichier dont le MIME est falsifié
- `POST /api/admin/portfolio`
- `DELETE /api/admin/portfolio`
- `GET /api/admin/backup.json`
- `POST /api/admin/backup/import`
- `POST /api/auth/logout`
