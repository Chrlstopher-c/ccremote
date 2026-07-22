# Ordres de mission

Un ordre par feuille terminale ou groupe cohérent. Destinés à être donnés **un par sous-agent**, avec le socle (`01`, `02`, `03`) et **le seul fichier de branche concerné**.

## Types d'agents

| Type | Compétence | Ne fait pas |
|---|---|---|
| `AGT-SDK` | Intégration Agent SDK, options, messages, cycle de vie | Réseau, UI |
| `AGT-PROTO` | Transport, sérialisation, reprise, idempotence | Logique métier |
| `AGT-ETAT` | Persistance, registre, réconciliation | Transport |
| `AGT-SEC` | Permissions, planchers, budgets, audit | Fonctionnel |
| `AGT-UI` | Client mobile, temps réel | Backend |
| `AGT-TEST` | Tests d'acceptation, injection de pannes | Implémentation |

## Règles imposées à tout agent

1. **Une `⚠ HYP` constatée fausse ⇒ remonter**, ne pas improviser. Une hypothèse fausse propagée coûte plus cher que l'aller-retour.
2. **Tout `☠ CASSE` du fichier de branche a un test associé.** Sans test, la mission n'est pas terminée.
3. **Épingler le SDK à `0.3.217`.** Ne pas mettre à jour sans revérifier `01`.
4. **Vérifier les capacités via `SDKSystemMessage.capabilities`**, jamais supposer une version.
5. **Ne rien réimplémenter de ce que `01` liste comme fourni.**

---

## Lot 0 — Socle (bloquant pour tout le reste)

### M-01 · `AGT-SDK` · Squelette de worker
**Périmètre** : B.1.1 → B.1.3, B.2.1. Un worker qui démarre une session Claude Code locale, avec la composition d'options complète.
**Acceptation** : (a) le worker démarre et rapporte ses capacités ; (b) `resolveSettings()` confirme que le `CLAUDE.md` du PC est chargé ; (c) le plancher Sonnet refuse `haiku`, **y compris via `'inherit'`** ; (d) `env` préserve `PATH`.
**Interdit** : `settingSources: []`. Fixer autre chose que le structurel listé en B.1.3.

### M-02 · `AGT-SDK` · Générateur d'entrée persistant
**Périmètre** : A.1.3. File de messages avec signal d'attente, générateur qui ne se termine jamais seul.
**Acceptation** : session ouverte, 10 minutes de silence, puis action nécessitant une permission ⇒ `canUseTool` **est** appelé. Aucun `Error: Stream closed` sur stderr.
**Pourquoi c'est le lot 0** : ce défaut casse hooks et permissions **silencieusement**. Tout ce qui est bâti avant est invalide.

### M-03 · `AGT-ETAT` · Registre et schéma
**Périmètre** : E.1.3, E.1.1, H-21. Schéma SQLite : équipes, états, epochs, high-water marks, budgets, capacités.
**Acceptation** : états SDK et états harness dans des champs **distincts** (`☠` E.1.1). Survit au redémarrage.

### M-04 · `AGT-TEST` · Harnais de test et injection de pannes
**Périmètre** : transversal. Doit pouvoir : couper le lien Pi↔PC, tuer un worker sans préavis, redémarrer le Pi pendant un tour actif, simuler un client lent, simuler un timeout de `SessionStore`.
**Acceptation** : chaque panne est déclenchable de façon reproductible.
**Pourquoi tôt** : les branches C, D et E se valident **uniquement** sous panne. Sans ce harnais, elles ne sont pas testables et personne ne s'en apercevra avant la production.

---

## Lot 1 — Transport (dépend du lot 0)

### M-10 · `AGT-PROTO` · Tunnel et contrat `SpawnedProcess`
**Périmètre** : D.1.2, D.1.3, B.2.1, B.2.2, B.2.3.
**Décision déléguée** : SSH / WebSocket / TCP. Mesurer, décider, documenter.
**Acceptation** : (a) coupure de 30 s pendant un tour actif, rétablissement, **zéro octet perdu ou dupliqué** ; (b) `kill(signal)` atteint le processus distant ; (c) stderr rapatrié et une erreur de hook y est visible ; (d) le teardown lourd est accroché au `signal` de `SpawnOptions`, l'arrêt immédiat à l'`abortController` capturé en closure.

