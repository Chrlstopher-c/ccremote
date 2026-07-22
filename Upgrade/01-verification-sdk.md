# Vérification SDK — faits établis

**Méthode** : `npm install @anthropic-ai/claude-agent-sdk` puis lecture directe de `sdk.d.ts` (7096 lignes), `bridge.d.ts`, `browser-sdk.d.ts`. Croisé avec la documentation officielle. Ce qui suit est vérifié, pas mémorisé.

**Version de référence** : SDK `0.3.217`. Le SDK embarque le binaire Claude Code correspondant en dépendance optionnelle par plateforme. **Épingler cette version** dans le `package.json` du harness : plusieurs API listées ici sont alpha et bougeront.

Plateformes disponibles en optionalDependencies : `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`.
→ **`linux-arm64` existe : le Pi peut exécuter le binaire.** Ce n'est pas la conception retenue (le Pi reste control plane), mais ça débloque le mode dégradé « le PC est éteint ».

---

## Découverte 1 — Claude Code a déjà des « équipes », et leur limite définit ton harness

Claude Code embarque une fonctionnalité **Agent Teams**, expérimentale, désactivée par défaut, qu'on active avec `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Une session joue le rôle de *team lead* ; elle spawn des *teammates* qui sont des instances Claude Code séparées, chacune avec sa propre fenêtre de contexte, capables de **se parler entre elles** via un système de boîtes aux lettres et de partager une liste de tâches. C'est plus que les subagents : les subagents ne peuvent que rapporter à l'agent principal, sans communication latérale.

Traces dans le SDK confirmant que c'est bien câblé : les hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` sont dans `HOOK_EVENTS`, et `TeammateIdleHookInput` expose `teammate_name`.

**Mais** — et c'est le point qui structure tout le reste — les contraintes documentées sont :

- **une seule équipe active par session** ;
- **pas d'équipes imbriquées** : un teammate ne peut pas créer sa propre sous-équipe ;
- le lead est fixé à la création et ne peut pas changer en cours de session ;
- les permissions d'un teammate sont fixées au spawn, sans escalade ultérieure.

Ton modèle mental est : orchestrateur → équipes → sous-agents de chaque équipe. **Trois niveaux.** Le natif en donne deux, et un seul groupe par session.

**Conséquence directe, et c'est la bonne nouvelle** : la couche qui manque est exactement celle que tu veux construire. La répartition devient nette et non négociable :

| Niveau | Qui le fournit | Mécanisme |
|---|---|---|
| **N1** — plusieurs projets, plusieurs équipes, en parallèle, à distance | **Ton harness** | N sessions Claude Code indépendantes, une par équipe/projet |
| **N2** — coordination interne à une équipe | Claude Code (natif, ⚠ ALPHA) | Agent Teams, ou simple session solo si tu ne veux pas d'expérimental |
| **N3** — délégation dans une équipe | Claude Code (natif, stable) | Subagents via l'outil `Agent`, option `agents` |

Ton harness ne doit **rien réimplémenter** de N2 et N3. Il possède N1 et seulement N1. Toute mission qui commence à recoder de la messagerie inter-agents est hors sujet — remonter.

`⚠ HYP` : je pars du principe que tu acceptes N2 en expérimental. Si tu refuses, chaque équipe devient une session solo avec subagents — le harness ne change pas, seul le contenu d'une équipe change. Décision réversible, isolée dans la branche F.

---

## Découverte 2 — Anthropic a déjà résolu ton problème de contrôle distant, et le code est lisible

L'export `@anthropic-ai/claude-agent-sdk/bridge` est le protocole worker-distant d'Anthropic : c'est ce qui permet à claude.ai de piloter un Claude Code qui tourne sur ta machine.

**Tu ne peux pas l'utiliser tel quel** — il route par les serveurs d'Anthropic (`POST /v1/code/sessions`, OAuth, JWT worker, notion de *trusted device*), il est marqué `@alpha` avec un avertissement explicite que les ruptures ne bumpent pas la version majeure, et ton besoin est LAN pur. **Mais c'est la meilleure spécification de référence disponible** pour ce que tu construis, écrite par les gens qui ont le plus itéré dessus.

Les patterns à copier, tirés de `BridgeSessionHandle` et `AttachBridgeSessionOptions` :

