# ARCHITECTURE — ccremote v2

ccremote pilote les **sessions Claude Code** du parc (tour, portable, Pi, VPS) depuis l'app de bureau, le web ou
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
| `commun/` | Les contrats partagés : vocabulaire d'une session et de son fil (`session.ts`), protocole poste ↔ relais (`protocole-poste.ts`), API des clients (`api-clients.ts`), journal pino | Aucune logique, aucune I/O |
| `poste/` | Tout ce qui tourne sur une machine de travail : sessions tmux, lecture des transcripts, crochets et MCP de rythme, politique de compaction/relance, lien sortant vers le relais, état de la machine, découverte des projets | Aucune connaissance des autres machines ni du registre |
| `relais/` | Tout ce qui tourne sur le Pi : registre SQLite, accès (mot de passe, jetons), API HTTP + flux WebSocket des clients, serveur des postes, notifications, réveil Wake-on-LAN, règle d'isolation du parc | Aucune décision sur le déroulé d'une session (c'est le poste) |
| `bureau/` | L'app de bureau (Tauri 2 + React) — le même frontend est servi en web par le relais ; `src-tauri/` = coquille native (terminal kitty, notifications) | Aucune règle métier : elle affiche et commande |
| `deploiement/` | Le script de déploiement (relais + postes) | Aucune valeur réelle : adresses, MAC et secrets viennent de `~/.config/ccremote/deploiement.env` |

### `poste/` en détail

| Fichier / dossier | Rôle |
|---|---|
| `session/session-tmux.ts` | UNE session : fil, commandes (via tmux), rythme si elle est pilotée |
| `session/gestionnaire.ts` | Les sessions du poste : découverte dans tmux, adoption, ouverture, persistance |
| `session/suite-du-tour.ts` | Pur : que faire à la fin d'un tour (attendre, compacter, relancer, patienter, s'arrêter) |
| `session/politique-compaction.ts` | Pur : quand compacter (seuils étape / dur) et avec quelle consigne |
| `session/traduction.ts` | Pur : ligne de transcript → événements du fil |
| `session/transcript.ts`, `sous-agents.ts` | Lecture incrémentale (octets) des transcripts, principal et sous-agents |
| `session/lanceur.ts`, `crochet.ts`, `mcp-rythme.ts`, `serveur-local.ts` | La ligne `claude` d'une session pilotée, ses hooks (Stop, SessionStart, UserPromptSubmit, PreToolUse) et ses outils (`etape_terminee`, `objectif_atteint`, `poser_question`), reliés au poste par un socket Unix 0600 |
| `session/garde-sous-agents.ts` | Sous-agents : Sonnet imposé, pas de fork, 3 par étape au plus |
| `session/consignes.ts`, `confiance.ts` | Le texte ajouté au prompt système ; l'approbation du dossier (sinon le CLI bloque sur « trust ») |
| `parc/` | Lien sortant vers le relais, état de la machine, extinction |
| `projets/` | Découverte des projets dans les racines de la machine |

## Frontières

- `bureau/` et `relais/` ne partagent que `commun/` (types seulement côté app). Un import de `relais/` depuis `bureau/`
  (ou l'inverse) est une faute.
- `poste/` et `relais/` ne se parlent que par `commun/protocole-poste.ts`, validé par zod à la réception.
- Un poste ne rend compte que de SES sessions : le relais refuse un compte rendu d'une session d'une autre machine.
- Les noms `service` / `manager` / `helper` ne sont pas utilisés : le nommage suit le métier (poste, relais, session,
  fil, rythme).

## Sessions pilotées et adoptées

- **Pilotée** : ouverte par ccremote. Lancée avec `--session-id`, les consignes (`--append-system-prompt`), les crochets
  et le MCP de rythme. Autonomie (relance par le hook `Stop` jusqu'à `objectif_atteint`, pause après 3 tours à vide,
  patience si un sous-agent tourne), compaction pilotée, reprise automatique après compaction.
- **Adoptée** : lancée hors ccremote (bureau de la tour, Atrium, terminal). Suivie en lecture, pilotable par tmux
  (message, interruption, compaction, fermeture), sans autonomie.

## Thème de l'app

Charte Echo Agency (skill `echo-agency-design`) : **clair** (canvas sable, accent `brand-600`) et **night** (`#1E1830`,
accent `brand-400`) selon la préférence du système ; barre latérale night dans les deux.
