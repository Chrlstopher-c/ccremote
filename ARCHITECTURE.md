# ARCHITECTURE — Quart (dépôt `ccremote`, v2)

**Quart** est le nom du produit (app de bureau, onglet de Sémaphore sur l'iPhone). Le dépôt, les services
(`ccremote-relais`, `ccremote-poste`), les identifiants techniques et les dossiers de config gardent le nom `ccremote`.

Quart pilote les **sessions Claude Code** du parc (tour, portable, Pi, VPS) depuis l'app de bureau, le web ou
l'iPhone (Sémaphore). Une session est un **vrai Claude Code en TUI**, dans un serveur tmux dédié, avec toute la config de
Chris : on s'y attache dans kitty comme à n'importe quel terminal, et on la suit ou lui parle à distance.

```
 app de bureau (Tauri) ─┐                         ┌─ poste tour ─────┐
 web (même code)       ─┼─ HTTPS/WSS ─ relais ────┼─ poste portable ─┤  chaque poste : sessions `claude`
 iPhone (Sémaphore)    ─┘   (Pi, sans IA)          ├─ poste pi ───────┤  dans `tmux -L claude`, fil lu dans
                                                  └─ poste vps ──────┘  le transcript JSONL
```

## Principes

- **Le relais n'a pas d'IA.** Il authentifie, garde le registre (machines, sessions, fil, notifications) et relaie les
  commandes. L'ancien orchestrateur LLM du Pi (une session Opus permanente qui dispatchait des équipes) a été retiré :
  c'était le premier poste de dépense et il ne produisait rien lui-même.
- **Une session = un Claude Code persistant.** Pas d'équipes, pas de mandats. Le coût d'une session est la taille de son
  contexte relue à chaque tour : le poste la **compacte aux fins d'étape** (au-delà de 120 k) et **au seuil dur**
  (350 k sur une fenêtre de 1 M), jamais pour rien.
- **Le transcript est la source de vérité.** Le fil (messages, texte, outils avec leur entrée complète, résultats,
  sous-agents) est lu dans `~/.claude/projects/…/<session>.jsonl` et `…/<session>/subagents/*.jsonl`. Ce que Chris tape
  directement dans le terminal y est aussi.
- **Le pouvoir ne va que dans un sens.** Les clients commandent le relais, le relais commande les postes, un poste ne
  commande jamais rien. Le VPS est **isolé** : il ne joint pas la maison et ne travaille que sur ses propres projets.

## Carte des domaines

| Dossier | Ce qu'il contient | Ce qu'il ne contient PAS |
|---|---|---|
| `commun/` | Les contrats partagés : vocabulaire d'une session et de son fil (`session.ts`), accès à un appareil — fichiers et terminaux (`appareil.ts`), protocole poste ↔ relais (`protocole-poste.ts`), API des clients (`api-clients.ts`), journal pino | Aucune logique, aucune I/O |
| `poste/` | Tout ce qui tourne sur une machine de travail : sessions tmux, lecture des transcripts, crochets et MCP de rythme, politique de compaction/relance, lien sortant vers le relais, état de la machine, découverte des projets | Aucune connaissance des autres machines ni du registre |
| `relais/` | Tout ce qui tourne sur le Pi : registre SQLite, accès (mot de passe, jetons par genre — appareil, claude-code, claude-ai — gérés depuis l'écran Accès), connecteurs Claude (`connecteurs/` : le MCP servi en HTTP sur `/mcp`), API HTTP + flux WebSocket des clients, serveur des postes, notifications, réveil Wake-on-LAN, règle d'isolation du parc | Aucune décision sur le déroulé d'une session (c'est le poste) |
| `bureau/` | **Appelé à disparaître** au profit de `hq/`. L'app de bureau (Tauri 2 + React) — le même frontend est servi en web par le relais ; `src-tauri/` = coquille native (terminal kitty, notifications) | Aucune règle métier : elle affiche et commande |
| `hq/` | Agent HQ : l'app web façon jeu (Phaser 3 + Vite), servie par le relais sous `/hq/` — modèle et transport (`src/donnees/`), jeu (`src/monde/`), pipeline d'assets Python hors runtime (`art/`) | Aucune règle de session : elle lit le relais et lui commande des actions |
| `mcp/` | Le MCP « quart » : un client de l'API du relais (jeton porteur) qui expose aux sessions Claude les outils `quart_*` — voir le parc, ouvrir une session sur n'importe quelle machine, lire son fil, lui parler, la piloter ; plus l'émission du jeton (sur le Pi) et l'installeur | Aucun accès direct à un poste ni au registre : tout passe par l'API HTTP publique du relais |
| `deploiement/` | Le script de déploiement (relais + postes) | Aucune valeur réelle : adresses, MAC et secrets viennent de `~/.config/ccremote/deploiement.env` |

### `poste/` en détail

| Fichier / dossier | Rôle |
|---|---|
| `session/session-tmux.ts` | UNE session : fil, commandes (via tmux), rythme si elle est pilotée |
| `session/gestionnaire.ts` | Les sessions du poste : découverte dans tmux, adoption, ouverture, persistance |
| `session/nuit.ts`, `suivi-nuit.ts` | Mode nuit : lecture de l'état écrit par la config Claude (`~/.claude/night/sessions/<id>.json`), politique pure de réveil (6 min d'arrêt sans Chris, 4 essais), bascule `night on|off`, suivi d'UNE session (publication, réveil, fin réussie) |
| `session/suite-du-tour.ts` | Pur : que faire à la fin d'un tour (attendre, compacter, relancer, patienter, s'arrêter) |
| `session/politique-compaction.ts` | Pur : quand compacter (seuils étape / dur) et avec quelle consigne |
| `session/traduction.ts` | Pur : ligne de transcript → événements du fil |
| `session/transcript.ts`, `sous-agents.ts` | Lecture incrémentale (octets) des transcripts, principal et sous-agents |
| `session/lanceur.ts`, `crochet.ts`, `mcp-rythme.ts`, `serveur-local.ts` | La ligne `claude` d'une session pilotée, ses hooks (Stop, SessionStart, UserPromptSubmit, PreToolUse) et ses outils (`etape_terminee`, `objectif_atteint`, `poser_question`), reliés au poste par un socket Unix 0600 |
| `session/garde-sous-agents.ts` | Sous-agents : Sonnet imposé, pas de fork, 3 par étape au plus |
| `session/consignes.ts`, `confiance.ts` | Le texte ajouté au prompt système ; l'approbation du dossier (sinon le CLI bloque sur « trust ») et l'accueil marqué fait d'un dossier de config neuf |
| `session/processus.ts`, `adoption.ts` | Les Claude vivants déclarés dans `<config>/sessions/<pid>.json` : identifiant exact des sessions tmux, sessions de terminal suivies en lecture seule |
| `session/dialogue.ts`, `suivi-dialogue.ts` | Les dialogues du TUI (AskUserQuestion, permission, plan) relevés à l'écran du pane, et la réponse de Quart tapée au clavier après revérification. Le transcript n'écrit un AskUserQuestion qu'une fois répondu : l'écran est la seule source |
| `session/claude-tmux.zsh` | Lanceur à sourcer dans `~/.zshrc` : tout `claude` interactif tapé au clavier démarre dans `tmux -L claude` |
| `comptes/` | Les comptes Claude Code de la machine : relevé (identité par `claude auth status`, usage par l'API OAuth, jeton jamais renouvelé ici), connexion OAuth en deux temps (URL puis code, dans un tmux `quart-connexion-*` invisible des sessions), retrait, persistance dans `poste.json` ; vue complète d'un compte et réinitialisation de limite (`lecture-compte.ts` : lectures GET de l'API OAuth, cache 60 s par compte, profil gardé 10 min ; `detail*.ts` et `reinitialisation.ts` : traduction pure) |
| `distant/` | Sessions Remote Control d'un compte, vues sur claude.ai : `spectateur.ts` suit les comptes activés (tour toutes les 5 s, dédoublonné avec les sessions locales), `session-distante.ts` implémente `SessionPoste` (`moteur: 'claude_ai'`, historique puis suivi direct, pilotage : message, interruption, réglages, réponse aux permissions et questions via `attente-distante.ts`), `controle-distant.ts` (événements de contrôle, purs), `client-claude-ai.ts` (lecture et envoi avec le jeton du dossier du compte, à chaque appel) |
| `relais-sessions/` | La trace des messages relayés entre sessions : `trace.ts` la garde sur le poste (`relais/<session>.jsonl`, datée) et la réinsère à sa date dans l'historique de toute session |
| `parc/` | Lien sortant vers le relais, état de la machine, extinction |
| `fichiers/` | Les fichiers de la machine vus depuis Quart : lister, lire/écrire par morceaux, renommer (sans jamais écraser), supprimer, créer un dossier |
| `terminal/` | Les terminaux à distance : un PTY par terminal (shell, ou client attaché à `tmux -L claude`), sortie regroupée vers le relais |
| `projets/` | Découverte des projets dans les racines de la machine |

## Moteurs du poste

Une session a un **moteur** (`commun/session.ts`, champ `moteur`) : `sdk` pour les sessions ouvertes depuis l'app (absent
= `sdk` à la lecture), `tmux` pour les sessions tapées au clavier et les anciennes sessions.

| Fichier | Rôle |
|---|---|
| `poste/session/session-poste.ts` | Contrat commun aux deux moteurs : le gestionnaire ne parle qu'à cette forme |
| `poste/session/session-sdk.ts` | UNE session SDK : une requête `query()` par session, nourrie par les messages de Chris, fil, dialogues, fin de tour |
| `poste/session/file-messages-sdk.ts` | File asynchrone des messages de Chris ; le premier ne part qu'une fois les connecteurs MCP prêts |
| `poste/session/traduction-sdk.ts` | Pur : message du SDK → événements du fil et signaux de fin de tour, jamais d'exception |
| `poste/session/options-sdk.ts` | Pur : options du SDK (dossier, reprise, consignes, modèle, environnement épuré, permissions, serveur de rythme) |
| `poste/session/questions-sdk.ts` | Pur : AskUserQuestion et ExitPlanMode deviennent des dialogues ; la réponse redevient la décision attendue |
| `poste/session/rythme.ts` | Pur : les trois outils de rythme (étape, objectif, question) ; chaque moteur applique ses propres drapeaux |
| `poste/session/bilan-tour.ts` | Bilan d'un tour (outils, étape, compaction, messages en vol, interruption), puis suite à en tirer |

Le SDK n'a pas de hook `Stop` : à la fin de chaque tour, `bilan-tour.ts` applique la même politique pure que les sessions
tmux (`suite-du-tour.ts` : relance autonome, compaction, mode nuit). Le fil, les commandes (envoyer, interrompre, compacter,
fermer, reprendre, répondre, autonomie, nuit) et les réponses aux dialogues sont les mêmes pour les deux moteurs.

## Cycle de vie d'une session

- **Statuts** (`commun/session.ts`) : `demarrage`, `travail`, `compaction`, `attente`, `question`, `terminee`, `erreur`, `fermee`.
- **Inactivité** (`relais/sessions/`) : inactive = tour fini (`attente` ou `terminee`) et silence depuis le seuil
  (30 min, `CCREMOTE_INACTIVITE_MIN`). Aucun événement ne l'annonce : le relais la recalcule chaque minute et ne diffuse
  que les changements.
- **Archivage** (`relais/clients/api-sessions.ts`) : `POST /api/sessions/:id/archiver` ferme d'abord une session vivante
  (si le poste refuse, rien n'est écrit) puis la range ; `desarchiver` ne touche jamais au poste. Une session rangée est
  absente des listes sauf `?archivees=1`. Le client HQ appelle la même route (`hq/src/donnees/transport-http.ts`).
- **Rétention** : le fil d'une session fermée depuis 30 jours est purgé (`relais/registre/retention.ts`).

## Agent HQ (`hq/`)

Agent HQ est l'app web façon jeu (Phaser 3 + Vite, interface React par-dessus) qui remplace Claude Desktop et l'appli
mobile Claude, et l'ancienne interface `bureau/`, appelée à disparaître. Chaque session est un Clawd : il travaille à son
bureau, se lève quand il attend Chris, sort devant l'entrée quand elle est inactive. Servie par le relais (`CCREMOTE_HQ`)
sous `/hq/` : la page est publique, l'API reste protégée. Sans relais, la source démo la fait vivre seule.

Carte des domaines de `hq/src/` :

- `donnees/` — modèle et transport, sans affichage. `index.ts` est la surface publique ; `contrat.ts` est le miroir typé
  des contrats de `commun/` ; `monde-etat.ts` le magasin observable ; `transport*` le relais réel (HTTP + WebSocket, jeton
  jamais dans l'URL) ; `demo*` la source de démonstration sur horloge injectée ; `etat-agent.ts` dit ce que le monde montre
  d'une session ; `actions.ts`, `ouverture.ts`, `reunion.ts`, `fichiers.ts`, `terminal.ts` portent les actions de Chris.
- `monde/` — le jeu Phaser : `carte/` (plan pur, chemin A* pur, rendu), `persos/` (Clawd par session, Chris),
  `scene-monde.ts`, `lien-donnees.ts` (quelles sessions ont un bureau, dans quel état), `ambiance.ts` (jour et nuit).
- `ui/` — l'interface par-dessus le jeu : `bus.ts` (panneau ouvert), `contexte.tsx`, `config-relais.ts`, `Racine.tsx`,
  `Panneau.tsx`, puis `hud/`, `agent/` (écran d'agent), `terminal/`, `fichiers/` (bibliothèque), `reunion/` (salle),
  `nouvelle/` (embauche), `connexion/`.
- `art/` — pipeline Python hors runtime qui produit `public/` : `oblique.py` (moteur de boîtes, une seule projection du
  jeu), `meubles.py`, `tuiles.py`, `personnages.py` (Clawd et Chris), `marche_video.py` (marche de Chris tirée de vidéos
  MiniMax H3), `objets.py` (ancienne voie par génération), `DIRECTION.md` (règles de rendu), `gen/` (scripts de génération).

L'apparence du monde est en cours de design ; la structure ci-dessus est stable.

## Frontières

- `bureau/` et `relais/` ne partagent que `commun/` (types seulement côté app). Un import de `relais/` depuis `bureau/`
  (ou l'inverse) est une faute.
- `poste/` et `relais/` ne se parlent que par `commun/protocole-poste.ts`, validé par zod à la réception.
- `mcp/` n'importe que des types de `commun/` et parle au relais par HTTP, comme l'app : jamais d'import de `relais/`.
  Le relais, lui, importe l'interface publique de `mcp/` (`outils.ts`, `client-relais.ts`) pour servir les mêmes outils
  en HTTP (`relais/connecteurs/mcp-http.ts`) ; ces outils le rappellent par la boucle locale avec le jeton du connecteur.
- Un connecteur Claude (jeton `claude-code` / `claude-ai`) a tout le pilotage du parc mais ne gère pas les accès :
  `/api/acces` est réservé aux jetons `appareil` (connexion par mot de passe).
- Un poste ne rend compte que de SES sessions : le relais refuse un compte rendu d'une session d'une autre machine.
- Les noms `service` / `manager` / `helper` ne sont pas utilisés : le nommage suit le métier (poste, relais, session,
  fil, rythme).
- `hq/` ne dépend d'aucun autre dossier : il parle au relais par HTTP et WebSocket, avec son contrat miroir.
- Dans `hq/` : `monde/` et `ui/` ne parlent aux données que par `donnees/index.ts`, et `ui/` et `monde/` ne communiquent
  que par `ui/bus.ts`.

## Sessions pilotées et adoptées

- **Pilotée** (moteur `tmux`) : ouverte par ccremote. Lancée avec `--session-id`, les consignes (`--append-system-prompt`), les crochets
  et le MCP de rythme. Autonomie (relance par le hook `Stop` jusqu'à `objectif_atteint`, pause après 3 tours à vide,
  patience si un sous-agent tourne), compaction pilotée, reprise automatique après compaction.
- **Pilotée** (moteur `sdk`, défaut des sessions ouvertes depuis l'app) : même contrat, moteur décrit plus bas.
- **Adoptée** : lancée hors ccremote (bureau de la tour, Atrium, terminal). Suivie en lecture, pilotable par tmux
  (message, interruption, compaction, fermeture), sans autonomie.

## Mode nuit

Complémentarité voulue entre la config Claude Code de Chris et Quart : la config porte le **comportement** (protocole, plan, relance par
le hook Stop, refus de finir sans preuve) et marche seule, sans Quart ; Quart porte ce qu'une session ne peut pas faire d'elle-même —
la **veille** (réveil par tmux quand la session s'arrête malgré tout : limite des 9 blocages, erreur, plantage du CLI), la **vitrine**
(état dans l'app/l'iPhone, notifications de fin ou d'abandon) et la **télécommande** (bascule depuis l'app). Le contrat entre les deux est
un fichier : `~/.claude/night/sessions/<claudeSessionId>.json` (lu par le poste) et la trace `.done` d'une fin réussie. Voir
`~/.claude/night/README.md`.

## Comptes Claude Code

Un compte = un dossier de config (`CLAUDE_CONFIG_DIR`) sur une machine ; `null` = la config habituelle (`~/.claude`).
L'usage appartient au compte (email), pas à la machine : l'app regroupe les installations par email et garde le relevé
lisible le plus récent. Connexion : le poste lance `claude auth login` sans navigateur, rend l'URL (ouverte dans le
navigateur de Chris par l'app), puis tape le code collé par Chris. Le jeton ne quitte jamais la machine.

## Dialogues du TUI

Quand Claude Code attend un choix (question, permission, validation de plan), le poste relève le menu à l'écran du
pane toutes les 2 s et le publie sur la fiche de session (`dialogue`) ; un nouveau dialogue devient une question du fil
(alerte). La réponse (index, cases, texte libre) est traduite en touches, mesurées sur le TUI, et tapée seulement si le
même dialogue est encore affiché. Sessions de terminal hors tmux : non répondables.

## Echo

Echo (dépôt `echo`, cerveau sur le Pi) est le chef d'orchestre des sessions : pour Quart, un client du relais comme un
autre (jeton de service). En retour, le relais tient **un** WebSocket vers Echo (`relais/echo/`, facultatif :
`CCREMOTE_ECHO_URL` + `CCREMOTE_ECHO_JETON` dans `relais.env`) : il pousse ses messages dans le flux (`type: 'echo'`,
WebSocket seulement, le long-poll n'avance pas) et expose `/api/echo/{etat,historique,parler,interrompre}`. L'app
montre la conversation dans la vue « Echo » (`bureau/src/echo/`) ; l'historique fait foi côté Echo.

## Thème de l'app

Charte Echo Agency (skill `echo-agency-design`) : **clair** (canvas sable, accent `brand-600`) et **night** (`#1E1830`,
accent `brand-400`). Suit le système par défaut ; bascule système / clair / sombre dans le pied de la barre latérale et
la palette (Ctrl+K), mémorisée sur le poste (`data-theme` sur `<html>`).