1. **Numéro de séquence + high-water mark.** `getSequenceNum()` suit le flux d'événements ; on le persiste et on le repasse en `initialSequenceNum` à la reconnexion, et le serveur **reprend** au lieu de rejouer tout l'historique. → branche D.
2. **Epoch de worker.** `getEpoch()` / `reconnectTransport({epoch})`. Le code d'erreur `4090` signifie « epoch dépassé — tu n'es plus le worker actif ». C'est un mécanisme de *fencing* : il empêche deux workers de revendiquer la même session après un split. → branche D.
3. **Trois états de session, pas deux.** `SessionState = 'idle' | 'running' | 'requires_action'`. `requires_action` est l'état « bloqué sur une permission ». C'est **l'état central de ton UI mobile** : c'est le seul qui exige que tu sortes ton téléphone. → branches E et F.
4. **Le rejet d'une réponse de permission la garde éligible au redélivrage.** `onPermissionResponse` retourne `false` quand la réponse est malformée ou forgée, et la demande **reste éligible à la redélivrance par `initialize`**. Retourner `void` = acceptée. → branche C.
5. **Annulation explicite d'une demande.** `sendControlCancelRequest(requestId)` dit à l'interface distante de retirer une invite de permission devenue caduque — typiquement quand le tour a été interrompu localement avant que tu répondes. Sans ça, ton téléphone accumule des invites zombies. → branche C.
6. **Mode miroir.** `outboundOnly: true` : le flux sort vers l'interface distante, mais le flux entrant n'est pas ouvert et les requêtes de contrôle répondent par une erreur plutôt qu'un faux succès. → « observer sans pouvoir piloter », branche F.
7. **Accusés de réception à trois temps.** `reportDelivery(eventId, 'processing' | 'processed')`, l'état `received` étant émis automatiquement. → branche E.
8. **Distinction ferme entre échec transitoire et terminal.** Les déconnexions passagères (503, coupures réseau) sont réessayées indéfiniment **à l'intérieur** du transport et ne remontent pas ; `onClose` n'est appelé que pour du définitif. Les échecs d'authentification terminaux sont typés (`terminal: true` + une raison), avec la règle « réessayer avec les mêmes entrées échouera à l'identique ». → branche D.

`⚠ HYP` : je considère `/bridge` comme documentation, pas comme dépendance. Si tu voulais un jour piloter depuis claude.ai plutôt que depuis ta propre UI, ça redeviendrait une dépendance — et ça invaliderait la branche D entière. Décision **structurante**, à trancher maintenant.

---

## Découverte 3 — le point d'extension distant est `spawnClaudeCodeProcess`, pas `Transport`

`Transport` est une interface exportée, et elle a l'air d'être ce qu'on veut (`write`, `readMessages`, `close`, `isReady`). **Elle n'est pas branchable via `Options`** : il n'y a pas de champ `transport` dans `Options`. Ne pas construire l'archi dessus.

Le point d'extension réel est `spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess`. Le contrat vérifié :

- **Entrée** `SpawnOptions` : `command`, `args`, `cwd?`, `env`, `signal`.
- **Sortie** `SpawnedProcess` : `stdin` (`Writable`), `stdout` (`Readable`), `killed`, `exitCode`, `signalCode?`, `kill(signal)`, plus `on`/`once`/`off` pour `'exit'` et `'error'`.

Autrement dit : **si tu peux fournir une paire de flux stdin/stdout, le SDK ne sait pas que le processus est sur une autre machine.** C'est ça, ton pont Pi→PC. Tu n'écris pas de protocole : tu transportes deux flux.

`☠ CASSE` — le `signal` reçu dans `SpawnOptions` **n'est pas** celui de ton `abortController`. C'est un signal relayé, propriété du transport interne, qui ne se déclenche **qu'après** le chemin d'arrêt gracieux du SDK : fermeture de stdin, puis une fenêtre de grâce d'environ 2 secondes. Tout ce que tu accroches dessus (kill, teardown de conteneur, annulation de requête) part **après** que l'enfant a eu sa chance de s'arrêter proprement. Si tu as besoin du signal immédiat, c'est l'`AbortController` que tu as passé toi-même en `Options.abortController`, à capturer en closure.

Deuxième piège documenté : le spawn local intégré ne délivre `'exit'` qu'après fermeture de stderr, ce qui garantit une trace stderr complète dans l'erreur de sortie. **Une implémentation custom de `spawnClaudeCodeProcess` émet un exit nu.** Si ton worker distant ne rapatrie pas stderr, tes crashes seront muets. → branche B.

---

## Inventaire vérifié — ce qui existe et que le harness ne doit pas réécrire

**Sessions** : `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession`, `tagSession`, `forkSession`, `deleteSession`, `foldSessionSummary`, `importSessionToStore`.
→ `listSessions({dir})` avec `includeWorktrees: true` par défaut remonte les sessions de **tous les worktrees** d'un dépôt git. Ton inventaire multi-projets est en grande partie déjà là.

