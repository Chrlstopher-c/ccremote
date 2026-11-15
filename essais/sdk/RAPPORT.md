# Essai : le Claude Agent SDK reproduit-il la config de Claude Code ?

Date : 2026-11-15. SDK : `@anthropic-ai/claude-agent-sdk` 0.3.325 (CLI embarquée 2.1.325).
Référence : `claude` 2.1.323 lancé depuis ce dossier (`-p --no-session-persistence`).
Modèle : `claude-haiku-5-5`. Auth : abonnement (`apiKeySource: none`), `ANTHROPIC_API_KEY` absente.

**Requêtes modèle consommées : 8 / 8** (pilote SDK 1, CLI 1, multi-tours 3, reprise 2, test CLAUDE.md 1).

Limite : référence = CLI lancée depuis une session Claude Desktop (env héritée) ; terminal de Chris et Desktop non mesurés.

Env identique pour SDK et CLI. Variables retirées (noms seuls) : `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_HOST_SESSION_ID`,
`CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PID`, `CLAUDE_AGENT_SDK_VERSION`.
Gardées : `ANTHROPIC_BASE_URL` (héritée) et les variables Desktop.

## 1. Tableau élément / CLI / SDK

| Élément | CLI 2.1.323 | SDK 0.3.325 | Identique ? |
|---|---|---|---|
| Modèle, cwd, permissionMode, apiKeySource | haiku-5-5, dossier essais/sdk, bypass, none | idem | oui |
| Version du binaire | 2.1.323 | 2.1.325 (binaire embarqué par défaut) | **non** |
| Settings user/project/local | chargés (défaut) | chargés (settingSources omis = tous) | oui |
| Hooks SessionStart | 2 × hook_started / hook_response | 2 × idem | oui |
| CLAUDE.md utilisateur | non mesuré séparément | OUI (requête 8) | oui |
| Mémoire auto (`memory_paths`) | projects/-mnt-projects-ccremote-dev/memory | identique | oui |
| Skills | 108 | 108, même liste | oui |
| Slash commands | 151 | 151, même liste | oui |
| Serveurs MCP (noms, sources) | 21 : 6 user, 2 plugin, 13 claude.ai | 21, identiques | oui |
| Statut MCP à l'init | 17 connectés, 1 échec, 3 needs-auth | 12 connectés, **5 pending**, 1 échec, 3 needs-auth ; 17 connectés à t+7 s | **non** (course) |
| Outils à l'init | 337 (212 claude.ai) | 217 (92 claude.ai) : 120 manquants | **non** (course) |
| Plugins | 8 | 9 : `cc-plugin-easel` (builtin) en plus | **non** |

## 2. Hooks et CLAUDE.md
- Pilote : le modèle a restitué une consigne venue du hook SessionStart (mode nuit). Hooks et contexte injecté chargés.
- Requête 8 : « Senior technical collaborator » présent dans le contexte, réponse OUI. `~/.claude/CLAUDE.md` chargé par le SDK.

## 3. Multi-tours (streaming input)
- Une seule `query`, prompt = générateur asynchrone qui attend le `result` avant le tour suivant.
- `session_id` stable sur les deux tours. Deux `result` `success` (num_turns 1, puis 2).
- Le `result` = fin de tour. La session ne se termine que quand le générateur se termine.
- Tour 2 : appel Bash exécuté, réponse « ORCHIDEE » (mémoire intra-session).

## 4. Reprise par id (`resume`)
- Même `session_id` que la session d'origine, transcription rejouée.
- Le modèle retrouve « ORCHIDEE » et lance un Bash : reprise fonctionnelle.

## 5. permissionMode bypassPermissions
- Accepté (`bypassPermissions` + `allowDangerouslySkipPermissions: true`), visible dans init.
- Avertissement SDK observé : `canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call`.
- `setPermissionMode('default')` en cours de session : `echo` (lecture seule, auto-approuvé) n'a pas appelé canUseTool.
- En reprise en mode `default` : Bash `python3` a déclenché `canUseTool` (callback reçu, autorisé).

## 6. Types de messages vus
- `system` : init, hook_started, hook_response, status, thinking_tokens
- `assistant` : text, thinking, tool_use ; `user` : tool_result
- `stream_event` (seulement avec `includePartialMessages`) : message_start, content_block_start/delta/stop, message_delta, message_stop
- `rate_limit_event` ; `result` (success)
- Non vus (non déclenchés) : `task_*` (sous-agents), refus de permission, progression d'outil, compact, prompt_suggestion, retry API.
- Les demandes de permission passent par le callback `canUseTool`, pas par un message dédié observé.

Extraits bruts :
```
{"subtype":"hook_started","hook_name":"SessionStart:startup","hook_event":"SessionStart"}
{"name":"claude.ai Amplifier","status":"pending","source":"claudeai"}   # à l'init SDK
t=7s {"connected":17,"failed":1,"needs-auth":3}   # mcpServerStatus(), 0 requête
```

## 7. Écarts et options
1. **Version** : le SDK embarque 2.1.325, la CLI installée est 2.1.323. Option : `pathToClaudeCodeExecutable` vers le binaire installé pour figer la version, ou accepter la version embarquée (dérive possible).
2. **Connecteurs claude.ai** : 5 en `pending` à l'init, donc 120 outils absents. Option : attendre `mcpServerStatus()` sans `pending` avant d'afficher les outils (mesuré : 0 pending vers t+7 s). `reconnectMcpServer(nom)` pour un connecteur bloqué.
3. **cc-plugin-easel** : présent seulement dans le SDK, cause non trouvée. À investiguer avant de conclure sur les plugins.
4. **Env héritée** : le SDK hérite de tout l'environnement du processus, y compris le jeton de messagerie d'une session parente. L'app doit construire un env explicite (liste de retrait dans `lib.ts`).
5. **Permissions** : bypass désactive `canUseTool`. Pour une UI d'approbation : `permissionMode: 'default'` ou `acceptEdits` + `canUseTool`. Effet des règles `permissions` de settings.json : non testé.
6. **settingSources** : défaut = tous (comme la CLI). Une app multi-utilisateurs doit le fixer explicitement, sinon elle lit `~/.claude` du serveur (hooks, CLAUDE.md, plugins).
7. **Référence** : refaire la comparaison depuis un terminal propre et avec Claude Desktop réel avant de figer les options.

## 8. Fichiers
- Dossier `essais/sdk/` (rien commité). Scripts : `lib.ts` (options, env, enregistrement), `init.ts` (0 requête : hooks visibles, init non émis sans message), `pilote.ts`, `multitour.ts`, `resume.ts`, `claudemd.ts` (1 requête), `status.ts` (statuts MCP, 0 requête).
- Sorties brutes (jsonl) : `/tmp/claude-1000/-home-trinity--config-Claude-scratch-workspaces-023d6953-9a13-49c3-ad28-761ead35b894-d6a580ef-8538-4df2-bc34-0c692fcf6255-scratch-2026-11-15-d3ffd0/2e4e0ece-7d6d-4ba7-a3b5-f551190ece69/scratchpad/`.
- Nettoyage : 3 transcriptions et le dossier projet `~/.claude/projects/-mnt-projects-ccremote-dev-essais-sdk` créés par l'essai, supprimés. Aucun fichier de config `~/.claude` modifié.
