# Quantum Horaire — v2

Plateforme web de gestion du **quantum horaire** des enseignants des écoles élémentaires du Sénégal.
Chaque directeur dispose de son compte, saisit une fiche par mois, la retrouve dans son historique,
et génère le PDF ou l'impression officielle (drapeau, signature et date automatiques).

© SDF Technologie — Tous droits réservés.

## Fonctionnalités

- Comptes sécurisés (mot de passe haché bcrypt, session par cookie `HttpOnly` signé JWT)
- Une fiche par mois et par école, **enregistrée automatiquement en base de données**
- Création d'une nouvelle fiche en reprenant la liste des enseignants et l'heure due du mois précédent
- Calcul du temps réalisé fait **côté serveur** : `heure due − temps perdu + heures compensées + heures supp.`
- Export PDF et impression (mise en page d'origine conservée)
- Profil du directeur (pré-remplit IA, IEF, CODEC, école) et changement de mot de passe
- Espace **administration** en lecture seule (inspection) : toutes les fiches, filtre par mois, totaux
- Sécurité : Helmet (CSP), limitation des tentatives de connexion, protection CSRF, validation Zod, requêtes SQL paramétrées

## Architecture

| Couche | Technologie |
|---|---|
| Serveur / API | Node.js 18+, Express 4 |
| Base de données | SQLite (better-sqlite3, mode WAL) — un seul fichier |
| Front | HTML/CSS/JS natif (aucun build), html2canvas + jsPDF |
| Tests | `node:test` (6 scénarios API) |
| Déploiement | Docker, Render ou VPS |

```
src/            serveur (app, config, db, auth, routes/)
public/         interface (index.html, css/, js/)
scripts/        create-admin.js
test/           tests automatisés
```

## Démarrage en local

```bash
npm install
cp .env.example .env        # puis renseignez JWT_SECRET
npm run dev                 # http://localhost:3000
npm test
```

Générer un secret : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### Créer un compte administrateur (inspection)

```bash
npm run create-admin -- inspecteur@exemple.sn "MotDePasseSolide" "Nom Prénom"
```

Les directeurs créent eux-mêmes leur compte depuis la page d'inscription
(désactivable avec `ALLOW_REGISTRATION=false`).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `JWT_SECRET` | — | **Obligatoire en production** (32 caractères min.) |
| `PORT` | `3000` | Port d'écoute |
| `DATABASE_PATH` | `./data/quantum.db` | Fichier SQLite |
| `ALLOW_REGISTRATION` | `true` | Autoriser l'inscription publique |
| `JWT_DAYS` | `7` | Durée de session |
| `COOKIE_SECURE` | `true` en production | Cookie réservé au HTTPS (mettre `false` si pas encore de HTTPS) |

## Déploiement

### Docker (VPS)
```bash
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" > .env
docker compose up -d --build
docker compose exec app node scripts/create-admin.js admin@exemple.sn "MotDePasseSolide" "Admin"
```
Placez ensuite un reverse proxy HTTPS (Caddy ou Nginx) devant le port 3000, puis ajoutez `COOKIE_SECURE=true`.

### Render
Importez le dépôt GitHub, Render lit `render.yaml`. Le **disque persistant** est indispensable
pour conserver la base SQLite (offre payante). Sans disque, les données seraient perdues à chaque redéploiement.

### Sauvegarde
Copiez régulièrement le fichier `data/quantum.db` (arrêt non nécessaire grâce au mode WAL si vous utilisez
`sqlite3 data/quantum.db ".backup sauvegarde.db"`).

## API (résumé)

Toutes les requêtes d'écriture doivent envoyer l'en-tête `X-Requested-With: qh`.

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | Session |
| GET / PUT | `/api/auth/me` | Profil |
| PUT | `/api/auth/me/password` | Changer le mot de passe |
| GET / POST | `/api/fiches` | Lister / créer (`{mois:"2026-09", copier:true}`) |
| GET / PUT / DELETE | `/api/fiches/:id` | Lire / enregistrer / supprimer |
| GET | `/api/admin/fiches?mois=YYYY-MM` · `/api/admin/users` | Administration |
| GET | `/api/health` | Contrôle de santé |

## Évolutions possibles
Migration vers PostgreSQL (si plusieurs serveurs), export Excel pour l'inspection, rappel e-mail de fin de mois,
mot de passe oublié par e-mail.