**Subagents** : `listSubagents(sessionId, options?)`, `getSubagentMessages(...)`.
→ **L'introspection des sous-agents est fournie.** Vue « qui travaille sur quoi à l'intérieur d'une équipe » : ne pas réimplémenter.
→ `SessionMessage` porte `parent_tool_use_id` et `parent_agent_id` pour reconstruire l'arbre d'exécution. `parent_agent_id` (subagents imbriqués) exige Claude Code v2.1.202+.

**Persistance externe** : type `SessionStore` + classe `InMemorySessionStore` fournie. Contrat vérifié : `append(key, entries)` appelé **après** que l'écriture locale a réussi (la durabilité est déjà garantie localement), par lots à cadence ~100 ms pendant les tours actifs ; `load(key)` appelé **une seule fois, dans le parent SDK, avant le spawn** ; `listSessions?(projectKey)` optionnel — s'il est absent, `listSessions()` avec un `sessionStore` **lève**.
→ Règle d'idempotence explicite : la plupart des entrées portent un `uuid` stable, à traiter comme **clé d'idempotence** (upsert / ignore-doublon), sinon les rejeux d'`importSessionToStore()` dupliquent. Les entrées sans `uuid` (titres, tags, marqueurs de mode) s'ajoutent sans dédup.
→ Politique d'échec : rejet réessayé 3 fois avec backoff court ; **timeout de 60 s non réessayé** car l'appel en vol peut encore aboutir. Après échec final, le lot est **abandonné** et un message système `mirror_error` est émis. **Le sous-processus continue.** → ton mirroring est best-effort par conception ; le traiter comme source de vérité est une erreur. → branche E.

**Persistance externe — complément vérifié en seconde passe** (utilisé par la branche H) :

- `foldSessionSummary(prev, key, entries, {mtime?})` (⚠ ALPHA) — appelée **par le store, depuis l'intérieur d'`append()`**, pour maintenir un sidecar `SessionSummaryEntry` à jour **sans relire le transcript**. Le champ `data` est un blob **opaque appartenant au SDK** : à persister **verbatim**, à ne **jamais** interpréter.
- Champs figés à la première apparition : `isSidechain`, `createdAt`, `cwd`, `firstPrompt`. Champs à dernier-gagne : `customTitle`, `aiTitle`, `lastPrompt`, `summaryHint`, `gitBranch`, `tag`.
- `☠` `mtime` **n'est pas dérivé des horodatages d'entrées.** L'adaptateur doit l'estampiller au moment de la persistance, avec la **même source d'horloge** que le `mtime` de `listSessions()`. Les horodatages d'entrées et les temps d'écriture diffèrent par lotissement et latence ; les confondre **annule le contrôle de fraîcheur**.
- `foldSessionSummary` est **pure** ; la maîtrise de la concurrence appartient au store. Si des `append()` peuvent entrer en concurrence sur la même session, le cycle lire-plier-écrire doit être sérialisé (transaction, CAS, ou verrou par session).
- `listSessionSummaries?(projectKey)` — quand elle est implémentée, `listSessions({sessionStore})` lit toutes les métadonnées en **un aller-retour** ; sinon, repli sur `listSessions()` + un `load()` par session.
- `delete?(key)` — **optionnelle. Si elle n'est pas définie, la suppression est un no-op silencieux**, comportement adapté aux backends WORM ou append-only comme S3.
- `☠` `listSubkeys?(key)` — liste les clés de sous-chemins d'une session, c'est-à-dire **les transcripts de sous-agents**. Utilisée à la reprise pour les découvrir et les matérialiser. **Si elle n'est pas définie, la reprise ne matérialise que le transcript principal** — une mission reprise perd donc tout l'historique de ses sous-agents, sans erreur.
- `loadTimeoutMs` (défaut 60000, ⚠ ALPHA) borne **chaque** appel à `load()` et `listSubkeys()` pendant la matérialisation de reprise. Hors fenêtre, la requête **échoue au lieu de rester suspendue**. Ignoré si `sessionStore` n'est pas défini.

**Modification de settings en session — complément vérifié** (utilisé par F2.3.2) :

