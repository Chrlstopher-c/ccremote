# Hypothèses

Tout ce que j'ai décidé à ta place. `[R]` = réversible sans refonte. `[I]` = structurant, un changement invalide des branches entières.

---

## Tranchées par toi, enregistrées ici

| # | Décision | Portée |
|---|---|---|
| H-01 | Arrêt de la descente **avant** les signatures TypeScript. Les contrats sont en prose ; les rares blocs typés sont des formes de données, marqués comme tels. | `[I]` |
| H-02 | L'orchestrateur **est lui-même une session Agent SDK** avec un serveur MCP maison, pas une boucle API brute. Il hérite gratuitement des permissions, sessions, hooks, resume, compaction. | `[I]` — invalide A et C si renversé |
| H-03 | Pi et PC sur **LAN de confiance**. Pas d'authentification mutuelle complexe. | `[I]` — invalide D si renversé |
| H-04 | Livraison **multi-fichiers**. | `[R]` |

---

## Prises par moi — structurantes

### H-10 `[I]` — Le harness ne possède que le niveau 1

Justifié en `01`, Découverte 1. Le harness orchestre **des sessions**, pas des agents. Ce qui se passe *dans* une session (teammates, subagents) appartient à Claude Code.

**Test de violation** : si une mission te fait écrire de la messagerie entre agents, de la liste de tâches partagée, ou de la reprise de tâche entre agents — tu es en train de recoder N2. Arrête.

### H-11 `[I]` — Une équipe = une session Claude Code = un worktree git

Le triplet est indivisible. Pas deux équipes dans un worktree, pas une équipe à cheval sur deux sessions.

**Pourquoi** : sans ça, deux agents écrivent le même fichier et se détruisent mutuellement. Les hooks `WorktreeCreate`/`WorktreeRemove` étant natifs, l'alignement sur le worktree est le chemin que le SDK favorise.

`⚠ HYP` **Limite connue** : un projet non-git n'a pas de worktree. Un projet qui n'est pas un dépôt git tombe dans un mode dégradé « répertoire dédié, isolation non garantie », et le harness doit le **signaler** plutôt que de faire semblant. → branche F.

### H-12 `[I]` — Le transport Pi↔PC transporte deux flux, pas un protocole

Conséquence de la Découverte 3. Le PC expose un moyen d'obtenir une paire stdin/stdout attachée à un processus Claude Code ; le Pi la branche dans `spawnClaudeCodeProcess`. Le harness **n'invente aucun protocole applicatif** entre Pi et PC pour le canal principal.

**Corollaire** : la sémantique du flux est celle du SDK, pas la tienne. Tu ne la comprends pas, tu la relaies. Ne jamais parser ni réécrire les trames du canal principal — seulement les observer.

### H-13 `[I]` — Le canal de permission est séparé du canal principal

Les demandes de permission remontent par le flux SDK, mais les **réponses** partent par un canal distinct (celui de ton téléphone) et sont réinjectées via le mécanisme `requestId` + retour `null`.

**Pourquoi séparés** : la latence humaine se compte en minutes, celle du flux en millisecondes. Les mélanger fait qu'une réponse lente bloque le flux.

`☠ CASSE` — les demandes de permission **n'expirent jamais**. Un `null` retourné sans qu'une réponse parte réellement par l'autre canal laisse l'agent bloqué indéfiniment. La branche C traite ce cas comme le risque numéro un.

### H-14 `[R]` — Agent Teams (N2) est activé, mais optionnel par équipe

Chaque équipe déclare si elle utilise Agent Teams ou reste solo+subagents. Réversible parce que ça ne change que le contenu d'une session.

**Pourquoi optionnel** : la fonctionnalité est expérimentale, avec des limitations connues autour de la **reprise de session**, de la coordination des tâches et de l'arrêt. Or la reprise de session est précisément le cœur de ton usage mobile. Une équipe critique doit pouvoir tourner sans.

### H-15 `[I]` — Best-effort assumé sur le miroir de sessions

`SessionStore` abandonne un lot après échec et laisse le sous-processus continuer. Donc : la **source de vérité des transcripts est le disque du PC**. Le store externe est un cache de lecture et un filet de reprise, jamais l'autorité.

**Conséquence** : ne jamais construire de logique de facturation, d'audit ou de reprise critique qui suppose le store complet. → branche E.

---

## Prises par moi — réversibles

### H-20 `[R]` — Un processus worker par équipe, pas un worker multiplexé

Plus de processus, plus de RAM, mais l'isolation des pannes est gratuite : une équipe qui crashe n'emporte pas les autres.

