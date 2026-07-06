# ccremote

Panneau de contrôle personnel pour piloter un PC principal (sessions Claude Code dans tmux,
performances, extinction/réveil) depuis un Raspberry Pi exposé publiquement, avec un agent IA
en langage naturel.

## Stack

| Composant | Rôle | Stack |
|---|---|---|
| `server/` | Tourne sur le PC principal | Python, `websockets`, `psutil`, tmux, systemd |
| `pi-web/` | Tourne sur le Raspberry Pi | Python, FastAPI, Jinja2, vanilla JS/CSS (Tailwind CDN), systemd |
| `client/` | CLI optionnelle sur le Pi | Python, `websockets` (Wake-on-LAN + statut, hors pi-web) |

Agent IA : Cerebras Cloud (`gpt-oss-120b` par défaut, `zai-glm-4.7` et `gemma-4-31b` disponibles),
tool-calling en streaming SSE.

## Ports

- `8765` — websocket `server.py` sur le PC principal (LAN uniquement)
- `8766` — FastAPI `pi-web` en local (dev) / derrière Cloudflare Tunnel en prod
- Domaine public : `ccremote.exemple.com`

## Lancement manuel

### server.py (PC principal)

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

### Déploiement sur le Raspberry Pi

```bash
./deploy-web-pi.sh   # pi-web (scp + restart du service systemd ccremote-web)
./deploy-pi.sh        # client CLI
```

## Variables d'environnement

Voir `.env.example` à la racine — chargées depuis `pi-web/.env` (seul composant avec des secrets ;
`server/` et `client/` n'ont que des constantes réseau non sensibles dans leurs `config.py`).

## Documentation

- `STATE.md` — état courant du projet, décisions, contexte non-évident
- `TODO.md` — tâches en cours et backlog
- `ARBORESCENCE.md` — arborescence complète, une ligne par fichier
- `ARCHITECTURE.md` — carte des domaines et règles de frontière entre modules
