# Carnet de chantier v2 – multi-utilisateur, avec photos

Déploiement Coolify : New Resource → Public Repository → URL du dépôt → branche main →
Build Pack Docker Compose → Deploy. Aucun secret dans le dépôt : Coolify génère lui-même
le mot de passe de la base (SERVICE_PASSWORD_POSTGRES) et le code d’inscription (SERVICE_PASSWORD_SIGNUP),
visibles dans Environment Variables de l’application (modifiables).

Sauvegardes : base (sauvegarde Coolify ou pg_dump) et volume photos (/data/photos).