**Bascule** : si la RAM du PC devient le facteur limitant. Le seuil n'est pas estimable à froid — le mesurer avant d'optimiser.

### H-21 `[R]` — État persistant sur SQLite au Pi

Registre des équipes, file d'approbation, high-water marks, epochs. Un seul écrivain (le control plane), lectures concurrentes. Redis/NATS seulement si le multi-écrivain apparaît.

### H-22 `[R]` — L'UI mobile est un client du control plane, pas un pair

Le Pi reste l'unique autorité. Le téléphone peut être éteint sans que rien ne s'arrête ; les demandes de permission s'accumulent dans la file et attendent.

### H-23 `[R]` — Modèle : Opus pour l'orchestrateur, Sonnet par défaut pour les équipes

Le lead a besoin de raisonnement pour décomposer ; les exécutants scopés s'en sortent bien sur un modèle moins cher. Surchargeable par équipe via `AgentDefinition.model`.

### H-24 `[REMPLACÉE PAR H-42]` — Pas de `bypassPermissions` global

⚠ **Cette entrée est conservée pour la traçabilité. La règle en vigueur est H-42**, qui abandonne `bypassPermissions` pour un motif technique plus fort : en bypass, `canUseTool` n'est jamais appelé, ce qui rend la branche C sans objet.

Texte d'origine : même sur LAN de confiance, les règles d'allow-list explicites par équipe, plus le mode `dontAsk` pour les équipes autonomes, couvrent le besoin sans ouvrir la porte en grand. Note vérifiée, **toujours valable et reprise en G.2.1** : une règle de déni *scopée* (ex. `Bash(rm *)`) reste appliquée **même en `bypassPermissions`**, contrairement à un nom d'outil nu qui, lui, retire simplement l'outil du contexte.

Le mode nominal retenu n'est finalement ni `bypassPermissions` ni `dontAsk`, mais `'auto'` (H-40).

---

## Tranchées en cours de spécification

Décisions prises après vérification SDK, en conversation. Elles **remplacent** tout ce qui les contredit dans les fichiers antérieurs.

### H-40 `[I]` — L'arbitrage des permissions est délégué au lead, pas à l'humain

Objectif déclaré : **ne pas avoir à être derrière.** Le mode `PermissionMode = 'auto'` (classifieur de modèle qui approuve ou refuse les invites) est le mode nominal des équipes. `setMcpPermissionModeOverride(serveur, 'auto')` épingle ce comportement par serveur MCP, sans jamais pouvoir élargir un privilège.

**Conséquence sur la branche C** : le canal humain n'est plus le chemin normal, c'est une **voie d'escalade**. Le bus de permissions reste nécessaire — pour ce que le classifieur refuse, pour l'observation, pour l'audit — mais il n'est plus sur le chemin critique de chaque tour.

**Bénéfice de sûreté** : moins de demandes partent vers le téléphone, donc moins d'occasions de laisser un agent bloqué sur une réponse jamais arrivée (le risque `☠` de H-13 diminue mécaniquement).

### H-41 `[R]` — Le lead a tous les droits, avec un plancher limité à l'irréversible

Décision de l'opérateur : le lead peut tout faire. C'est sa machine.

Plancher conservé : `disallowedTools` avec motifs **scopés**, restreint à l'irréversible pur (destruction hors worktree, réécriture d'historique git partagé, écrasement de secrets). Une dizaine de motifs, rien qui gêne le travail normal.

Fondement vérifié : une règle de déni scopée du type `Bash(rm *)` reste appliquée **dans tous les modes de permission, y compris `bypassPermissions`**. Un nom d'outil nu, lui, retire simplement l'outil du contexte. Le plancher est donc un vrai plancher, pas une convention.

`⚠ HYP` — si l'opérateur veut zéro plancher, c'est spécifiable ; la liste devient vide et cette hypothèse est levée. Signalé plutôt que discuté à nouveau.

### H-42 `[I]` — `bypassPermissions` global abandonné

Remplace H-24 et l'usage historique (`claude -p` en bypass avec garde-fous dans les instructions).

**Motif technique décisif** : en `bypassPermissions`, `canUseTool` **n'est jamais appelé**. Or c'est le point d'accroche de tout le canal d'approbation. Garder le bypass rendrait la branche C sans objet.

**Motif de fond** : une règle dans le prompt est une suggestion au modèle ; une règle de permission est une contrainte sur l'exécution. La différence est théorique quand un humain surveille un tmux, réelle quand N équipes tournent sans surveillance.

**Migration depuis l'usage actuel** : les garde-fous d'instructions existants sont conservés — ils deviennent la deuxième couche, plus la seule.

