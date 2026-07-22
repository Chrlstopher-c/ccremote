# Branche B — Superviseur de workers (PC)

**Profondeur atteinte : 4** sur le cycle de vie et la pause, **2** sur le provisioning (hors périmètre).

**Responsabilité unique** : faire naître, vivre et mourir des processus Claude Code, et exposer leurs flux. **Ne décide rien.** N'interprète pas les flux, ne juge pas des permissions, n'a pas d'opinion sur les équipes.

---

## B.1 — Cycle de vie d'un worker

### B.1.1 Définition `⊣ TERMINAL`

Un **worker** = un processus Node hébergeant une session Agent SDK, dédié à une équipe, attaché à un worktree (H-11, H-20).

Ce qu'il possède : un `sessionId` fixé par le Pi (jamais auto-généré — sinon irretrouvable après redémarrage), un `cwd` = son worktree, sa configuration de permissions, son budget, sa paire de flux vers le Pi.

Ce qu'il ne possède pas : la connaissance des autres workers. Un worker ignore l'existence du parc. Toute coordination inter-équipes passe par le Pi.

### B.1.2 Séquence de démarrage `⊣ TERMINAL`

Ordre imposé, chaque étape bloquante pour la suivante :

1. **Pré-vol config** — `resolveSettings({cwd: worktree})` (⚠ ALPHA). Vérifier que `user`/`project`/`local` sont bien chargés et que le `CLAUDE.md` machine est visible. **Échec ⇒ ne pas spawner**, remonter au Pi. Sans ça, une config absente produit un agent qui ignore les conventions du poste sans que rien ne le signale (H-44).
2. **Vérification worktree** — existe, propre, sur la bonne branche, non revendiqué par un autre worker vivant. Délègue à F.2.
3. **Résolution du modèle** — appliquer le plancher Sonnet **après** résolution de l'alias (H-43, `☠` sur `inherit`).
4. **Composition des options** — voir B.1.3.
5. **Spawn** — via `startup()` si l'équipe est créée à l'avance, sinon `query()` direct.
6. **Attente d'initialisation** — lire `SDKSystemMessage`, en extraire `capabilities`. **Ne pas supposer les versions** ; ce message est la source de vérité sur ce que le binaire sait faire (voir la liste versionnée en `01`).
7. **Annonce au Pi** — état `idle`, capacités, `sessionId` confirmé.

`☠ CASSE` — sauter l'étape 1 ou 6 produit des pannes qui ne se manifestent que des heures plus tard, sous forme de comportement dégradé sans erreur.

### B.1.3 Composition des options `⊣ TERMINAL`

Ce que le harness fixe (structurel, écrase le PC — H-44) :

| Clé | Valeur | Motif |
|---|---|---|
| `sessionId` | fixé par le Pi | retrouvabilité |
| `cwd` | worktree de l'équipe | isolation (H-11) |
| `permissionMode` | `'auto'` | arbitrage délégué au lead (H-40) |
| `disallowedTools` | plancher irréversible, motifs **scopés** | H-41 |
| `maxBudgetUsd` | budget de l'équipe | G.1 |
| `model` | ≥ Sonnet, résolu | H-43 |
| `systemPrompt` | preset `claude_code` + `append` du mandat | H-44 |
| `settingSources` | **jamais `[]`** | H-44 |
| `includePartialMessages` | `true` | temps réel (H-45) |
| `forwardSubagentText` | `true` | arborescence des sous-agents |
| `agentProgressSummaries` | `true` | résumés d'une ligne |
| `sessionStore` | adaptateur vers le Pi | E.3 |
| `abortController` | conservé **en closure** | `☠` voir B.3.2 |
| `env` | `{...process.env, ...}` | `☠` voir ci-dessous |
| `stderr` | callback de capture | `☠` voir B.2.3 |

`☠ CASSE` sur `env` — quand `env` est fourni, il **remplace** l'environnement du sous-processus au lieu de fusionner. Omettre `...process.env` fait perdre `PATH` et tout le reste. Symptôme : le worker ne trouve plus git, node, ou les credentials.

Ce que le harness **ne fixe pas**, laissé au PC : style de sortie, hooks locaux, serveurs MCP du projet, skills, plugins, thinking, effort. Une mission qui ajoute une clé à la colonne de gauche doit justifier pourquoi elle est structurelle.

`⚠ HYP` — Agent Teams (N2) s'active par `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` dans `env`, **par équipe** (H-14). Une équipe critique tourne sans, à cause des limitations connues sur la reprise de session.

### B.1.4 Indépendance vis-à-vis du Pi `⊣ TERMINAL`

Les workers **ne sont pas des enfants du processus orchestrateur**. Le Pi peut redémarrer sans tuer les équipes en cours.

Conséquence : le superviseur est un service permanent du PC, avec son propre état sur disque (quelles équipes, quels PID, quels worktrees). Au retour du Pi, c'est le **PC qui fait autorité** sur ce qui tourne réellement (A.4.2).

