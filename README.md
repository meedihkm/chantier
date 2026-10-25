# Carnet de chantier v2 – multi-utilisateur, avec photos

Chaque personne crée son compte et a son propre carnet (notes, heures de sortie, heures sup., photos).
Application installable sur Android (PWA), utilisable sans réseau.

## Déploiement Coolify
1. Poussez ce dossier dans un dépôt GitHub **privé** (le mot de passe de la base et le code d’inscription sont dans docker-compose.yml).
2. Coolify → New Resource → Application → votre dépôt → Build Pack **Docker Compose** → Continue → Deploy.
Rien d’autre à configurer. Coolify attribue une adresse automatiquement (champ Domains du service app, port 3541) ; vous pouvez la remplacer par votre domaine en https://…

Code d’inscription : voir la variable SIGNUP_CODE dans docker-compose.yml (modifiable dans Coolify).

## Sauvegardes
- Base : sauvegarde planifiée de Coolify ou pg_dump du service db.
- Photos : volume `photos` (/data/photos).