### M-11 · `AGT-PROTO` · Fencing par epoch
**Périmètre** : D.2.3, F.2.2.
**Acceptation** : forcer le scénario « le Pi redémarre pendant que le PC travaille » et démontrer qu'**un seul** worker peut revendiquer le worktree. Un worker à epoch périmé se termine.
**Criticité** : c'est le seul mécanisme qui empêche la corruption silencieuse de worktree. Sans lui, la panne ne produit aucune erreur — juste du code incohérent.

### M-12 · `AGT-PROTO` · Séquence et reprise du canal d'observation
**Périmètre** : D.2.2, D.2.1, E.2.3.
**Acceptation** : (a) déconnecter un client 5 min, reconnecter ⇒ reprise au high-water mark, **pas de rejeu complet** ; (b) les coupures transitoires **ne remontent pas** à l'orchestrateur ; (c) un client lent ne ralentit **pas** le worker.

### M-13 · `AGT-PROTO` · Canal de contrôle
**Périmètre** : D.3.1, D.3.2.
**Acceptation** : opérations mutatives idempotentes par identifiant fourni par le Pi ; rejeu sans effet double ; le PC n'initie jamais (hors canal d'observation).

---

## Lot 2 — Permissions (dépend du lot 0, parallèle au lot 1)

### M-20 · `AGT-SEC` · Plancher de déni
**Périmètre** : C.1.3, G.2.
**Livrable** : la liste de motifs **scopés**, plus un test par motif.
**Acceptation** : chaque motif démontre un refus effectif **dans le mode réellement utilisé en production**. Aucun nom d'outil nu dans le plancher.
**Interdit** : plus de ~15 motifs. Un plancher qui déclenche quotidiennement sera contourné.

### M-21 · `AGT-SEC` · Machine à états des demandes
**Périmètre** : C.2.1, C.2.2, C.3.2, C.3.3.
**Acceptation** : les cinq invariants I-1 à I-5 sont vérifiables par test. En particulier : (a) redélivrance après coupure ⇒ **pas de doublon de notification** ; (b) une demande déjà répondue ⇒ **réémission du verdict**, pas de nouvelle sollicitation ; (c) `[répondue]` sans `[confirmée]` au-delà du seuil ⇒ alerte.

### M-22 · `AGT-SEC` · Arbitrage délégué et audit
**Périmètre** : H-40, C.5, C.1.1, C.1.2.
**Acceptation** : (a) `permissionMode: 'auto'` actif, les décisions du classifieur sont **tracées avec leur auteur** ; (b) hook `PreToolUse` pour l'audit exhaustif, distinct de `canUseTool` ; (c) la trace permet de répondre à « le classifieur a-t-il autorisé ce que je n'aurais pas autorisé ». **C'est cette trace qui valide ou invalide H-40** — sans elle, la délégation est un pari aveugle.

### M-23 · `AGT-SEC` · Voie d'escalade humaine
**Périmètre** : C.4, C.2.4.
**Décision déléguée** : implémenter le hors-bande (C.2.3) ou rester en `PermissionResult` synchrone. **Défaut recommandé : synchrone en v1** — ça supprime le mode de panne le plus dangereux du système. Passer au hors-bande **seulement** si la mesure montre une dégradation du worker.
**Acceptation** : (a) file durable, survit au redémarrage du Pi ; (b) annulation d'une demande caduque, **pas d'invite zombie** ; (c) sur `deny`, le message explique le motif **et** l'alternative ; (d) si hors-bande : `null` retourné **uniquement après confirmation** que l'envoi a réussi.

---

## Lot 3 — État et projets (dépend des lots 0 et 1)

### M-30 · `AGT-ETAT` · Réconciliation
**Périmètre** : E.1.4, A.4.2, D.2.4.
**Acceptation** : (a) fantômes marqués terminés ; (b) orphelins adoptés ou tués, **jamais ignorés** ; (c) le PC gagne en cas de divergence ; (d) l'étape `reinitialize()` de D.2.4 est présente — sans elle, les permissions demandées pendant la coupure ne réatteignent jamais `canUseTool`.

### M-31 · `AGT-ETAT` · Adaptateur `SessionStore`
**Périmètre** : E.3.
**Acceptation** : (a) `uuid` comme clé d'idempotence, rejeu d'`importSessionToStore()` sans doublon ; (b) entrées sans `uuid` ajoutées sans dédup ; (c) `listSessions` implémenté — sinon `listSessions()` **lève** ; (d) les `mirror_error` sont surveillés et signalés ; (e) aucune logique critique ne suppose le store complet.

