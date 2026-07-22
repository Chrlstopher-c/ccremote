# Branche F — Projets, worktrees, équipes

**Profondeur atteinte : 4** sur le triplet et la modularité, **1** sur la création de projet (H-32 non tranchée).

**Responsabilité unique** : matérialiser le triplet **projet ↔ worktree ↔ équipe** et garantir sa cohérence. C'est ici que vit la modularité demandée : ajouter un projet ne doit toucher aucun autre composant.

---

## F.1 — Le triplet

### F.1.1 Définition `⊣ TERMINAL`

**Indivisible (H-11)** : une équipe = une session Claude Code = un worktree git.

Pas deux équipes dans un worktree. Pas une équipe à cheval sur deux worktrees. Pas de worktree partagé.

**Fondement** : sans ça, deux agents écrivent le même fichier et se détruisent mutuellement. Les hooks `WorktreeCreate` / `WorktreeRemove` étant natifs — avec `WorktreeCreateHookSpecificOutput.worktreePath` fournissant le chemin absolu du répertoire créé — l'alignement sur le worktree est le chemin que le SDK favorise, pas un contournement.

Vérifié : `listSessions({dir})` a `includeWorktrees: true` **par défaut** quand `dir` est dans un dépôt git — il remonte les sessions de **tous les chemins de worktree**. L'inventaire multi-worktrees est donc en grande partie fourni.

### F.1.2 Projet `⊣ TERMINAL`

Un projet = un dépôt git + une configuration harness. Il porte : chemin du dépôt principal, branche par défaut, plafond de budget, modèle par défaut, plancher `disallowedTools` spécifique, activation ou non d'Agent Teams (H-14), mandat type.

`⚠ HYP` — configuration déclarative par fichier, un fichier par projet. Motif : c'est ce qui rend la modularité réelle. Ajouter un projet = déposer un fichier. Aucun code à modifier, aucun redémarrage.

### F.1.3 Cas non-git `⊣ TERMINAL`

`⚠ HYP` (H-11) — un projet qui n'est pas un dépôt git n'a pas de worktree.

Mode dégradé : répertoire dédié, **isolation non garantie**. Le harness doit le **signaler explicitement** — dans le registre, dans l'UI, et dans le mandat de l'équipe — plutôt que de faire comme si l'isolation existait.

**Ne pas** simuler l'isolation avec des copies de répertoires. Ça donne l'illusion de la sûreté sans la fusion contrôlée que git fournit.

---

## F.2 — Cycle de vie d'un worktree

### F.2.1 Allocation `⊣ TERMINAL`

À la création d'une équipe :

1. Vérifier qu'aucun worktree vivant n'est déjà alloué à cette équipe.
2. Créer le worktree sur une branche dédiée, nommée d'après l'équipe.
3. Enregistrer l'association dans le registre, **avant** le spawn.
4. Passer le chemin en `cwd` au worker.

`☠ CASSE` — enregistrer **après** le spawn ouvre une fenêtre où un worker tourne sans association connue. Si le Pi redémarre dans cette fenêtre, l'équipe devient orpheline (E.1.4).

### F.2.2 Revendication et fencing `⊣ TERMINAL`

Un worktree est revendiqué par exactement un worker vivant. La revendication porte l'epoch de l'équipe (D.2.3).

Avant tout spawn : vérifier qu'aucun worker vivant ne revendique ce worktree. Si oui et que l'epoch est périmé, l'ancien doit se terminer avant que le nouveau démarre.

`☠` C'est **le** garde-fou contre la corruption silencieuse décrite en D.2.3. Sans lui, le scénario « le Pi redémarre pendant que le PC travaille » produit deux agents sur les mêmes fichiers, sans aucune erreur — juste du code incohérent.

### F.2.3 Libération `⊣ TERMINAL`

Quand une équipe se termine :
1. Vérifier l'état git : commits en attente ? Modifications non commitées ?
2. **Si travail non commité ⇒ ne pas supprimer.** Passer en `terminee_non_liberee`, signaler.
3. Sinon, supprimer le worktree, libérer l'association.

`⚠ HYP` — je choisis de **ne jamais détruire du travail non commité automatiquement**, quitte à accumuler des worktrees. Le coût d'un worktree oublié est du disque ; le coût d'une nuit de travail détruite est autre chose. Réversible si tu préfères l'inverse.

### F.2.4 Fusion `⊣ HORS-PÉRIMÈTRE`

Comment le travail des équipes revient dans la branche principale.

**Motif d'exclusion** : c'est un choix de workflow git, pas d'architecture. Chaque équipe travaille sur sa branche ; la fusion suit des flux git standards, éventuellement pilotée par une équipe dédiée.

**Ce que le harness doit fournir** : l'état git de chaque équipe (branche, avance/retard, conflits potentiels) dans le registre, pour que la décision de fusion soit informée. Il ne fusionne pas lui-même.

---

## F.3 — Composition d'une équipe

### F.3.1 Le mandat `⊣ TERMINAL`

Contenu obligatoire :
- objectif, avec **critère d'arrêt explicite**
- périmètre de fichiers autorisé
- interdiction de sortir du worktree
- contrainte de commit (fréquence, format)
- ce qui doit être escaladé plutôt que décidé

Interdit : tout secret, toute credential, toute référence à un chemin hors worktree.

Véhicule : `systemPrompt.append` sur le preset `claude_code` (H-44), **pas** un premier message utilisateur. Motif : le mandat doit survivre à la compaction, ce qu'un message utilisateur ne garantit pas.

