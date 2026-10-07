# TaskHub

Application de gestion de projets et de tâches en équipe. **Next.js / TypeScript** pour l’interface, **FastAPI / SQLAlchemy** pour l’API, **PostgreSQL** en Docker et **SQLite** pour démarrer sans Docker.

## Fonctionnalités de la V1

- Création de compte et connexion, mots de passe hachés avec Argon2, JWT de 8 heures.
- Espaces de travail et projets ; trois colonnes : À faire, En cours, Terminé.
- Création, modification, suppression et déplacement des tâches par glisser-déposer ou menu accessible au clavier.
- Description, priorité, échéance et assignation à un membre.
- Recherche dans les titres et descriptions ; filtre par priorité.
- Compteurs : tâches, tâches terminées, échéances dépassées et progression.
- Ajout d’un utilisateur déjà inscrit à un espace, réservé à son propriétaire.
- Contrôle des accès : un compte ne peut lire ou modifier que les projets de ses espaces. La suppression d’un projet est réservée au propriétaire de l’espace.
- Interface française responsive, états vides, erreurs et confirmations de suppression.

## Aperçu

![Tableau Kanban TaskHub](docs/taskhub-desktop.png)

[Capture mobile](docs/taskhub-mobile.png)

## Lancer sur Windows — sans Docker

Prérequis : Python 3.12+ et Node.js 22+. Ouvrir deux terminaux PowerShell.

### Terminal 1 — API

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copier la valeur générée dans `JWT_SECRET` dans `backend/.env`. Conserver `DATABASE_URL=sqlite:///./taskhub.db` pour le lancement simple.

```powershell
alembic upgrade head
uvicorn main:app --reload --port 8000
```

Si PowerShell bloque l’activation, utiliser directement `.\.venv\Scripts\python.exe -m pip ...`, `.\.venv\Scripts\alembic.exe ...` et `.\.venv\Scripts\uvicorn.exe ...`.

### Terminal 2 — interface

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Ouvrir **http://localhost:3000** et créer un compte. Documentation interactive de l’API : **http://localhost:8000/docs**.

Sur macOS/Linux, remplacer l’activation par `source .venv/bin/activate` et `Copy-Item` par `cp`.

## Lancer avec Docker / PostgreSQL

À la racine du projet : copier `.env.example` en `.env`, remplacer `JWT_SECRET` par une valeur aléatoire, puis :

```sh
docker compose up --build
```

Interface sur `localhost:3000`, API sur `localhost:8000`, PostgreSQL accessible depuis l’ordinateur sur le port `5434`. Les migrations sont appliquées au démarrage de l’API. Les données restent dans le volume Docker. Le mot de passe `taskhub_dev` est destiné au développement local.

Pour utiliser uniquement PostgreSQL avec l’API locale : `docker compose up -d db`, puis définir `DATABASE_URL=postgresql+psycopg://taskhub:taskhub_dev@localhost:5434/taskhub` dans `backend/.env` et lancer les migrations.

## Tester

Depuis `backend`, avec l’environnement Python activé :

```sh
pytest -q
```

Les tests utilisent une base SQLite isolée, jamais les données de développement. Ils couvrent l’authentification, les tâches, les projets, les règles d’accès, les assignations et la validation.

Depuis `frontend` :

```sh
npm run lint
npx tsc --noEmit
npm run build
```

GitHub Actions exécute ces contrôles et vérifie les migrations sur PostgreSQL.

## Structure

```text
backend/
  main.py        Routes API et contrôles d’appartenance
  security.py    Argon2 et JWT
  schemas.py     Validation des entrées et sorties
  models.py      Modèles SQLAlchemy existants
  database.py    Connexions et sessions
  migrations/    Schéma Alembic
  tests/         Tests d’intégration
frontend/
  app/           Interface Next.js et styles
  lib/api.ts     Client API typé
.github/workflows/ci.yml
```

## Déploiement

1. Créer une base PostgreSQL et déployer `backend` sur un hébergeur Python, avec `pip install -r requirements.txt` comme commande de build.
2. Définir `DATABASE_URL`, un `JWT_SECRET` aléatoire et `CORS_ORIGINS` avec l’URL exacte de l’interface.
3. Appliquer `alembic upgrade head`, puis lancer `uvicorn main:app --host 0.0.0.0 --port $PORT` (port fourni par l’hébergeur).
4. Déployer `frontend` avec la racine de projet `frontend`, commande de build `npm run build`. Définir `NEXT_PUBLIC_API_URL` avec l’URL HTTPS de l’API **avant le build**.
5. Créer un compte de démonstration sans données privées et tester le parcours complet après déploiement.

Le projet n’est pas automatiquement publié : aucune URL de production n’est configurée dans ce ZIP.

## Choix et limites

La V1 utilise le schéma fourni au départ. Les colonnes sont fixes. La recherche et les compteurs se font côté API ; le tableau charge toutes les tâches d’un projet, adapté à une démonstration ou une petite équipe. Les membres peuvent modifier les projets et tâches de leur espace. L’ajout de membre est direct et nécessite un compte existant : aucun e-mail d’invitation n’est envoyé.

Le jeton est conservé dans `sessionStorage` (session de l’onglet) et expire après 8 heures. La déconnexion le retire du navigateur sans révocation côté serveur. Avant une ouverture large au public, ajouter une limitation des tentatives de connexion, récupération de mot de passe, vérification d’e-mail et gestion complète des membres. Les notifications, pièces jointes, colonnes personnalisées, réordonnancement des cartes et mises à jour temps réel sont hors de cette V1.

## Présentation en entretien

« J’ai construit une application de gestion de projets avec un tableau Kanban. L’API vérifie l’appartenance à un espace avant chaque accès à un projet ou une tâche, et empêche les assignations ou déplacements vers un autre espace. Le frontend TypeScript gère les formulaires, les états d’erreur et le déplacement des tâches. Des tests d’intégration vérifient notamment qu’un deuxième compte ne peut pas consulter ou modifier les données du premier. »

Relire et expliquer le code, puis personnaliser cette description selon les parties réalisées et comprises.