### M-32 · `AGT-ETAT` · Modèle de projets
**Périmètre** : F.1, F.2, F.4.
**Acceptation** : (a) **ajouter un projet = déposer un fichier**, sans redémarrage ni modification de code ; (b) validation complète au chargement, projet invalide écarté et non chargé partiellement ; (c) association worktree enregistrée **avant** le spawn ; (d) travail non commité ⇒ worktree **jamais** supprimé ; (e) projet non-git signalé comme isolation non garantie.
**Non couvert** : la création de projet (H-32 non tranchée). Demander avant d'ouvrir.

### M-33 · `AGT-SDK` · Pause et reprise
**Périmètre** : B.4, H-46.
**Acceptation** : (a) pause pendant un tour actif, 5 minutes, reprise ⇒ **aucune instruction perdue ni dupliquée** ; (b) le reçu d'interruption est **lu avant** le `SDKResultMessage`, pas la file après ; (c) les UUID inconnus du reçu sont ignorés, pas traités comme erreur ; (d) mode dégradé documenté si `interrupt_receipt_v1` est absent.

### M-34 · `AGT-SDK` · Relance et classification
**Périmètre** : B.3.2, B.3.3.
**Acceptation** : (a) `TerminalReason` mappé selon le tableau, **pas de taxonomie maison** ; (b) un échec structurel n'est **jamais** relancé ; (c) `budget_exhausted` n'est **jamais** relancé automatiquement ; (d) plafond de relances, puis `echec_definitif`.

---

## Lot 4 — Orchestrateur (dépend de 0, 2, 3)

### M-40 · `AGT-SDK` · Serveur MCP de contrôle
**Périmètre** : A.2.
**Acceptation** : (a) **tout outil rend la main immédiatement** ; (b) contrat de retour uniforme, `'accepte'` distinct de `'applique'` ; (c) `readOnlyHint` sur les outils d'inspection ; (d) **aucun outil ne lève** vers le modèle.

### M-41 · `AGT-SDK` · Session orchestrateur
**Périmètre** : A.1, A.3.2, A.4.2.
**Acceptation** : (a) ni `Bash`, ni `Write`, ni `Edit` ; (b) `sessionId` fixé, reprise après redémarrage du Pi ; (c) `startup()` au boot ; (d) désambiguïsation via `AskUserQuestion` natif ; (e) **aucun flux brut n'entre dans son contexte** (H-45).

### M-42 · `AGT-SDK` · Discipline de contexte
**Périmètre** : A.1.4, E.4.1.
**Acceptation** : (a) `getContextUsage()` échantillonné avec seuils ; (b) compactions observées via hooks et `SDKCompactBoundaryMessage` ; (c) une compaction fréquente **remonte comme défaut**, pas comme normalité.

---

## Lot 5 — Surface et sûreté

### M-50 · `AGT-UI` · Client temps réel
**Périmètre** : E.2, C.4.2, F.
**Acceptation** : (a) les trois granularités affichées, arbre d'exécution reconstruit via `parent_tool_use_id` / `parent_agent_id` ; (b) `requires_action` visuellement distinct ; (c) reprise au high-water mark ; (d) mode miroir disponible ; (e) fonctionne avec plusieurs équipes sans saturer l'écran.

### M-51 · `AGT-SEC` · Budgets
**Périmètre** : G.1, E.4.2, E.4.3.
**Acceptation** : (a) `maxBudgetUsd` par équipe, arrêt propre ; (b) plafond de parc bloquant les **créations**, sans tuer l'existant ; (c) les trois catégories de messages d'usage traitées différemment — `☠` ne pas confondre avertissement et erreur ; (d) `CLAUDE_CODE_RETRY_WATCHDOG` **jamais** activé sans budget actif.

### M-52 · `AGT-SEC` · Arrêt d'urgence
**Périmètre** : G.4.
**Acceptation** : (a) chemin **ne passant pas** par l'orchestrateur ; (b) ne détruit aucun travail non commité ; (c) grâce respectée avant `kill` ; (d) **test récurrent**, pas unique.

### M-53 · `AGT-TEST` · Validation des cinq propriétés
**Périmètre** : critère de réussite de `03`.
**Acceptation** : un test par propriété — non-blocage, isolation, reprise, modularité, bornage.
**Statut** : **c'est cette mission qui déclare le harness terminé.** Aucune autre.

---

## Lot 6 — Cycle de projet et intégration (débloqué)

Toutes les questions bloquantes sont tranchées. Ces missions dépendent des lots 3 et 4.

