# Branche E — Registre d'état et observabilité

**Profondeur atteinte : 4** sur l'état et le temps réel, **2** sur le stockage.

**Responsabilité unique** : savoir à tout instant quelles équipes existent, dans quel état, depuis quand, à quel coût, avec quelle marge de contexte.

**Exigence opérateur** : tout voir en temps réel. **Contrainte associée (H-45)** : le flux brut alimente l'UI et le registre, **jamais l'orchestrateur**.

---

## E.1 — Modèle d'état

### E.1.1 Les trois états d'une équipe `⊣ TERMINAL`

Repris du bridge, vérifiés : `idle` | `running` | `requires_action`.

`requires_action` est celui qui compte : c'est le seul qui appelle une intervention. Avec H-40, il devient rare — le lead arbitre — ce qui en fait un **signal fort** plutôt qu'un bruit de fond.

Le harness ajoute des états qui lui sont propres, hors du modèle SDK :

| État harness | Sens |
|---|---|
| `en_pause` | interrompue volontairement, file retenue (B.4) |
| `attente_machine` | PC indisponible (D.4, si H-30 l'exige) |
| `echec_definitif` | plafond de relances atteint (B.3.3) |
| `terminee` | mandat accompli, worktree libérable |

`☠ CASSE` — ne pas mélanger les états SDK et les états harness dans un seul champ. Les premiers viennent du worker, les seconds de la décision du Pi. Fusionner rend impossible la réconciliation de D.2.4 : on ne sait plus qui fait autorité sur quoi.

### E.1.2 Transitions rapportées `⊣ TERMINAL`

Pattern `reportState` du bridge : `running` au début du tour, `requires_action` à l'invite de permission, `idle` à la fin du tour.

Source des transitions : les messages du flux, pas un sondage. Le sondage introduit une latence et rate les transitions courtes.

### E.1.3 Ce que le registre stocke `⊣ TERMINAL`

Par équipe : identité (nom, projet, worktree, branche, `sessionId`), état + horodatage, epoch courant (D.2.3), high-water mark d'observation (D.2.2), budget consommé / plafond, usage de contexte, compteur de relances, mandat, modèle résolu, dernière raison terminale.

`⚠ HYP` — pas d'historique d'états en v1, seulement l'état courant plus le dernier changement. Si tu veux répondre à « combien de temps mes équipes passent-elles bloquées », il faut une table de transitions. À ajouter quand la question se pose, pas avant.

### E.1.4 Réconciliation `⊣ TERMINAL`

Le registre du Pi **n'est pas l'autorité** sur ce qui tourne. Le PC l'est (B.1.4).

Déclencheurs : démarrage du Pi, retour de coupure, périodiquement.

Trois cas :
- **Fantôme** (au registre, absent du PC) ⇒ marquer terminée, libérer le worktree.
- **Orphelin** (sur le PC, absent du registre) ⇒ adopter ou tuer. **Ne jamais ignorer** : un orphelin consomme du budget sans apparaître nulle part.
- **Divergence d'état** ⇒ le PC gagne.

---

## E.2 — Temps réel

### E.2.1 Trois niveaux de granularité `⊣ TERMINAL`

| Niveau | Option SDK | Destination |
|---|---|---|
| Tokens à la volée | `includePartialMessages: true` → `SDKPartialAssistantMessage` de type `stream_event` | UI seulement |
| Activité des sous-agents | `forwardSubagentText: true` | UI + arbre d'exécution |
| Résumés d'une ligne | `agentProgressSummaries: true` → champ `summary` sur les événements `task_progress` | UI **et orchestrateur** |

Vérifié : `includePartialMessages` livre des **événements bruts de l'API Claude**, pas du texte accumulé. L'accumulation des deltas est à la charge du consommateur.

Vérifié : par défaut, seuls les blocs `tool_use` et `tool_result` des subagents sont émis. `forwardSubagentText` ajoute texte et blocs de réflexion, en tant que messages assistant et utilisateur avec `parent_tool_use_id` renseigné, ce qui permet de **reconstruire un transcript imbriqué**.

`☠ CASSE` — la ligne « UI seulement » des deux premiers niveaux est **H-45**. Router les niveaux 1 ou 2 vers l'orchestrateur sature son contexte en quelques heures. Une mission qui les y envoie viole la conception.

### E.2.2 Arbre d'exécution `⊣ TERMINAL`

Reconstruction avec :
- `parent_tool_use_id` — pour un message de subagent, l'identifiant de l'appel d'outil `Agent` qui l'a engendré. `null` pour le fil principal.
- `parent_agent_id` — pour un subagent **imbriqué**, l'identifiant du subagent parent. `null` pour le fil principal, pour les subagents de premier niveau, et pour les sessions anciennes. **Exige CC v2.1.202+.**
- `listSubagents(sessionId)` et `getSubagentMessages(...)` — introspection fournie, à **ne pas réimplémenter**.

C'est la vue « qui travaille sur quoi dans cette équipe », gratuitement.

### E.2.3 Diffusion vers les clients `⊣ DÉLÉGUÉ`

Contraintes imposées :
- Reprise au numéro de séquence (D.2.2), pas de rejeu complet.
- Plusieurs clients simultanés (téléphone + navigateur) sans interférence.
- Un client lent ne ralentit pas le worker. **Bourrage borné, abandon des plus anciens** plutôt que blocage.
- Mode miroir (`outboundOnly` du bridge) : observer sans piloter.

`☠ CASSE` — un client lent qui exerce une contre-pression jusqu'au worker fait ralentir l'agent parce que quelqu'un a une mauvaise connexion. L'observation ne doit **jamais** freiner l'exécution.

---

## E.3 — Persistance des transcripts

### E.3.1 Contrat `SessionStore` `⊣ TERMINAL`

Vérifié :

- `append(key, entries)` — appelé **après** succès de l'écriture locale, la durabilité étant déjà garantie localement. Lots à cadence ~100 ms pendant les tours actifs. Entrées = POJO JSON-safe, une par ligne du JSONL local.
- `load(key)` — appelé **une seule fois, dans le parent SDK, avant le spawn**. Le résultat est matérialisé dans un JSONL temporaire dont le sous-processus reprend avec son code de resume existant. Retourner `null` pour une clé jamais écrite.
- `listSessions?(projectKey)` — **optionnel**, mais si absent, `listSessions()` avec un `sessionStore` **lève**. Retourne identifiants + `mtime` en millisecondes epoch entières. Ordre non spécifié, le SDK trie par `mtime` décroissant.

Ordonnancement : dans un même processus, persister dans l'ordre des appels ; entre processus concurrents, l'ordre est celui du commit de stockage, pas celui de l'appel.

Égalité : les entrées retournées doivent être **profondément égales** à ce qui a été ajouté. L'égalité octet par octet **n'est pas** requise (JSONB peut réordonner les clés) — le SDK ne hache ni ne compare les octets.

### E.3.2 Idempotence `⊣ TERMINAL` `☠ CASSE`

La plupart des entrées portent un `uuid` stable. Les adaptateurs **devraient le traiter comme clé d'idempotence** (upsert / ignore-doublon), pour que les reprises et les rejeux d'`importSessionToStore()` ne créent pas de doublons.

Les entrées **sans** `uuid` (titres, tags, marqueurs de mode) s'ajoutent **sans** déduplication.

### E.3.3 Best-effort assumé `⊣ TERMINAL`

Politique d'échec vérifiée : un rejet est réessayé 3 fois avec backoff court ; un **timeout de 60 s n'est pas réessayé**, l'appel en vol pouvant encore aboutir. Après l'échec final, **le lot est abandonné** et un message système `mirror_error` est émis. **Le sous-processus continue, inaffecté.**

`☠` **Conséquence (H-15)** : la source de vérité des transcripts est **le disque du PC**. Le store du Pi est un cache de lecture et un filet de reprise. Ne jamais bâtir de logique de facturation, d'audit réglementaire ou de reprise critique en supposant le store complet.

Le harness doit **surveiller les messages `mirror_error`** et signaler la dérive. Un store qui perd des lots en silence donne une fausse confiance.

### E.3.4 Choix du backend `⊣ DÉLÉGUÉ`

SQLite au Pi (H-21) par défaut. `InMemorySessionStore` est fourni par le SDK, utile en test.

Critères : upsert par `uuid`, `listSessions` performant, purge par ancienneté (H-33 non résolue).

---

## E.4 — Coût et contexte

### E.4.1 Contexte `⊣ TERMINAL`

`getContextUsage()` sur `Query` retourne `SDKControlGetContextUsageResponse`. **C'est mesurable, pas à deviner.**

Sur l'orchestrateur (A.1.4) : surveiller la saturation. Sur chaque équipe : anticiper la compaction.

Corrélation utile : les hooks `PreCompact`/`PostCompact` et les messages `SDKCompactBoundaryMessage` datent les compactions. Une équipe qui compacte souvent a un mandat trop large ou trop de contexte injecté.

### E.4.2 Coût `⊣ TERMINAL`

`SDKResultMessage` porte les métriques d'exécution et l'usage de tokens ; `ModelUsage` et `NonNullableUsage` sont exportés.

`⚠` `maxBudgetUsd` est comparé à la **même estimation** que `total_cost_usd` — c'est une estimation côté client, avec des réserves de précision documentées. **Ne pas la traiter comme une facturation.** C'est un garde-fou, pas une comptabilité.

### E.4.3 Limites d'usage `⊣ TERMINAL`

Trois constantes exportées (⚠ ALPHA) pour classer les messages de limite sans parser de chaînes à la main :

- `USAGE_LIMIT_ERROR_PREFIXES` — une limite a réellement été atteinte, arrive comme erreur d'API.
- `USAGE_TRANSITION_PREFIXES` — notifications de bascule (« passage sur les crédits »). **Jamais des erreurs d'API**, purement informatif.
- `USAGE_WARNING_PREFIXES` — avertissements d'approche, sévérité `warning`. **Jamais des erreurs d'API.**

`☠ CASSE` — traiter une transition ou un avertissement comme une erreur fait arrêter des équipes sans raison. Les trois catégories sont distinctes et n'appellent pas la même réaction.

Voir aussi `SDKRateLimitEvent` et `SDKRateLimitInfo` pour l'état structuré.

---

## E.5 — Capacités `⊣ TERMINAL`

`SDKSystemMessage` porte `capabilities`. **Lire, ne pas supposer.**

Capacités à vérifier au démarrage de chaque worker, avec la liste versionnée de `01` :

| Capacité | Sans elle |
|---|---|
| `interrupt_receipt_v1` | `interrupt()` résout `undefined` ⇒ pause dégradée (B.4) |
| `requestId` sur `canUseTool` | pas de réponse hors-bande (C.2.3) |
| `reinitialize()` | pas de récupération après coupure (D.2.4) ⇒ **bloquant** |
| `parent_agent_id` | arbre des subagents imbriqués incomplet (E.2.2) |

Le registre stocke les capacités par équipe. Un parc hétérogène est possible — un worker sur un binaire ancien n'a pas les mêmes garanties, et l'UI doit le montrer plutôt que de laisser croire à une panne.
