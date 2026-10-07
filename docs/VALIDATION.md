# Validation de la V1 — 6 octobre 2026

- 10 tests d’intégration API : réussis (authentification, CRUD, isolation entre comptes, permissions du propriétaire, cohérence des colonnes et assignations, validation, CORS).
- Migration Alembic appliquée sur une base SQLite vierge, puis `alembic check` : aucun écart détecté.
- `npm run lint` : réussi.
- Vérification TypeScript et `npm run build` : réussis.
- API réellement lancée sur la base migrée : inscription, projet, tâche, déplacement, lecture et suppression vérifiés.
- Frontend de production : réponse HTTP 200.
- Parcours Chromium automatisé : inscription, création d’un projet et de trois tâches, déplacement par menu, rechargement et persistance, recherche, filtre de priorité, modification du titre, déconnexion et reconnexion.
- Affichage à 1440 px et 390 px, sans débordement horizontal mobile. Captures dans ce dossier.
- Aucune erreur JavaScript de page relevée sur ce parcours.

## Limites de vérification

Docker et PostgreSQL n’ont pas été exécutés dans cet environnement. Leur configuration est fournie ; GitHub Actions prévoit un contrôle des migrations sur PostgreSQL. Le glisser-déposer natif n’a pas été automatisé ; le déplacement par menu a été vérifié. Le site n’est pas déployé publiquement. Les contrôles ne remplacent pas une revue de sécurité destinée à une mise en production ouverte.
