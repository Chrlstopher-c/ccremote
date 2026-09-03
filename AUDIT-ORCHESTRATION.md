# AUDIT — Système d'orchestration ccremote (harness)

*Audit en lecture seule, 2026-09-03. Aucun fichier de code/config modifié, système jamais exécuté.*
*Périmètre : le harness `harness/` (système 2). Le panneau de contrôle personnel — `client/`, `server/`, `pi-web/agent/` — est hors périmètre.*

Chaque affirmation est ancrée sur `fichier:fonction/constante`. Les lignes citées datent de l'audit.

---

## 1. Schéma du flux d'orchestration

```
                        Chris (navigateur, pi-web)
                              │  clic « autoriser »
                              ▼
  ┌──────────────────────────────── Pi (control plane) ───────────────────────────────┐
  │                                                                                     │
  │  Session ORCHESTRATEUR (Agent SDK, modèle opus)                                     │
  │   demarrage.ts → options-orchestrateur.ts (append MANDAT_ORCHESTRATEUR)             │
  │   surface d'action = UNIQUEMENT le serveur MCP « ccremote-controle »                │
  │        │                                                                            │
  │        │ outil creer_equipe → proposerCreationEquipe()  ◄── NE CRÉE RIEN            │
  │        │        (outils-cycle-vie.ts) : gardes + enregistre une PROPOSITION         │
  │        ▼                                                                            │
  │   Registre SQLite (missions, comptes, quotas, conversations, propositions)          │
  │        ▲                                                                            │
  │        │ le clic humain déclenche la route d'écriture →                             │
  │        │ dispatcherMandat()  ◄── SEUL endroit où une équipe est réellement créée    │
  │        │        (dispatch-mandat.ts) : choisit le compte, écrit la mission,         │
  │        │         compose le systemPrompt (mandate) + le 1er message,                │
  │        │         puis appelle le DÉMARREUR d'équipe                                  │
  └────────┼────────────────────────────────────────────────────────────────────────────┘
           │  DemandeDemarrageTransportable (texte + paramètres, jamais un objet SDK)
           │  transport D.1 / canal de contrôle D.3
           ▼
  ┌──────────────────────────── PC (ou VPS de repli) — superviseur ─────────────────────┐
  │  SuperviseurWorkers.demarrer()  (superviseur-workers.ts)                             │
  │   1. alloue le git worktree (fencing par epoch)                                      │
  │   2. GenerateurEntree + met le 1er message en file AVANT le spawn (piège H-60)       │
  │   3. startWorker() (workers/start-worker.ts) : préflight → resolveModelWithFloor →   │
  │      composeWorkerOptions() → sdkQuery({prompt, options}) → attend le message init   │
  │   4. #surveillerResultats() : UNIQUE lecteur du Query du worker                      │
  │        └─ télémétrie, anti-boucle (juge Haiku), politique de relance, apprentissage  │
  │                                                                                      │
  │  WORKER = 1 process + 1 session SDK + 1 worktree  = le « team leader »               │
  │        └─ ses propres SOUS-AGENTS (outil Task, N2), qu'il dimensionne lui-même       │
  └──────────────────────────────────────────────────────────────────────────────────────┘
```

Trois niveaux de hiérarchie, strictement : **N1 = l'orchestrateur** ; **une équipe = un worker/lead (N1→B)** ; **N2 = les sous-agents Task du lead**. L'orchestrateur ne possède PAS l'outil `Agent` (`options-orchestrateur.ts:OUTILS_INTERDITS_ORCHESTRATEUR = ['Bash','Write','Edit','Agent']`), donc il ne peut pas faire de N3 lui-même (commentaire H-10). Il n'agit QUE par son serveur MCP de contrôle.

**Frontière A↔B inexistante** (`harness/ARCHITECTURE.md`) : `control-plane/` (Pi) et `superviseur/`+`workers/` (PC) ne s'importent jamais. Tout passe par des ports composés dans `composition/`, et le seul lien entre le worker terminé et l'apprentissage est la lecture d'un transcript JSONL déjà écrit sur disque.

---

## 2. Cycle de vie d'un agent