### H-43 `[R]` — Plancher de modèle : Sonnet minimum

`AgentDefinition.model` accepte les alias `fable`, `opus`, `sonnet`, `haiku`, `inherit`. Le harness refuse `haiku` à la création d'équipe.

`☠ CASSE` — la validation porte sur le **modèle résolu**, pas sur l'alias. `'inherit'` hérite du modèle principal et ne garantit rien par lui-même. Valider après résolution.

### H-44 `[I]` — La config Claude Code du PC est honorée

Par défaut, `query()` charge les mêmes sources que le CLI : `user`, `project`, `local`.

`☠ CASSE` — **il est interdit au harness de passer `settingSources: []`.** C'est la ligne qu'un agent ajoute « pour être déterministe » et qui neutralise silencieusement toute la config machine.

**Conflit de préséance à respecter** : les options programmatiques du harness passent **au-dessus** de `user`/`project`/`local`. Donc chaque valeur fixée par le harness écrase la config PC. Règle : le harness ne fixe que le **structurel** — identité de session, worktree, budget, mode de permission, plancher de déni. Tout le reste appartient au PC.

**Répartition des instructions** :
- `CLAUDE.md` sur le PC → faits de machine, durables : c'est le poste de l'opérateur, les agents s'y coordonnent entre IA, conventions locales. Piège vérifié : nécessite `settingSources` incluant `project` **et** un `systemPrompt` en forme preset — l'un sans l'autre ne charge rien.
- `systemPrompt.append` depuis le harness → mandat propre à chaque équipe, éphémère.

**Instrument de vérification** : `resolveSettings()` (⚠ ALPHA) résout les settings effectifs d'un répertoire **sans lancer de session** et retourne la provenance de chaque clé. À utiliser en pré-vol avant chaque spawn.

### H-45 `[I]` — Le flux brut ne va jamais à l'orchestrateur

Exigence de l'opérateur : tout voir en temps réel.

Répartition : `includePartialMessages` (streaming), `forwardSubagentText` (activité des sous-agents avec `parent_tool_use_id`), `agentProgressSummaries` (résumés d'une ligne sur les événements `task_progress`) alimentent **l'UI et le registre**. L'orchestrateur ne reçoit que des résumés.

Sans cette séparation, le contexte de l'orchestrateur sature en quelques heures.

### H-46 `[R]` — La pause n'existe pas nativement, elle se construit

Couper est natif : `interrupt()`, `stopTask(taskId)`, `close()`. **Aucune primitive de suspension.**

Une pause = interrompre + retenir la file d'entrée. Le reçu d'interruption (`SDKControlInterruptResponse.still_queued`, capacité `interrupt_receipt_v1`, CC v2.1.205+) liste les messages qui survivent à l'interruption, ce qui rend la mécanique réalisable proprement. Spécifiée en B.4.

### H-47 `[I]` — L'orchestrateur ne répond pas aux permissions en régime nominal

Résout la question ouverte de A.2.2. Avec H-40, l'arbitrage appartient au lead. L'outil `repondre_permission` subsiste pour la voie d'escalade uniquement, et son verdict est **tracé comme décision humaine par procuration**, pas comme décision d'agent.

Écarté définitivement : un orchestrateur qui répond à tout. Un agent capable de s'accorder ses propres permissions n'a plus de garde-fou.

---

## Hypothèses initialement ouvertes — statut

| # | Question | Statut |
|---|---|---|
| H-30 | Le PC est-il toujours allumé ? | **TRANCHÉE** — non, mais sans conséquence : quand l'opérateur parle au maître, le PC est allumé. Pas de réveil, pas de file d'attente. Voir H.2. Mode dégradé **clos sans implémentation.** |
| H-31 | Combien d'équipes simultanées au pic ? | **OUVERTE — mesure, pas décision.** Requalifiée par F2.0.1 : la bonne métrique n'est plus « équipes simultanées » mais « missions par unité de temps ». Impacte H-20 et le dimensionnement du registre. |
| H-32 | L'orchestrateur crée-t-il des projets ? | **TRANCHÉE** — oui, création **et** modification. Voir branche F2. Deux conséquences plus profondes que la création elle-même : F2.0.1 (l'équipe est une instance de mission) et F2.0.2 (dispatch multi-missions ⇒ intégration devient nécessaire). |
| H-33 | Rétention des transcripts ? | **TRANCHÉE** — on garde, le maître condense au fil de l'avancée selon le besoin. Voir H.3, découpé en trois paliers de coût croissant. |

**Aucune question bloquante restante.** H-31 se répond par mesure une fois le système en service.
