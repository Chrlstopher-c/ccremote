# ARCHITECTURE — ccremote

## Carte des domaines

Le projet est un outil perso multi-machine. La frontière de premier niveau n'est pas un domaine
métier au sens produit, mais **la machine qui exécute le code** — c'est la frontière réellement
significative ici : chaque dossier tourne dans un processus séparé, sur un réseau séparé, déployé
séparément. C'est une déviation assumée de la doctrine "Screaming Architecture par domaine métier" :
pour un outil perso à 3 exécutables physiques distincts, le découpage par cible de déploiement
*est* le découpage par domaine — il n'y a pas de couche métier transverse à faire ressortir en plus.

```
client/    CLI Wake-on-LAN + statut, tourne sur le Raspberry Pi, usage direct (hors pi-web)
server/    Serveur websocket, tourne sur le PC principal, source de vérité pour tmux/métriques/comptes
pi-web/    App web FastAPI, tourne sur le Raspberry Pi, sert l'UI publique + l'agent IA
```

À l'intérieur de `pi-web/`, en revanche, le découpage redevient technique par nécessité (agent IA
vs présentation) mais reste en vertical slice serré :

```
pi-web/agent/       Tout ce qui concerne l'IA : schémas de tools, client Cerebras, boucle
                     agentique streaming, gestion du contexte. Ne connaît rien du HTTP/Jinja2.
pi-web/templates/   Structure HTML des 2 pages (SPA + login). Pas de logique métier inline.
pi-web/static/       JS front, un fichier par responsabilité (chat, sessions, pc, settings, sidebar,
                     core). Chaque fichier ne touche que son propre state/DOM, communique via
                     l'objet `state` global défini dans core.js.
pi-web/app.py        Seule couche qui connaît HTTP : routes, auth par cookie, appelle agent/ et
                     pc_client.py, ne contient aucune logique métier propre.
pi-web/pc_client.py  Unique point de sortie websocket vers server.py. Rien d'autre n'ouvre de
                     connexion vers le PC principal.
```

## Règles de frontière entre modules

- **`agent/` ne fait jamais d'appel HTTP/websocket direct** vers le PC — il passe exclusivement
  par les executors de `tools.py`, qui eux-mêmes ne passent que par `pc_client.ws_cmd()`.
- **`pc_client.py` est le seul module autorisé à parler au websocket du PC** (`server.py`). Aucun
  autre fichier de `pi-web/` n'ouvre de connexion réseau vers `pc.exemple`.
- **`server.py` est la seule source de vérité pour l'état réel** (tmux, métriques, comptes Claude
  Code, extinction). `pi-web` ne fait jamais d'hypothèse sur cet état sans l'interroger.
- **Les fichiers `static/*.js` communiquent uniquement via `state`** (défini dans `core.js`,
  chargé en premier) — pas d'appel direct d'une fonction d'un fichier à l'état interne d'un autre
  sans passer par cet objet partagé ou par le DOM.
- **`.credentials_account1.json` / `.credentials_account2.json` / `.ccremote-accounts.json`**
  (sur le PC, hors du repo) ne sont manipulés que par `server.py::switch_claude_account` —
  aucun autre composant n'y touche.

## Définitions non-ambiguës (contrat anti-rot)

| Dossier/fichier | Définition | Ne pas confondre avec |
|---|---|---|
| `server/` | Processus tournant sur le PC principal, autorité sur tmux/métriques/comptes/poweroff | `pi-web/` (ne fait jamais tourner tmux lui-même) |
| `pi-web/agent/` | Logique IA (tool-calling, streaming, contexte) — aucune notion HTTP | `pi-web/app.py` (couche HTTP, ne fait pas de logique IA) |
| `pi-web/pc_client.py` | Client websocket vers `server.py`, fonctions utilitaires pures | `pi-web/agent/tools.py` (executors métier qui *appellent* pc_client) |
| `client/` | CLI autonome pour le Pi (WOL + statut), invoqué manuellement | `pi-web/` (l'app web ne dépend pas de `client/`) |
