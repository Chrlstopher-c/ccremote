# Agent HQ

Vue du monde des agents (app Phaser, Vite + TypeScript). Deux sources de données : une démo embarquée (par défaut) ou le relais ccremote.

## Prérequis

- Bun (le lockfile est `hq/bun.lock` : `bun install --frozen-lockfile`, jamais npm ni pnpm).

## Lancer en local

**Démo** (aucun relais, données embarquées) :

```bash
cd hq
bun install --frozen-lockfile
bun run dev        # http://127.0.0.1:5190
```

**Contre un relais de développement** : le proxy Vite envoie `/api` (HTTP et WebSocket) vers `RELAIS_CIBLE`, et l'app lit le relais via `VITE_RELAIS_URL`.

```bash
cd hq
RELAIS_CIBLE=https://relais.example.com VITE_SOURCE=relais VITE_RELAIS_URL=https://relais.example.com bun run dev
```

Le jeton d'accès n'est jamais dans le code ni dans l'environnement : il se saisit dans l'app et reste dans le stockage local du navigateur (clé `agent-hq.jeton`). Sans jeton ou sans URL, l'app retombe sur la démo.

## Tests et build

```bash
cd hq
bun run typecheck     # tsc --noEmit
bun test src          # tests unitaires (données, transport, monde)
bun run build         # typecheck puis vite build → hq/dist, base /hq/
```

Le build est statique : `hq/dist` ne dépend d'aucun service à l'exécution.

## Où c'est servi

- En production, le relais sert `hq/dist` sous **`/hq/`**. Le dossier se règle par `CCREMOTE_HQ` (défaut : `hq/dist` à la racine du relais).
- `deploiement/deployer.sh relais` construit `hq/dist` ici puis le copie sur le Pi dans `/mnt/projects/ccremote-relais/hq/dist`, avec `CCREMOTE_HQ` fixé à ce chemin dans l'environnement du relais.
- Le relais ne sert que le build : aucune dépendance Node/Bun à l'exécution côté Agent HQ.

## Variables d'environnement

| Variable | Où | Rôle | Exemple (factice) |
|---|---|---|---|
| `VITE_SOURCE` | build / dev | `demo` (défaut) ou `relais` | `relais` |
| `VITE_RELAIS_URL` | build / dev | URL publique du relais, si `VITE_SOURCE=relais` | `https://relais.example.com` |
| `RELAIS_CIBLE` | dev seulement | cible du proxy `/api` de Vite (ne sert pas au build) | `https://relais.example.com` |
| `CCREMOTE_HQ` | relais (Pi) | dossier du build servi sous `/hq/` | `/mnt/projects/ccremote-relais/hq/dist` |

Les valeurs réelles ne se versionnent pas : elles vont dans `hq/.env.local` (ignoré) ou dans l'environnement de déploiement.

## Ports

| Port | Usage |
|---|---|
| 5190 | `bun run dev` (Vite, hôte `127.0.0.1`) |
