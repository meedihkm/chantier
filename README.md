# Carnet de chantier v2 – multi-utilisateur, avec photos

Chaque personne crée son compte et a son propre carnet (notes, heures de sortie, heures sup., photos).
Application installable sur Android (PWA), utilisable sans réseau : tout est envoyé dès que la connexion revient.

Pile : Node.js 22 + PostgreSQL (une seule dépendance : `pg`). Photos stockées sur disque (volume /data).

## Déploiement Coolify (le plus simple : Docker Compose)
1. Poussez ce dossier dans un dépôt GitHub (sans node_modules).
2. Coolify → New Resource → Application → votre dépôt → Build Pack **Docker Compose**.
3. Sur le service **app** : port 3541 et votre domaine en HTTPS (ex. https://carnet.votredomaine.com).
4. Variables d’environnement :
   - `POSTGRES_PASSWORD` : un mot de passe long
   - `SIGNUP_CODE` : code à donner à vos collègues pour créer leur compte (laissez vide pour des inscriptions ouvertes à tous, déconseillé)
5. Deploy. Les tables se créent toutes seules au premier démarrage.

### Variante : PostgreSQL déjà présent sur le VPS
Build Pack **Dockerfile**, port 3541, volume persistant sur `/data`, et les variables
`DATABASE_URL=postgres://utilisateur:motdepasse@hote:5432/base`, `SIGNUP_CODE`.

Autres variables : `USER_QUOTA_MB` (espace photos par personne, 2000 par défaut).

## Installation sur Android
Ouvrez l’adresse dans Chrome, créez votre compte, puis menu ⋮ → « Installer l’application ».

## Sauvegardes
- Base : `pg_dump` du service db (ou la sauvegarde planifiée de Coolify).
- Photos : le volume `photos` (/data/photos).

## Évolutions possibles
- Plusieurs instances : déplacer les photos vers un stockage S3 (MinIO sur le VPS) et partager la limitation des tentatives de connexion.
- Changement de mot de passe, suppression de compte, vue « responsable » pour le comptable.
