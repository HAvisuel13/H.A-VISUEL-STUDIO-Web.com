# H.A VISUEL STUDIO — version professionnelle corrigée

Cette version conserve l'interface publique et le fonctionnement du projet tout en renforçant la sécurité, l'administration et la maintenabilité.

## Corrections principales

- authentification administrateur avec `scrypt` et sessions serveur ;
- protection CSRF pour les opérations d'administration ;
- cookie de session renforcé en production avec le préfixe `__Host-` ;
- validation de l'origine des requêtes d'administration ;
- limitation spécifique des demandes publiques ;
- validation du contenu réel des fichiers uploadés par signatures/magic bytes ;
- validation serveur du consentement du formulaire ;
- le nom du service est désormais résolu côté serveur à partir de son identifiant ;
- séparation stricte entre médias publics et pièces jointes privées ;
- suppression complète du portfolio réellement fonctionnelle avec double confirmation ;
- restauration JSON réellement fonctionnelle pour les services, avis et réglages ;
- conservation des demandes et médias lors d'une restauration JSON ;
- réponses d'administration marquées `no-store` ;
- réutilisation du transport SMTP ;
- indicateurs de focus clavier plus visibles ;
- état ARIA du menu mobile ;
- messages du formulaire et notifications annoncés aux technologies d'assistance ;
- favicon, Open Graph, Twitter Card, canonical, `robots.txt` et `sitemap.xml` ajoutés ;
- contraste des textes secondaires amélioré.

## Installation

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
```

Copiez `.env.example` vers `.env` puis changez au minimum :

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=un_mot_de_passe_long_et_unique
```

Ne partagez jamais le fichier `.env`.

## Lancer le site

```bash
npm start
```

Puis ouvrez :

`http://localhost:3000`

## Administration

La section « Administration » utilise le serveur. Le mot de passe n'est jamais écrit dans le JavaScript public.

Pour changer le mot de passe après connexion :

Administration → Réglages → Changer le mot de passe.

Après connexion, les requêtes d'administration utilisent un jeton CSRF lié à la session.

## Données et fichiers

La base SQLite est dans :

`data/ha_visuel_studio.sqlite`

Les médias publics sont dans :

`uploads/portfolio/`

Les pièces jointes privées des demandes sont dans :

`uploads/requests/`

Les pièces jointes privées ne sont pas servies par une URL publique directe : elles passent par une route nécessitant une authentification administrateur.

## Sauvegarde

L'export JSON contient les données textuelles : services, demandes, avis et réglages.

L'import JSON restaure les **services, avis et réglages**. Les demandes et les médias ne sont pas remplacés par l'import afin d'éviter une suppression accidentelle des données métier et des fichiers.

Pour une sauvegarde complète, sauvegardez également :

- `data/`
- `uploads/`

## Email

Pour recevoir automatiquement une notification lorsqu'un projet est envoyé, renseignez les variables SMTP dans `.env`.

## Déploiement

Utilisez HTTPS et configurez `COOKIE_SECURE=true` derrière votre reverse proxy.

En production, `NODE_ENV=production` active également le cookie de session `__Host-ha_session`, qui nécessite HTTPS.

Si l'application est placée derrière un reverse proxy, configurez `trust proxy` en fonction de votre architecture réelle.

## WhatsApp

La demande est enregistrée côté serveur avant l'ouverture de WhatsApp. Le message WhatsApp est préparé côté navigateur afin que le client puisse le relire et l'envoyer.

Les fichiers de projet sont conservés sur le serveur ; ils ne sont pas envoyés automatiquement comme pièce jointe dans WhatsApp.

## SEO

Les fichiers `robots.txt` et `sitemap.xml` utilisent actuellement le domaine `https://havisuelstudio.com/`. Si le domaine de production est différent, adaptez ces fichiers ainsi que les balises canonical/Open Graph de `public/index.html`.