`applyFlagSettings()` (TypeScript uniquement, absent du SDK Python) n'a pas le même effet selon la clé :
- **Au tour suivant** : `effortLevel`, `ultracode`, `permissions`, `hooks`, `skillOverrides`, `fastMode`, `agent`. Changer `agent` applique aussi le modèle, les hooks et le prompt système de cet agent.
- **Pendant le tour courant** : `model`.
- `☠` **Aucun effet en session** : les options de prompt système, résolues une fois au démarrage. **L'appel réussit mais la valeur ne change pas.** Changer un mandat exige une nouvelle session.
- Les appels successifs **fusionnent en surface** les clés de premier niveau : un second appel avec `{permissions: {...}}` **remplace entièrement** l'objet du premier au lieu de fusionner en profondeur. `null` retire une clé et fait retomber sur les sources de moindre précédence ; `undefined` n'a aucun effet, la sérialisation JSON le supprime.

 : `interrupt()`, `stopTask(taskId)`, `backgroundTasks(toolUseId?)`, `setModel()`, `setPermissionMode()`, `setMcpPermissionModeOverride(serverName, mode)`, `applyFlagSettings()`, `getContextUsage()`, `readFile()`, `reloadSkills()`, `reloadPlugins()`, `reinitialize()`, `streamInput()`, `close()`.
→ `getContextUsage()` répond directement à ton inquiétude sur la saturation du contexte de l'orchestrateur : c'est mesurable, pas à deviner. → branche E.
→ `setMcpPermissionModeOverride` épingle un mode auto-allow **par serveur MCP**, et ne peut jamais élargir un privilège. Utile pour auto-approuver tes propres outils de contrôle sans ouvrir le reste. → branche C.

**Hooks — 30 événements vérifiés** : `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `MessageDisplay`.
→ `WorktreeCreate` / `WorktreeRemove` existent, avec `WorktreeCreateHookSpecificOutput.worktreePath`. **L'isolation par worktree est un citoyen de première classe**, pas un bricolage. → branche F.
→ `PermissionRequest` et `PermissionDenied` sont des hooks distincts de `canUseTool`. → branche C.

**Diagnostic** : `TerminalReason` énumère les causes d'arrêt de boucle — dont `budget_exhausted`, `max_turns`, `prompt_too_long`, `hook_stopped`, `blocking_limit`, `rapid_refill_breaker`, `aborted_tools`, `background_requested`, `turn_setup_failed`.
→ **Ne pas inventer ta propre taxonomie d'échec.** Mapper la sienne. → branche E.
→ Les constantes `USAGE_LIMIT_ERROR_PREFIXES`, `USAGE_TRANSITION_PREFIXES`, `USAGE_WARNING_PREFIXES` sont exportées (⚠ ALPHA) pour classer les messages de limite d'usage. Ça évite de parser des chaînes à la main. → branche G.

**Bacs à sable** : `SandboxSettings` avec `SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxCredentialsConfig`, `SandboxIgnoreViolations`. → branche G.

---

## Réfuté — hypothèses que j'ai dû corriger

| Cru | Vérifié |
|---|---|
| L'API V2 `send()`/`stream()` simplifie le multi-tours | **Supprimée** en SDK 0.3.142. `unstable_v2_createSession`, `unstable_v2_resumeSession`, `unstable_v2_prompt`, `SDKSession` n'existent plus. Utiliser `query()` + `AsyncIterable<SDKUserMessage>`, ou `options.resume`. Des articles de 2026 la recommandent encore. |
| `Transport` est branchable pour faire du distant | Exportée, mais **absente d'`Options`**. Le point d'extension est `spawnClaudeCodeProcess`. |
| Il faut construire la hiérarchie d'équipes de zéro | Deux des trois niveaux sont natifs. Le harness ne possède que N1. |
| tmux comme canal de contrôle | À bannir comme canal. **Mais** Agent Teams sait utiliser des panneaux tmux comme mode d'affichage — donc tmux reste légitime en *observabilité*, jamais en *contrôle*. |

---

## Points versionnés à revérifier avant implémentation

Ces comportements sont conditionnés à une version minimale de Claude Code. Le SDK suit le binaire au patch près (SDK `0.3.191` embarque CC `2.1.191`), donc un SDK `0.3.217` embarque CC `2.1.217` et les couvre tous — **mais** si un agent épingle une version plus ancienne, ça casse en silence :

- `requestId` sur `canUseTool` + retour `null` pour réponse hors-bande → **CC v2.1.199+**
- `reinitialize()` → **CC v2.1.195+**
- Reçu d'interruption (`SDKControlInterruptResponse.still_queued`, capacité `interrupt_receipt_v1`) → **CC v2.1.205+**
- `parent_agent_id` sur les messages de subagents imbriqués → **CC v2.1.202+**
- `setMcpServers` préservant les serveurs fournis par plugins → **CC v2.1.210+**
- Bascule de modèle en cours de tour → **CC v2.1.212+**
- Agent Teams sans étape de setup, `TeamCreate`/`TeamDelete` supprimés → **CC v2.1.178+**
- Outil `Workflow` → **SDK v0.3.149+**

**Mission de vérification** : au démarrage, le harness lit la capacité annoncée dans `SDKSystemMessage.capabilities` plutôt que de supposer. → branche E.
