# ARBORESCENCE — ccremote

Une ligne par fichier, responsabilité unique.

```
client/
  ccremote.py              CLI sur le Raspberry Pi : Wake-on-LAN + statut (usage direct, hors pi-web)
  config.py                Constantes réseau du client CLI (PC_HOST, PC_MAC, users)
  requirements.txt         Dépendances Python du client CLI

pi-web/
  app.py                   App FastAPI : routes HTTP/SSE, auth par cookie de session, proxy vers le PC
  config.py                Constantes + secrets (.env) : hôte/MAC du PC, mot de passe UI, clé Cerebras
  pc_client.py             Client websocket vers server.py (ws_cmd) + envoi du magic packet WOL
  requirements.txt         Dépendances Python de pi-web
  .env                     Secrets locaux (gitignored) : UI_PASSWORD, CEREBRAS_API_KEY
  .env.example             Gabarit des variables d'environnement requises

  agent/
    __init__.py            Marqueur de package
    client.py               Client Cerebras (AsyncOpenAI compatible) : modèles dispo, contexte par modèle, appel non-stream et stream
    context.py              Estimation de tokens + compactage automatique de l'historique de conversation
    chat.py                  Boucle agentique streaming (SSE) : appelle le modèle, exécute les tool calls, yield les events
    tools.py                 Schémas de tools (OpenAI function-calling) + exécuteurs réels (status/metrics/sessions/comptes/shutdown)

  templates/
    index.html               Page principale SPA (Jinja2) : sidebar, 5 vues, panneau sessions/terminal, modals
    login.html                Page de connexion (mot de passe unique, pas de comptes)

  static/
    core.js                   État global, prefs/historique localStorage, router de vues, sidebar mobile, toasts/modals
    sidebar.js                 Statut PC live (polling), Wake-on-LAN, extinction PC
    chat.js                    Chat agent : streaming SSE, markdown, conversations persistantes (localStorage)
    sessions.js                CRUD sessions tmux, terminal live (panneau droit), redimensionnement draggable
    pcview.js                  Vue "État du PC" : métriques détaillées (CPU/RAM/GPU/temp/disque/réseau)
    settings.js                Préférences agent, sélection de modèle, switch de compte Claude Code

server/
  server.py                Serveur websocket sur le PC principal : tmux (launch/kill/capture/send_keys),
                            métriques psutil/nvidia-smi, switch de compte Claude Code, poweroff
  config.py                 Constantes serveur : host/port d'écoute, commande de lancement Claude Code
  launch-claude.sh           Script lancé dans tmux : démarre Claude Code avec les bons flags/env
  ccremote-server.service    Unit systemd du serveur websocket
  requirements.txt           Dépendances Python du serveur

deploy-pi.sh                Déploiement du client CLI vers le Raspberry Pi
deploy-web-pi.sh            Déploiement de pi-web vers le Raspberry Pi (scp + restart systemd)
start.sh                     Démarre pi-web en local pour le dev (PID file, logs/pi-web.log)
stop.sh                       Arrête l'instance de dev local de pi-web (via le PID file)
restart.sh                    stop.sh puis start.sh
.gitignore                   Exclusions : venv/, __pycache__/, chroma_data/, logs/, .env
.env.example                 Gabarit racine des secrets (chargés depuis pi-web/.env)
README.md                    Stack, ports, lancement manuel, déploiement
ARCHITECTURE.md              Carte des domaines, règles de frontière, définitions anti-rot
STATE.md                     État courant du projet, décisions, contexte non-évident
TODO.md                       Tâches en cours et backlog
ARBORESCENCE.md               Ce fichier
logs/                        Répertoire de logs (vide dans le repo, reset à chaque start.sh)
```
