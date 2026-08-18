# ARCHITECTURE — ccremote

## Deux systèmes, un seul dépôt

Ce dépôt porte **deux systèmes distincts**, nés à des périodes différentes, qui ne partagent aucun
code entre eux mais **partagent la même interface web** (`pi-web/`, sur le Raspberry Pi) :

1. **Panneau de contrôle personnel** (origine du projet) — piloter le PC principal (sessions Claude
   Code dans tmux, métriques, Wake-on-LAN/extinction) via un agent IA en langage naturel.
   `client/` + `server/` + la partie « historique » de `pi-web/` (`agent/`, `pc_client.py`,
   `templates/index.html` hors blocs harness, `static/{core,chat,sessions,pcview,usage,settings,
   sidebar}.js`).
2. **Harness d'orchestration d'équipes Claude Code** (`harness/`, chantier actif depuis fin juillet
   2026) — une conversation avec un orchestrateur qui dispatche, supervise et clôture des équipes
   d'agents Claude Code autonomes, sur plusieurs projets, sur plusieurs machines (Pi, PC, VPS).

La frontière de premier niveau n'est donc pas un domaine métier unique, mais **la machine qui
exécute le code + le système auquel le dossier appartient** — déviation assumée de la doctrine
« Screaming Architecture par domaine métier » : pour un dépôt qui héberge deux produits distincts
sur des cibles de déploiement physiques distinctes, ce découpage *est* le découpage par domaine.

```
client/          CLI Wake-on-LAN + statut, tourne sur le Raspberry Pi, usage direct (hors pi-web)
server/          Serveur websocket, tourne sur le PC principal, source de vérité pour tmux/métriques/comptes
pi-web/          App web FastAPI sur le Raspberry Pi — UI UNIQUE pour les deux systèmes (voir plus bas)
harness/         Orchestrateur d'équipes Claude Code : control plane (Pi) + superviseur de workers (PC)
Upgrade/         Spécification d'origine du harness — documentation seule, aucun code d'implémentation
design-v2/       Maquette HTML statique de l'UI harness (DA cream/serif/orange validée par Chris)
design-v3/       Maquette HTML statique, ajouts H-70/H-71/H-72 sur la base v2 — antérieure au code réel
design-mission/  Maquette HTML statique de la fiche mission
```

`design-v2/`, `design-v3/`, `design-mission/` sont des prototypes jetables : ils ne sont jamais
servis, l'UI harness réelle vit dans `pi-web/templates/_harness_*.html` et `pi-web/static/harness-*.js`.

### `pi-web/` : une UI, deux back-ends

`pi-web/` est FastAPI, tourne sur le Pi, et sert les deux systèmes derrière la même session/mot de
passe :

```
pi-web/agent/               IA du panneau de contrôle personnel : tools, client Cerebras, streaming.
                             Ne connaît rien du harness.
pi-web/pc_client.py          Client websocket vers server.py (système 1 uniquement)
pi-web/harness_proxy.py      Relais HTTP vers l'API web du harness (Bun, 127.0.0.1:8722, système 2
                             uniquement) — voir pi-web/CONTRAT-API-HARNESS.md pour le contrat exact
pi-web/static/harness-*.js   JS front du système 2 (parc, missions, comptes, notifications, dialogue...)
pi-web/static/{core,chat,   JS front du système 1 (chat agent, sessions tmux, métriques PC, réglages)
  sessions,pcview,usage,
  settings,sidebar}.js
pi-web/templates/_harness_*  Fragments HTML du système 2, injectés dans templates/index.html
```

`pi-web/CONTRAT-API-HARNESS.md` documente le chemin d'appel complet du système 2 : navigateur →
`/api/harness/…` → `harness_proxy.py` → `HARNESS_API_URL` (Bun, local) → `harness/control-plane/
api-web/`.

### `harness/` : carte interne (résumé)

`harness/` a son propre `ARCHITECTURE.md` et `ARBORESCENCE.md` (145 et 366 lignes) qui font
autorité sur le détail — ce qui suit est un résumé pour la carte racine, pas une redite exhaustive.
`⚠` Ces deux fichiers datent du 2026-08-07 et sont eux-mêmes en retard sur au moins deux domaines
créés depuis (`apprentissage/`, complet ce soir-là) — signalé dans `TODO.md`, non corrigé ici
(hors périmètre : ce ne sont pas des fichiers racine).

```
composition/            racine d'assemblage — construit le graphe réel, expose les bin-*.ts
control-plane/          tout ce qui vit sur le Pi (autorité unique : registre, bus de permissions,
                         observabilité, orchestrateur — la session Agent SDK qui parle à Chris)
workers/                cycle de vie d'UN worker (spawn, options SDK, capacités, canUseTool)
superviseur/            parc de workers du PC : registre persistant, fencing, arrêt d'urgence, canal D.3
apprentissage/          [NOUVEAU depuis le 08/08] extraction de leçons depuis les transcripts
                         d'équipes, base SQLite dédiée, consolidation périodique, injection au mandat —
                         inspiré de Hermes Agent (Nous Research), transposition indépendante en TS
transport/              canaux réseau Pi↔PC (D.1 données, D.3 relayé par superviseur/)
plancher-deni/          motifs Bash structurellement interdits, quel que soit le mode de permission
budgets/                plafond de parc, classification d'usage, retry watchdog
anti-boucle/            juge Haiku, détecteur de boucle (pas un plafond en $)
arret-urgence/          drill récurrent de l'arrêt d'urgence
discipline-contexte/    échantillonnage et compaction de contexte
relance/                politique de relance après terminaison de tour
projets/                triplet projet/worktree/équipe et son cycle de vie git
pause/                  pause/reprise d'un worker sans perte ni duplication
shared/                 utilitaires réellement transverses (budget équipe, modèles Claude, accès mandat)
config-equipe/          gabarit CLAUDE.md distribué à chaque worker + script d'installation de compte
test-harness/           outillage de test (contrats de pannes, doublures, déterminisme)
validation-proprietes/  preuve des cinq propriétés de couche 1
acceptation/            bancs d'essai réels (hors bun test, jamais en CI) — inclut demo-apprentissage/
```