### B.1.5 Terminaison `⊣ TERMINAL`

Trois voies, à ne pas confondre :

- **Arrêt propre** — `close()`. Ferme stdin, fenêtre de grâce ~2 s, le CLI exécute son arrêt gracieux. **Voie par défaut.**
- **Interruption de tour** — `interrupt()`. La session survit. Voir B.4.
- **Mise à mort** — `kill(signal)` sur le `SpawnedProcess`. Dernier recours, après échec de l'arrêt propre.

`☠ CASSE` — le spawn local intégré ne délivre `'exit'` qu'**après fermeture de stderr**, ce qui garantit une trace stderr complète dans l'erreur de sortie. **Une implémentation custom de `spawnClaudeCodeProcess` émet un exit nu.** Le superviseur doit donc rapatrier stderr lui-même, sinon les crashes sont muets (B.2.3).

---

## B.2 — Exposition des flux

### B.2.1 Le contrat `spawnClaudeCodeProcess` `⊣ TERMINAL`

Point d'extension unique pour le distant (Découverte 3). Contrat vérifié :

**Entrée** `SpawnOptions` : `command`, `args`, `cwd?`, `env`, `signal`.
**Sortie** `SpawnedProcess` : `stdin` (`Writable`), `stdout` (`Readable`), `killed`, `exitCode`, `signalCode?`, `kill(signal)`, `on`/`once`/`off` pour `'exit'` et `'error'`.

Le superviseur produit cet objet. Que le processus soit local ou distant est **invisible pour le SDK**.

### B.2.2 Le piège du signal `⊣ TERMINAL` `☠ CASSE`

Le `signal` reçu dans `SpawnOptions` **n'est pas** celui de ton `abortController`. C'est un signal relayé, propriété du transport interne, qui ne se déclenche qu'**après** le chemin d'arrêt gracieux : fermeture de stdin, puis grâce d'environ 2 s.

Raison documentée : passer le signal brut de l'appelant à `spawn()` de Node enregistre l'écouteur d'abort de Node qui appelle `child.kill()` — sous Windows c'est `TerminateProcess`, instantané et non interceptable — et comme les écouteurs d'`AbortSignal` se déclenchent synchroniquement dans l'ordre d'enregistrement, ça devancerait le chemin stdin-EOF + grâce, et l'arrêt gracieux du CLI ne s'exécuterait jamais.

**Règle** : accrocher le teardown lourd (kill distant, fermeture de tunnel) au `signal` de `SpawnOptions`. Pour un arrêt immédiat sans grâce, utiliser l'`AbortController` passé en `Options.abortController`, **capturé en closure**.

### B.2.3 Stderr `⊣ TERMINAL`

`SpawnedProcess` n'expose **pas** stderr — seulement stdin et stdout. Le callback `stderr` d'`Options` reste le canal de diagnostic.

Conséquences :
- Le superviseur doit rapatrier stderr du processus distant **par une voie séparée** du flux principal.
- Une erreur de hook (`Error: Stream closed`, cf. A.1.3) n'apparaît **que** là. Sans capture stderr, ce défaut est invisible.
- Les erreurs de sortie peuvent être précédées d'une longue ligne de source SDK minifiée — **lire jusqu'à la fin** de la sortie pour trouver le texte d'erreur.

---

## B.3 — Résilience du worker

### B.3.1 Timeouts et watchdogs `⊣ TERMINAL`

Variables d'environnement vérifiées, à passer via `env` :

| Variable | Défaut | Usage harness |
|---|---|---|
| `API_TIMEOUT_MS` | 600000 | timeout par requête, s'applique au principal et aux subagents |
| `CLAUDE_CODE_MAX_RETRIES` | 10 (plafond 15) | pire cas ≈ `API_TIMEOUT_MS × (retries+1)` + backoff |
| `CLAUDE_CODE_RETRY_WATCHDOG=1` | — | réessaie les erreurs de capacité **indéfiniment** ; depuis CC v2.1.199 porte le défaut des autres erreurs transitoires à 300 et **supprime le plafond**. Pour du non-surveillé nocturne. |
| `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | 600000 | watchdog des subagents `run_in_background`. Se réarme à chaque événement ; à l'expiration, avorte le subagent, marque la tâche échouée, remonte au parent avec le résultat partiel. **Ne s'applique pas aux subagents synchrones.** |
| `CLAUDE_ENABLE_STREAM_WATCHDOG` / `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | actif / 300000 (plancher) | avorte quand les en-têtes sont arrivés mais que le corps cesse de streamer. Passe par le chemin de retry normal. |

`⚠ HYP` — `CLAUDE_CODE_RETRY_WATCHDOG=1` est recommandé pour l'usage nocturne, mais il retente indéfiniment. Sans plafond de budget actif (G.1), c'est un risque de dépense. **Les deux vont ensemble ou aucun.**

### B.3.2 Classification des sorties `⊣ TERMINAL`