`⊣ DÉLÉGUÉ` — la formulation. C'est du prompt engineering, à itérer sur de vrais mandats, pas à figer à froid.

### F.3.2 Niveau 2 : Agent Teams `⊣ TERMINAL` `⚠ ALPHA`

Activation par équipe via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` dans `env` (H-14).

Vérifié — sans cette variable : aucune équipe n'est créée au démarrage de session, aucun répertoire d'équipe n'est écrit, et Claude ne propose ni ne spawn de teammate. Le comportement par défaut est donc sûr.

Contraintes **non contournables** :
- une seule équipe active par session
- pas d'équipes imbriquées : un teammate ne peut pas créer de sous-équipe
- lead fixé à la création, non modifiable en cours de session
- permissions d'un teammate fixées au spawn, **sans escalade ultérieure**

Évolution vérifiée (CC v2.1.178+) : spawner un teammate ne nécessite plus d'étape de setup et le nettoyage est automatique à la sortie de session. Les outils `TeamCreate` et `TeamDelete` **n'existent plus**. L'entrée `team_name` sur l'outil `Agent` est acceptée mais **ignorée**, et le champ `team_name` dans les charges utiles `TaskCreated`, `TaskCompleted` et `TeammateIdle` porte un nom dérivé de la session et est **déprécié**.

`☠ CASSE` — toute mission qui s'appuie sur `TeamCreate`/`TeamDelete` ou sur `team_name` travaille sur une API disparue.

**Limitations connues** autour de la reprise de session, de la coordination des tâches et de l'arrêt. **La reprise de session est précisément le cœur de l'usage mobile** — d'où H-14 : une équipe critique tourne sans Agent Teams.

### F.3.3 Niveau 3 : subagents `⊣ TERMINAL`

Stable, à privilégier. Définition programmatique via l'option `agents`.

`AgentDefinition` vérifié : `description` (requis), `prompt` (requis), `tools?`, `disallowedTools?`, `model?`, `mcpServers?`, `skills?`, `initialPrompt?`, `maxTurns?`, `background?`, `memory?`, `effort?`, `permissionMode?`, `criticalSystemReminder_EXPERIMENTAL?`.

Points vérifiés utiles :
- `tools` omis ⇒ **hérite de tous les outils du parent**. Pour un subagent scopé, l'énumérer explicitement.
- Pour précharger des Skills, utiliser le champ `skills`, **pas** `'Skill'` dans `tools`.
- `disallowedTools` accepte des motifs au niveau serveur MCP : `mcp__serveur`, `mcp__serveur__*`, `mcp__*`.
- `model` accepte `'fable'`, `'opus'`, `'sonnet'`, `'haiku'`, `'inherit'`, ou un identifiant complet. `☠` Le plancher Sonnet (H-43) se valide sur le **modèle résolu** — `'inherit'` ne garantit rien.
- `background: true` ⇒ tâche non bloquante. Soumis au watchdog `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` (B.3.1), qui ne s'applique **pas** aux subagents synchrones.

### F.3.4 L'outil `Workflow` `⊣ DÉLÉGUÉ` `⚠ ALPHA`

Disponible en SDK v0.3.149+. Exécute un flux dynamique : un script qui orchestre de nombreux subagents en arrière-plan et retourne **un résultat consolidé**. Au moins un de `script`, `name` ou `scriptPath` est requis.

Potentiellement pertinent pour un mandat d'équipe très structuré. Non retenu par défaut : il ajoute une couche d'abstraction dont le besoin n'est pas démontré.

**Instruction** : évaluer **après** que le système tourne, sur un cas réel. Ne pas l'adopter préventivement.

---

## F.4 — Modularité

### F.4.1 Le test `⊣ TERMINAL`

**Ajouter un projet ne doit modifier aucun composant existant.** Concrètement : déposer un fichier de configuration, et le projet est disponible — sans redémarrage, sans modification de code, sans migration.

C'est le critère 4 de `03`. Une implémentation qui exige de toucher A, B ou E pour ajouter un projet a raté la conception.

### F.4.2 Découverte `⊣ TERMINAL`

Le harness découvre les projets en scrutant un répertoire de configuration. Rechargement à chaud.

Validation au chargement, **avant** de rendre le projet disponible : le dépôt existe, la branche par défaut existe, le budget est cohérent, le modèle respecte le plancher, les motifs de déni sont scopés.

Un projet invalide est **signalé et écarté**, pas chargé partiellement. Un projet à moitié chargé produit des pannes au spawn, bien plus tard, avec un diagnostic difficile.

### F.4.3 Isolation des configurations `⊣ TERMINAL`

Un projet mal configuré ne peut pas dégrader les autres. Pas de configuration globale mutable partagée ; les défauts globaux sont en **lecture seule** et surchargés par projet.

### F.4.4 Création de projet `⊣ HORS-PÉRIMÈTRE — H-32 non tranchée`

L'orchestrateur peut-il **créer** un projet (initialiser un dépôt, échafauder), ou seulement piloter l'existant ?

**Non spécifié délibérément.** Si la réponse est oui, la branche F double de taille : gestion de modèles de projet, initialisation git, configuration initiale, remotes. Spécifier ça sans réponse serait construire sur du vide.

**Instruction** : demander la réponse avant d'ouvrir cette sous-branche. Défaut en attendant : **piloter l'existant uniquement**.