## Règles de frontière entre modules

**Entre les deux systèmes** :
- **`harness/` n'importe jamais rien de `client/`, `server/`, ou `pi-web/agent/`/`pi-web/pc_client.py`**,
  et réciproquement. Le seul point de contact est HTTP, via `pi-web/harness_proxy.py` →
  `harness/control-plane/api-web/`.
- **`pi-web/static/harness-*.js` ne touche jamais `state` du système 1** (défini dans `core.js`) ni
  l'inverse — les deux fronts coexistent dans la même page sans état partagé.

**À l'intérieur du système 1 (panneau de contrôle personnel)** :
- **`agent/` ne fait jamais d'appel HTTP/websocket direct** vers le PC — il passe exclusivement
  par les executors de `tools.py`, qui eux-mêmes ne passent que par `pc_client.ws_cmd()`.
- **`pc_client.py` est le seul module autorisé à parler au websocket du PC** (`server.py`). Aucun
  autre fichier de `pi-web/` n'ouvre de connexion réseau vers le PC principal.
- **`server.py` est la seule source de vérité pour l'état réel** (tmux, métriques, comptes Claude
  Code, extinction). `pi-web` ne fait jamais d'hypothèse sur cet état sans l'interroger.
- **Les fichiers `static/{core,chat,sessions,pcview,usage,settings,sidebar}.js` communiquent
  uniquement via `state`** (défini dans `core.js`, chargé en premier).
- **`.credentials_account1.json` / `.credentials_account2.json` / `.ccremote-accounts.json`**
  (sur le PC, hors du repo) ne sont manipulés que par `server.py::switch_claude_account`.

**À l'intérieur du système 2 (harness)** — règles complètes dans `harness/ARCHITECTURE.md` :
- **Frontière A↔B inexistante, appliquée deux fois** : ni `control-plane/` n'importe de fichier de
  `superviseur/`/`workers/`, ni l'inverse. Tout passage traverse un port composé dans `composition/`.
- **`harness_proxy.py` porte l'authentification du côté pi-web** : l'API Bun du harness
  (`CCREMOTE_API_WEB_PORT`, 8722 par défaut) n'a aucune authentification propre et refuse de
  démarrer hors boucle locale — dupliquer l'authentification créerait deux vérités sur « qui a le
  droit », et la plus permissive gagnerait en silence.
- **`apprentissage/index.ts` est le seul import autorisé de l'extérieur du domaine** — aucun autre
  module n'importe les fichiers internes de `apprentissage/`.

`service`/`manager`/`helper` non utilisés dans ce dépôt — le nommage suit le vocabulaire métier
français déjà établi (mission, garde-fou, port, câblage, lien).

## Définitions non-ambiguës (contrat anti-rot)

| Dossier/fichier | Définition | Ne pas confondre avec |
|---|---|---|
| `server/` | Processus sur le PC principal, autorité sur tmux/métriques/comptes/poweroff (système 1) | `harness/superviseur/` (autorité sur les WORKERS du harness, système 2, aucun rapport) |
| `pi-web/agent/` | Logique IA du panneau de contrôle personnel — aucune notion HTTP, aucun lien avec le harness | `harness/control-plane/orchestrateur/` (l'IA du système 2, tourne en Bun, pas en Python) |
| `pi-web/pc_client.py` | Client websocket vers `server.py` (système 1) | `pi-web/harness_proxy.py` (relais HTTP vers le harness, système 2) |
| `client/` | CLI autonome pour le Pi (WOL + statut, système 1), invoqué manuellement | `harness/composition/pi/reveil-wol.ts` (WOL du système 2, code TS distinct) |
| `harness/composition/` | Assemblage du graphe réel du harness, points d'entrée `bin-*.ts` | `harness/control-plane/` (contenu métier assemblé, pas le câblage) |
| `harness/superviseur/` | Parc de workers PC : registre, persistance, fencing, arrêt d'urgence | `harness/workers/` (cycle de vie d'UN worker, pas du parc) |
| `harness/apprentissage/` | Extraction/injection de leçons entre missions (base SQLite dédiée) | `harness/control-plane/observabilite/` (télémétrie temps réel, pas de mémoire long terme) |
| `Upgrade/` | Spécification d'origine du harness, documents seuls | `harness/*/README.md` (doc de mission, à jour au moment de la fermeture) |
| `design-v2/`, `design-v3/`, `design-mission/` | Maquettes HTML statiques, jamais servies | `pi-web/templates/_harness_*.html` (l'UI réelle, servie en production) |