Ne **pas** inventer de taxonomie. `TerminalReason` est vérifié et exhaustif :

`blocking_limit`, `rapid_refill_breaker`, `prompt_too_long`, `image_error`, `model_error`, `api_error`, `malformed_tool_use_exhausted`, `aborted_streaming`, `aborted_tools`, `stop_hook_prevented`, `hook_stopped`, `tool_deferred`, `max_turns`, `background_requested`, `completed`, `budget_exhausted`, `structured_output_retry_exhausted`, `tool_deferred_unavailable`, `turn_setup_failed`.

Groupement pour la décision de relance :

| Groupe | Raisons | Action |
|---|---|---|
| Fin normale | `completed` | rien |
| Borne atteinte | `max_turns`, `budget_exhausted` | remonter, ne pas relancer seul |
| Volontaire | `aborted_streaming`, `aborted_tools`, `hook_stopped`, `stop_hook_prevented`, `background_requested` | rien |
| Transitoire | `api_error`, `model_error`, `turn_setup_failed` | relance avec `resume`, backoff, compteur |
| Structurel | `prompt_too_long`, `malformed_tool_use_exhausted`, `structured_output_retry_exhausted` | **ne pas relancer** — relancer reproduit l'échec |
| Quota | `blocking_limit`, `rapid_refill_breaker` | attendre, voir G.2 |

`☠ CASSE` — relancer automatiquement un échec structurel produit une boucle qui consomme du budget sans jamais aboutir. C'est le mode de défaillance le plus coûteux d'un parc non surveillé.

### B.3.3 Redémarrage `⊣ TERMINAL`

Relance = nouveau processus + `resume: sessionId`. Le contexte est préservé.

`forkSession: true` **uniquement** si l'on veut une branche d'exploration sans polluer la session d'origine. Par défaut : `false`, on continue la même session.

Compteur de relances par équipe, avec plafond. Au plafond : état `echec_definitif`, notification, **pas de nouvelle tentative**.

---

## B.4 — Pause et reprise `⊣ TERMINAL`

`☠` **Il n'existe aucune primitive de suspension** (H-46). Ce qui suit est une construction.

### Mécanique

**Mettre en pause** :
1. Marquer l'équipe `en_pause` dans le registre — **avant** d'interrompre, sinon une course fait repartir un message en file.
2. `interrupt()`. Lire le reçu.
3. Le reçu (`SDKControlInterruptResponse.still_queued`) liste les UUID des messages utilisateur qui **survivent** à l'interruption : ceux encore en file, plus un lot éventuellement déjà sorti pour le tour suivant mais hors d'atteinte de l'abort. Chacun s'exécutera comme son propre tour si on ne l'annule pas.
4. Retenir la file d'entrée locale : ne plus rien pousser dans le générateur.

**Caveats vérifiés sur le reçu** :
- Seuls les messages **enregistrés avec un UUID** apparaissent. Une liste vide **ne signifie pas** que rien d'autre ne s'exécutera.
- Seuls les messages du fil principal sont listés. Ceux adressés à un subagent sont hors périmètre.
- La liste peut contenir des UUID que le client n'a jamais envoyés (déclencheurs de tâches planifiées, par ex.). **Ignorer les inconnus**, ne pas traiter comme erreur.
- Le reçu est un instantané pris au moment du traitement de l'interruption, et arrive **avant** le `SDKResultMessage` du tour interrompu sur une interruption propre. **Lire le reçu**, ne pas inspecter la file après le résultat : la boucle démarre le tour suivant immédiatement, donc la file inspectée après a déjà changé.
- Sur un CLI antérieur à v2.1.205, `interrupt()` résout `undefined`. Vérifier `interrupt_receipt_v1` dans `SDKSystemMessage.capabilities` ; sinon, mode dégradé sans garantie.

**Reprendre** : lever le drapeau, relâcher la file. Ne **pas** renvoyer un message listé dans `still_queued` — ça produit un tour dupliqué.

**Test d'acceptation** : mettre en pause pendant un tour actif, attendre 5 minutes, reprendre, vérifier qu'aucune instruction n'est perdue **ni dupliquée**.

---

## B.5 — Provisioning `⊣ HORS-PÉRIMÈTRE`

Installation de l'OS, service systemd, démarrage automatique, mises à jour, réveil de la machine.

**Pourquoi exclu** : dépend d'un environnement que je ne peux pas inspecter, et n'a aucune conséquence sur l'architecture. À traiter comme tâche d'exploitation.

**Exigences que le provisioning doit satisfaire**, en revanche :
- Le superviseur redémarre automatiquement et retrouve son état.
- Les workers **survivent** au redémarrage du superviseur, ou sont proprement réconciliés.
- Le PC est joignable sur le LAN à une adresse stable.
- `⚠ HYP` H-30 non résolue : PC toujours allumé, ou faut-il un mode « équipes en attente de machine » ? Impacte D.