### 2.1 L'orchestrateur (session unique, permanente)
- **Démarrage** : `control-plane/orchestrateur/processus/demarrage.ts:demarrerOrchestrateur()`. Séquence : résoudre l'identité (froid ou `resume`) → composer les Options → **pré-chauffer** (`startup()` du SDK) puis obtenir le `Query` → démarrer l'échantillonnage de contexte → réconcilier le registre contre le PC → rendre la poignée.
- `☠` **Ne consomme JAMAIS son propre `Query`** et **n'attend jamais le message `init`** : mesuré sur le SDK réel, `init` n'est émis qu'APRÈS un premier message utilisateur, et attendre l'aurait interbloqué au boot (Chris n'a pas encore parlé). Un `AsyncGenerator` n'a qu'un seul consommateur — c'est l'UI/banc qui lit `poignee.query`, jamais ce module.
- **Fin** : `poignee.fermer()` ferme le flux d'entrée, arrête la sentinelle de contexte, ferme le process SDK.

### 2.2 Une équipe (création en DEUX temps, règle H-61)
1. **Proposition** — `mcp-controle/outils-cycle-vie.ts:proposerCreationEquipe()`. L'outil `creer_equipe` **ne crée rien et ne dispatche rien** : il valide (budget, critère d'arrêt vérifiable, carburant frais, vague de trop, plafond de parc), construit une proposition et l'enregistre. L'orchestrateur ne peut que proposer.
2. **Dispatch réel** — `control-plane/orchestrateur/dispatch-mandat.ts:dispatcherMandat()`. `☠` « le seul endroit du harness où une équipe est réellement créée », déclenché par le **clic humain** (route d'écriture), jamais par un tour de l'orchestrateur. Ordre imposé : choix du compte (rotation sur saturation, `choisirCompteEquipe`) → vérif projet présent sur la machine → contrôle H-56/plafond git → **inscription de la mission au registre AVANT le démarrage** (sinon un worker vivant serait fantôme, panne #11) → `demarreur.demarrer()` → si échec, **rollback** de la mission → état `en_cours` seulement après démarrage confirmé.

### 2.3 Le worker (côté PC/VPS)
- **Spawn** : `superviseur/superviseur-workers.ts:demarrer()` → `workers/start-worker.ts:startWorker()`. Étapes bloquantes : préflight config → vérif worktree → `resolveModelWithFloor` → `composeWorkerOptions` → `sdkQuery({prompt, options})` → `pullInitMessage` (timeout 60 s, garde 50 messages avant `init`) → lecture des capacités depuis `SDKSystemMessage`.
- **Vie** : `#surveillerResultats()` est l'**unique lecteur** du `Query`. `☠` Un message `result` = fin d'un TOUR, **pas** fin de la session (streaming input) : tant qu'une tâche de fond vit, ou que le lead est `idle` en attente de ses sous-agents, la session reste ouverte. La mort est **constatée** (fin réelle du flux, arrêt explicite, ou coupure du juge), jamais déduite.
- **Fin** : `arreter()` (fermeture propre + fenêtre de grâce + libération du worktree) ou `tuerSansPreavis()`/`forcerArretUrgence()` (via l'`AbortController` propre au worker, jamais un signal OS par motif). À la conclusion réelle, une passe d'apprentissage est mise en file (si `CCREMOTE_APPRENTISSAGE_ACTIF=1`).
- **Relance** : `relancer()` en `resume` (jamais `forkSession`), idempotente (no-op si le worker est déjà vivant), backoff exponentiel.

### 2.4 Les sous-agents (N2)
Créés par le lead lui-même via l'outil `Task`, **dimensionnés par le lead** (`dispatch-mandat.ts:BLOC_DIMENSIONNEMENT`). Le harness ne les spawne pas et l'orchestrateur ne s'en occupe pas (`mandat.ts` : « Le lead dimensionne ensuite ses propres sous-agents ; tu n'as pas à t'en occuper »). L'option expérimentale « Agent Teams » existe par équipe via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (`workers/options-composition.ts:AGENT_TEAMS_ENV`, H-14).

---

## 3. Gestion du contexte

**Le contexte n'est PAS reconstruit ni réinjecté à chaque tour.** Le modèle qui gère le contexte est celui du SDK/CLI : une session persistante avec `autoCompactEnabled: true`. La discipline propre au harness porte sur *ce qui doit survivre à la compaction*.

- **Deux couches distinctes, décision mécanique** (`dispatch-mandat.ts:composerMandatSysteme` vs `composerPromptInitial`) :
  - Le **systemPrompt** (`options.systemPrompt = { type:'preset', preset:'claude_code', append: spec.mandate }`) **survit à la compaction** → il porte tout ce qui doit rester vrai au tour 50 : rôle, critère d'arrêt, périmètre, accès, budget, forme du rapport, outils MCP disponibles, règles de validation.
  - Le **premier message** ne survit PAS à la compaction → il est court et volontairement jetable. `☠` Historiquement le mandat ne vivait que dans le 1er message : un lead qui compactait perdait critère d'arrêt/accès/budget au moment où il en avait besoin.
- **Orchestrateur** : `MANDAT_ORCHESTRATEUR` (`processus/mandat.ts`) est appendé au preset ; « la SEULE chose qui apprenne à l'orchestrateur ce qu'il a le droit de faire — il ne lit pas ce dépôt ». Toute capacité MCP ajoutée/retirée doit être répercutée là le jour même (trois régressions mesurées d'outils annoncés absents ou d'outils morts encore cités).
- **Contexte partagé / dupliqué / re-audité** :
  - `☠` L'orchestrateur ne reçoit **jamais** le flux brut d'une équipe (H-45, garde `assertAucunFluxBrutSubagent` : `forwardSubagentText`/`agentProgressSummaries` interdits sur l'orchestrateur). `suivre_equipe` ne lui rend qu'un **échantillon borné** (10 lignes par défaut, 200 max), résumé ligne à ligne.
  - Le contexte d'un worker n'est **pas partagé** avec un autre : chaque worker est un process + une session SDK isolés, avec son `CLAUDE_CONFIG_DIR` par compte.
  - La **mémoire sémantique** (`mcp__semantic-memory__*`) est le seul contexte durable **partagé** entre l'humain, l'orchestrateur et les équipes, hors du canal SDK.
  - Chaque worker **re-explore son projet lui-même** (le mandat impose CodeIndex avant l'exploration manuelle) : il n'hérite d'aucun contexte projet de l'orchestrateur — celui-ci décrit le mandat en prose, jamais un dump de fichiers.
- **Sentinelle de contexte** (`discipline-contexte/sentinelle-contexte.ts`) : échantillonne l'usage de contexte (`getContextUsage()` via un port) + observe les compactions (hooks `PreCompact`/`PostCompact`), pour la jauge H-63 et le compte des compactions pathologiques. C'est de l'**observation**, pas de la reconstruction.

---

## 4. Modèles / API par rôle

Tout passe par le **même** `@anthropic-ai/claude-agent-sdk` (donc l'API Anthropic via le CLI embarqué). Aucun provider tiers dans l'orchestration. Configuration par rôle :

| Rôle | Modèle | Effort | Défini dans |
|---|---|---|---|
| **Orchestrateur** | `opus` (alias) | `high` | `processus/options-orchestrateur.ts:MODELE_ORCHESTRATEUR` / `EFFORT_ORCHESTRATEUR` |
| **Team leader (worker)** | `claude-opus-5` par défaut | `high` | `dispatch-mandat.ts:MODELE_LEAD_DEFAUT` / `EFFORT_LEAD_DEFAUT` |
| **Sous-agents (N2)** | héritent du modèle du lead si `model` omis dans `Task` | — | `dispatch-mandat.ts:BLOC_DIMENSIONNEMENT` (consigne au lead) |
| **Juge anti-boucle** | `claude-haiku-4-5-20251001` | aucun (Haiku refuse l'effort) | `anti-boucle/juge-haiku.ts:MODELE_JUGE_PAR_DEFAUT` |

- **Catalogue + validation** : `shared/modeles-claude.ts`. `normaliserModele()` accepte alias nu, id complet et formes en langage naturel (`sonnet 5`, `Opus 4.8`) — `☠` refus AVANT dispatch si non reconnu, parce que la valeur vient d'un LLM (panne réelle du 31/07 : `"sonnet 5"` avec espace passé tel quel au CLI, équipe morte 2 s après le spawn). Le catalogue est **un repli** ; l'autorité réelle est `supportedModels()` du SDK, qui dépend de la version du CLI embarqué (Opus 4.8 → Opus 5 au passage SDK 0.3.220).
- `☠` **Coût mesuré** : 6,40 $/équipe Opus contre 0,67 $/équipe Sonnet (mesure du 01/08). Un lead Opus qui lance des sous-agents sans préciser `model` lance des Opus (SDK : `AgentInput.model` optionnel, hérite du parent) — un site vitrine a coûté 52,93 $ ainsi.
- `☠` Les modèles/efforts sont **POSÉS** dans les Options, jamais laissés au défaut du CLI (un compte de repli portait `effortLevel: low`, dégradation muette du raisonnement).

---

## 5. Cadence des appels au modèle

**Il n'y a pas de file d'attente globale ni de rate-limiter central.** La cadence est régulée par des **gardes de création** (freins, jamais des tueurs) et une **rotation de comptes**, plus un plafond de parallélisme par projet. Le parallélisme est possible mais borné.

- **Gardes AVANT création** (`mcp-controle/outils-cycle-vie.ts:proposerCreationEquipe`, dans l'ordre) :
  1. `evaluerCritereArret` — refuse un critère invérifiable par l'équipe (mesuré : 34/393 mandats).
  2. `evaluerFraicheurCarburant` — refuse si le carburant du parc n'a pas été consulté depuis > 30 min.
  3. `evaluerVagueRecente` — refuse une 2e équipe sur un projet dans les 24 h, SAUF si un champ `campagne` est nommé (leçon : 1 159 $ de vagues répétées).
  4. `evaluerPlafondParc` → `budgets/plafond-parc.ts:deciderCreationMission` — refuse la création si toutes les fenêtres de quota d'un compte sont `rejected` (H-54) ou au-dessus du seuil `%` configuré. `☠` **Désactivé par défaut** (aucun seuil), et **ne peut que refuser une création**, jamais tuer une mission en cours (preuve par le type : `DecisionPlafondParc` ne porte aucun champ pour désigner une mission à terminer).
- **Plafond de parallélisme** (`dispatch-mandat.ts`) : `PLAFOND_EQUIPES_PROJET_GIT_DEFAUT = 4` équipes simultanées sur un projet git (une par worktree ; motifs : disque, VRAM 12 Go partagée, lisibilité de fusion). Un projet **non-git** = 1 seule équipe (H-56 strict). Le fencing par **epoch** (`superviseur-workers.ts`, `dispatch-mandat.ts:prochainEpoch`) empêche deux workers de coexister sur le même worktree.
- **Rotation de comptes** sur saturation (`choisirCompteEquipe` + `shared/saturation-compte.ts`) : `listerDisponibles()` exclut les comptes marqués `rejected`. Choix manuel de compte prioritaire (24/08). Consigne explicite : ne pas réessayer en boucle sur un compte saturé (bascule en surcoût payant, n'échoue pas proprement).
- **Backoff** (`relance/backoff.ts:delaiBackoffMs`) : exponentiel `1 s × 2^(n-1)`, plafonné à 60 s, uniquement pour la **relance après crash** (B.3.1). Politique de relance dans `relance/politique-relance.ts`, comptée par `compteur-relances.ts`.
- **Retry watchdog** (`budgets/garde-retry-watchdog.ts`) : `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget actif = consommation de quota non bornée → `assertRetryWatchdogCoherent` lève à la composition des Options (panne #15).
- **Budget par équipe** : `maxBudgetUsd` posé dans les Options SDK (coupure nette côté SDK), défaut `PLAFOND_EQUIPE_USD` (`shared/budget-equipe.ts`). Baisser coupe réellement ; monter ne repousse pas la coupure posée au démarrage.
- **Anti-boucle** (`anti-boucle/juge-haiku.ts`) : juge Haiku one-shot (`maxTurns:1`, `tools:[]`, `outputFormat: json_schema`), appelé seulement aux **paliers** de coût, biais asymétrique (un faux « boucle » détruit du travail → repli sur `incertain` sur toute panne). Ce n'est **pas** un plafond en $, c'est un détecteur de non-progrès.

---

## 6. Fichiers/modules pivots (chemins absolus)

**Orchestrateur (Pi) :**
- `/mnt/projects/ccremote/harness/control-plane/orchestrateur/processus/demarrage.ts` — démarrage de la session, séquence anti-interblocage.
- `/mnt/projects/ccremote/harness/control-plane/orchestrateur/processus/options-orchestrateur.ts` — Options SDK de l'orchestrateur (modèle opus, tools MCP-only, invariants).
- `/mnt/projects/ccremote/harness/control-plane/orchestrateur/processus/mandat.ts` — `MANDAT_ORCHESTRATEUR` (system prompt append).
- `/mnt/projects/ccremote/harness/control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts` — outils `creer_equipe`/`envoyer_a_equipe`/`interrompre_equipe`/`arreter_equipe`/`relancer_equipe`, gardes de création.
- `/mnt/projects/ccremote/harness/control-plane/orchestrateur/dispatch-mandat.ts` — **création réelle d'une équipe** après clic humain (H-61), composition du mandate/prompt initial.

**Worker (PC/VPS) :**
- `/mnt/projects/ccremote/harness/superviseur/superviseur-workers.ts` — parc de workers, spawn, unique lecteur du Query, relance, arrêt d'urgence, fencing.
- `/mnt/projects/ccremote/harness/workers/start-worker.ts` — séquence de démarrage d'un worker.
- `/mnt/projects/ccremote/harness/workers/options-composition.ts` — Options SDK d'un worker (`bypassPermissions`, hooks d'audit, MCP, budget).

**Transverses :**
- `/mnt/projects/ccremote/harness/shared/modeles-claude.ts` — catalogue + normalisation/validation des modèles.
- `/mnt/projects/ccremote/harness/anti-boucle/juge-haiku.ts` — juge Haiku.
- `/mnt/projects/ccremote/harness/budgets/plafond-parc.ts` + `/mnt/projects/ccremote/harness/budgets/garde-retry-watchdog.ts` — plafond de parc, garde watchdog.
- `/mnt/projects/ccremote/harness/relance/backoff.ts` + `politique-relance.ts` — backoff/relance.
- `/mnt/projects/ccremote/harness/discipline-contexte/sentinelle-contexte.ts` — échantillonnage/compaction de contexte.
- `/mnt/projects/ccremote/harness/composition/pi/` — assemblage du graphe réel (points d'entrée `bin-pi.ts`/`bin-pc.ts`).

---

## 7. Observations factuelles marquantes

1. **La création d'équipe est structurellement à deux temps, et l'outil de l'orchestrateur ne crée rien.** `creer_equipe` (`outils-cycle-vie.ts:proposerCreationEquipe`) n'enregistre qu'une proposition ; la seule création réelle est `dispatch-mandat.ts:dispatcherMandat`, sur la route d'écriture déclenchée par le clic humain (H-61). L'autonomie « sans clic » existe (fenêtres d'autonomie, plafond de mandats), mais elle passe par le même chemin de dispatch.

2. **La séparation systemPrompt / premier message est la vraie stratégie de contexte, et elle est mécanique.** `dispatch-mandat.ts:composerMandatSysteme` place tout ce qui doit survivre à la compaction dans le `systemPrompt` (les workers tournent en `autoCompactEnabled: true`), le premier message restant jetable. Le contexte n'est ni reconstruit par tour, ni réinjecté d'agent à agent ; chaque worker re-explore son projet seul.

3. **L'orchestrateur ne voit jamais le flux brut d'une équipe (H-45), garanti par un invariant exécutable.** `options-orchestrateur.ts:assertAucunFluxBrutSubagent` interdit `forwardSubagentText`/`agentProgressSummaries` sur l'orchestrateur, qui n'a pas non plus l'outil `Agent`. Sa seule fenêtre sur une équipe est un échantillon borné via `suivre_equipe` (10 lignes défaut, 200 max).

4. **Un `result` SDK n'est pas la fin d'une équipe — corrigé après des pertes de travail mesurées.** `superviseur-workers.ts:#surveillerResultats` garde la session ouverte tant qu'une tâche de fond vit ou que le lead est `idle` ; la mort est constatée (fin de flux, arrêt explicite, coupure du juge), jamais déduite du premier `result`. Le défaut inverse déclarait « terminée » une équipe dont 4 sous-agents s'arrêtaient net.

5. **La cadence repose sur des freins de création + rotation de comptes, pas sur une file globale ; le parallélisme est réel mais borné.** Gardes carburant/vague/plafond-parc dans `proposerCreationEquipe`, plafond de 4 équipes git simultanées par projet (1 pour non-git, H-56), fencing par epoch, backoff exponentiel plafonné à 60 s pour la relance seule. `budgets/plafond-parc.ts` ne peut que refuser une création, jamais tuer une mission en cours (preuve par le type). Le plafond de parc est désactivé par défaut.

**Note transverse (leitmotiv du code, non demandé mais structurant)** : le harness est truffé de garde-fous exécutables (`assert*Invariants`) posés après des pannes réelles récurrentes du motif « écrit, testé, branché sur rien » — une règle qui existait mais n'était câblée sur aucun chemin de production (plancher de déni, MCP des workers, audit des permissions, thinking `display`). Les invariants sont la parade retenue : valider à la composition, avant la première écriture.
