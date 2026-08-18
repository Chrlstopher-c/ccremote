# ccremote

Deux systèmes dans ce dépôt (détail : `ARCHITECTURE.md`) :

1. **Panneau de contrôle personnel** — piloter un PC principal (sessions Claude Code dans tmux,
   performances, extinction/réveil) depuis un Raspberry Pi exposé publiquement, avec un agent IA en
   langage naturel.
2. **Harness d'orchestration** (`harness/`) — un orchestrateur qui dispatche, supervise et clôture
   des équipes d'agents Claude Code autonomes, sur plusieurs projets, sur trois machines (Pi, PC,
   VPS).

Les deux partagent la même interface web (`pi-web/`, sur le Pi).

## Stack

| Composant | Rôle | Stack |
|---|---|---|
| `server/` | Système 1, tourne sur le PC principal | Python, `websockets`, `psutil`, tmux, systemd |
| `pi-web/` | UI des deux systèmes, tourne sur le Raspberry Pi | Python, FastAPI, Jinja2, vanilla JS/CSS (Tailwind CDN), systemd |
| `client/` | CLI optionnelle du système 1 sur le Pi | Python, `websockets` (Wake-on-LAN + statut, hors pi-web) |
| `harness/` | Système 2 — control plane (Pi) + superviseur de workers (PC, et VPS en repli) | Bun, TypeScript strict, `@anthropic-ai/claude-agent-sdk`, SQLite (`bun:sqlite`), `pino` |

Agent IA du système 1 : Cerebras Cloud (`gpt-oss-120b` par défaut, `zai-glm-4.7` et `gemma-4-31b`
disponibles), tool-calling en streaming SSE. L'orchestrateur du système 2 est une session Claude
Agent SDK (Opus/Sonnet/Fable selon le mandat).

## Ports

- `8765` — websocket `server.py` sur le PC principal (LAN uniquement, système 1)
- `8766` — FastAPI `pi-web` en local (dev) / derrière Cloudflare Tunnel en prod (système 1 + 2)
- `8721` — lien de contrôle Pi↔PC du harness (`CCREMOTE_LIEN_PORT`), hébergé par le Pi, loopback
  uniquement — relayé publiquement par le même Cloudflare Tunnel que `pi-web`
- `8722` — API web du harness lue par `pi-web/harness_proxy.py` (`CCREMOTE_API_WEB_PORT`), loopback
  strict, aucune authentification propre (voir `ARCHITECTURE.md`)
- Domaine public : `ccremote.exemple.com`

## Lancement manuel

### server.py (PC principal, système 1)

En production, tourne en systemd (`ccremote-server.service`, voir `server/ccremote-server.service`).
Pour du dev local :

```bash
cd server
python3 -m venv venv && venv/bin/pip install -r requirements.txt
venv/bin/python server.py
```

### pi-web (dev local, avant déploiement sur le Pi)

```bash
./start.sh    # démarre pi-web en arrière-plan, logs dans logs/pi-web.log
./stop.sh     # l'arrête
./restart.sh  # les deux
```

Nécessite `pi-web/.env` (voir `.env.example` à la racine) avec `UI_PASSWORD` et `CEREBRAS_API_KEY`.

### harness (système 2) — dev local

```bash
cd harness
bun install
cp .env.example .env   # renseigner les chemins et adresses réels — voir harness/README.md
bun run typecheck      # tsc --noEmit
bun test                # suite complète
```

**Ordre de démarrage : le PC d'abord, le Pi ensuite** — le Pi se connecte au canal de contrôle du
PC au démarrage de sa réconciliation.

```bash
bun run start:pc   # sur le PC — composition/pc/bin-pc.ts
bun run start:pi    # sur le Pi — composition/pi/bin-pi.ts
```

## Déploiement

Scripts à la racine, tous en `./nom.sh [--simulation]` sauf indication contraire :

| Script | Déploie | Machine |
|---|---|---|
| `deployer-tout.sh` | Les trois machines, dans l'ordre imposé (Pi, PC, VPS), en une commande | Pi + PC + VPS |
| `deployer-pi.sh` | Control plane du Pi (`deploy-harness-pi.sh`) + interface web SI elle a changé (`deploy-web-pi.sh`) — résout seul le secret du lien | Pi |
| `deploy-harness-pi.sh` | Control plane du harness seul | Pi |
| `deploy-web-pi.sh` | `pi-web` seul (scp + restart systemd `ccremote-web`) | Pi |
| `deploy-pi.sh` | Client CLI du système 1 | Pi |
| `deploy-superviseur-pc.sh` | Recharge le superviseur du PC (`ccremote-pc`) sur le code du dépôt | PC |
| `deploy-superviseur-vps.sh` | Porte le superviseur (repli) sur le VPS OVH | VPS |
| `deploy-mcp-vps.sh` | Serveurs MCP utilisés par les équipes du VPS | VPS |
| `deployer-apprentissage.sh` | Active/porte la boucle d'apprentissage sur le superviseur du PC | PC |

`⚠` `deploy-superviseur-vps.sh` lit `CCREMOTE_VPS_LIEN_URL_PI` pour surcharger l'URL du lien —
**jamais** `CCREMOTE_LIEN_URL_PI`, qui appartient légitimement à l'environnement du PC et, si
hérité par erreur lors d'un déploiement lancé depuis le PC, écrirait sur le VPS une adresse LAN
injoignable (panne réelle de 45 min le 18/08 — voir `STATE.md`).

## Variables d'environnement

- `.env.example` (racine) — chargées depuis `pi-web/.env` (seul composant du système 1 avec des
  secrets ; `server/` et `client/` n'ont que des constantes réseau non sensibles).
- `harness/.env.example` — variables de composition du système 2 (`CCREMOTE_LIEN_SECRET`,
  `CCREMOTE_PC_REGISTRE_DB`, `CCREMOTE_LIEN_URL_PI`, ports, etc.) — détail dans `harness/README.md`.

## Documentation

- `STATE.md` — état courant du projet, décisions, contexte non-évident
- `TODO.md` — tâches en cours et backlog
- `ARBORESCENCE.md` — arborescence complète, une ligne par fichier
- `ARCHITECTURE.md` — carte des domaines et règles de frontière entre modules
- `SYNTHESE-CHANTIER.md` — synthèse décisionnelle des points ouverts du TODO (voir note dans `STATE.md`)
- `harness/README.md`, `harness/ARCHITECTURE.md`, `harness/ARBORESCENCE.md` — mêmes documents,
  détaillés, pour le seul système 2