### M-60 · `AGT-SDK` · Création et modification de projet
**Périmètre** : F2.2, F2.3. Résout H-32.
**Acceptation** : (a) les trois cas — adoption, initialisation, clonage — sont distincts ; (b) création **uniquement** dans une racine de projets déclarée ; (c) validation complète même pour un projet qu'on vient d'écrire, **pas de raccourci** ; (d) le maître **ne génère pas** le contenu initial — il dispatche une mission d'échafaudage ; (e) modification de **contenu** impossible en direct, toujours par mission ; (f) suppression retire la config, **jamais le dépôt du disque**.
**Interdit** : donner `Bash`, `Write` ou `Edit` au maître pour échafauder.

### M-61 · `AGT-SDK` · Dispatch et lots
**Périmètre** : F2.1, F2.0.1, F2.0.2.
**Acceptation** : (a) un mandat sans `critere_arret` **testable** est refusé au dispatch ; (b) périmètres disjoints vérifiés avant parallélisation, recouvrement ⇒ sérialisation ; (c) pas de dépendance circulaire ; (d) le registre suit **les lots**, pas seulement les missions — « où en est ce que j'ai demandé hier soir » doit avoir une réponse ; (e) `terminee` est traité comme cas **nominal**, pas exceptionnel.
**Renotification M-03** : le schéma doit porter un **historique de missions et de lots**. Le volume attendu est « N missions courtes × rétention », pas « quelques équipes durables ».

### M-62 · `AGT-SDK` · Mission d'intégration
**Périmètre** : H.1. Résout F2.4 en posture (b).
**Acceptation** : (a) déclenchée sur **lot complet**, jamais avec une mission active ; (b) le mandat porte **les mandats d'origine** de chaque branche, pas seulement les noms de branches ; (c) conflit **sémantique** escaladé, conflit **textuel** résolu — la distinction est explicite dans le mandat ; (d) fusion **séquentielle**, ordre déterminé et consigné **avant** de commencer ; (e) échec ⇒ cible dans son état antérieur, branches sources intactes, état `integration_partielle`.
**Vérification précoce imposée** : tester sur un cas réel que l'agent distingue effectivement textuel et sémantique. Si non fiable ⇒ escalader tout conflit non trivial (repli documenté en H.1.4).

### M-63 · `AGT-ETAT` · Rétention et compression
**Périmètre** : H.3.
**Acceptation** : (a) `foldSessionSummary` appelée **depuis `append()`**, `data` persisté **verbatim** et jamais interprété ; (b) `mtime` estampillé **à la persistance**, même horloge que `listSessions()` — pas dérivé des horodatages d'entrées ; (c) cycle lire-plier-écrire **sérialisé** par session ; (d) `listSessionSummaries` implémentée ; (e) `delete` implémentée — sinon suppression silencieusement sans effet ; (f) **`listSubkeys` implémentée** — sinon la reprise perd tous les transcripts de sous-agents, sans erreur ; (g) paliers 1 et 2 avant tout palier 3.
**Interdit** : compresser la vérité (disque PC). Condenser une mission non terminale.

### M-64 · `AGT-SDK` · Mission de condensation
**Périmètre** : H.3.3.
**Acceptation** : (a) la condensation est **dispatchée comme mission**, jamais exécutée dans le tour du maître ; (b) traçable — chaque condensé enregistre la plage remplacée et la date ; (c) jamais sur une mission non terminale.
**Prérequis** : ne pas commencer avant d'avoir mesuré si le palier 2 suffit.

---

## Missions closes sans implémentation

| Mission | Décision |
|---|---|
| Mode dégradé PC éteint | **Clos.** H-30 tranchée : pas de réveil, pas de file d'attente. Comportement propre en cas d'indisponibilité (H.2.2) intégré à M-13. `☠` Ne **pas** implémenter de file « pour plus tard » — échouer visiblement vaut mieux qu'attendre en silence. |
| Chemin serveur | **Différé, rien à spécifier.** Préservé par construction. Seule règle active : aucun composant ne suppose que le PC est la machine personnelle de l'opérateur (H.2.3). À vérifier en revue. |

---

## Missions restant à arbitrer par mesure

| Mission | Déclencheur |
|---|---|
| M-70 · Rotation de l'orchestrateur | A.4.1 — décider **sur chiffres** de `getContextUsage()`, pas a priori |
| M-71 · Bac à sable | G.3 — évaluer la friction sur cas réel après mise en service |
| M-72 · Outil `Workflow` | F.3.4 — évaluer sur besoin démontré, pas préventivement |
| M-73 · Modèles de projet | F2.2.4 — ouvrir seulement si l'échafaudage se répète |
