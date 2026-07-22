# Couche 1 — architecture

## Le principe qui gouverne tout le reste

Le harness possède **le niveau 1 et rien d'autre** : plusieurs sessions Claude Code, sur plusieurs projets, en parallèle, pilotables à distance. Ce qui se passe à l'intérieur d'une session appartient à Claude Code.

Reformulé en une phrase testable :

> Le harness est un **gestionnaire de sessions distantes avec un canal d'approbation humaine asynchrone**. Ce n'est pas un framework multi-agents.

Tout composant qui ne sert pas ces deux fonctions est hors périmètre.

---

## Vue d'ensemble

```
        TÉLÉPHONE (client léger, jetable, peut être éteint)
              │  conversation  │  file d'approbation  │  supervision
              ▼                ▼                      ▼
    ┌─────────────────────────────────────────────────────────┐
    │  PI — CONTROL PLANE (autorité unique)                    │
    │                                                          │
    │   [A] Orchestrateur      ← session Agent SDK + MCP maison│
    │   [C] Bus de permissions ← file durable, réponses h.-b.  │
    │   [E] Registre d'état    ← équipes, epochs, high-water   │
    │   [F] Modèle projets     ← projet↔worktree↔équipe        │
    │   [G] Garde-fous         ← budgets, quotas, arrêt d'urg. │
    └───────────────────────────┬─────────────────────────────┘
                                │  [D] TRANSPORT — LAN
                                │  paires stdin/stdout + méta
    ┌───────────────────────────▼─────────────────────────────┐
    │  PC — PLAN D'EXÉCUTION (aucune décision)                 │
    │                                                          │
    │   [B] Superviseur de workers                             │
    │        ├── worker « projet-alpha »  → session CC ──┐     │
    │        ├── worker « projet-beta »   → session CC   │ N2/N3│
    │        └── worker « projet-gamma »  → session CC ──┘ natif│
    └──────────────────────────────────────────────────────────┘
```

---

## Les sept composants

### [A] Orchestrateur — `04-arbre-A`

**Ce qu'il est** : une session Agent SDK, avec un serveur MCP en-process qui expose les outils de contrôle du parc. C'est lui, ta « discussion générale avec Claude ».

**Responsabilité unique** : traduire ton intention en langage naturel en appels d'outils de contrôle, et te restituer l'état du parc en langage naturel.

**Ce qu'il n'est pas** : il ne parle pas aux équipes en bash, ne lit pas leurs fichiers, n'a pas accès à leurs disques. Son seul moyen d'agir sur une équipe est le serveur MCP de contrôle.

**Invariant** `☠` : l'orchestrateur ne **bloque jamais** sur l'exécution d'une équipe. Tout outil de contrôle rend la main immédiatement ; les résultats arrivent en événements.

### [B] Superviseur de workers — `05-arbre-B`

**Responsabilité unique** : sur le PC, faire naître, vivre et mourir des processus Claude Code, et exposer leurs flux.

**Invariant** : le superviseur ne décide rien. Il n'interprète pas le contenu des flux, ne juge pas des permissions, n'a pas d'opinion sur les équipes. Il exécute des ordres du Pi et rapporte des faits.

**Pourquoi séparé de [D]** : le transport doit pouvoir être remplacé (SSH aujourd'hui, autre chose demain) sans toucher au cycle de vie des processus.

### [C] Bus de permissions — `06-arbre-C`

**Responsabilité unique** : convoyer une demande d'autorisation depuis un agent bloqué jusqu'à un humain, et ramener la réponse, à travers des déconnexions et des redémarrages.

C'est **le composant le plus risqué du système** et celui qui descend le plus profond. Raisons : les demandes n'expirent jamais ; les réponses arrivent par un canal différent de celui des demandes ; les demandes sont redélivrées après une coupure et doivent être traitées de manière idempotente ; une réponse perdue bloque un agent pour toujours sans erreur visible.

### [D] Transport — `07-arbre-D`

**Responsabilité unique** : donner au Pi une paire stdin/stdout attachée à un processus qui tourne sur le PC, et survivre aux coupures.

**Invariant** `☠` : ne jamais interpréter le contenu du canal principal. Le transport est aveugle au contenu (H-12).

### [E] Registre d'état et observabilité — `08-arbre-E`

**Responsabilité unique** : savoir, à tout instant, quelles équipes existent, dans quel état, depuis quand, à quel coût, et avec quelle marge de contexte restante.

Trois états, repris de la Découverte 2 : `idle`, `running`, `requires_action`. Le troisième est celui qui déclenche une notification.

### [F] Modèle de projets et d'équipes — `09-arbre-F`

**Responsabilité unique** : matérialiser le triplet projet ↔ worktree ↔ équipe, et garantir qu'il reste cohérent.

C'est ici que vit la modularité que tu demandes : ajouter un projet ne doit toucher aucun autre composant.

### [G] Garde-fous — `10-arbre-G`

**Responsabilité unique** : empêcher qu'un parc autonome consomme sans limite ou fasse des dégâts irréversibles pendant que tu dors.

Non négociable dans un système qui tourne sans surveillance et dont tu es le seul opérateur.

---

## Les six frontières, et pourquoi elles sont là

| Frontière | Ce qui la traverse | Ce qui ne la traverse jamais |
|---|---|---|
| A ↔ C | Demandes de permission résumées, verdicts | Le flux brut d'une équipe |
| A ↔ E | Requêtes d'état, résumés | Les transcripts complets |
| A ↔ B | Rien — **jamais direct.** Passe par C/E/F | Tout |
| Pi ↔ PC (D) | Octets de flux opaques, métadonnées de contrôle | Toute décision — le PC n'en prend aucune |
| C ↔ téléphone | Une demande résumée, un verdict | Le contexte complet de l'agent |
| Harness ↔ intérieur d'une session | Ordres de haut niveau, événements | La coordination interne (N2/N3 natifs) |

La frontière **A ↔ B inexistante** est délibérée : elle empêche l'orchestrateur de contourner le bus de permissions en parlant directement aux workers. Si une mission crée ce lien, c'est un défaut de conception, pas un raccourci.

---

## Les trois flux critiques

**Flux 1 — tu demandes quelque chose.**
Toi → téléphone → [A] → outil MCP de contrôle → [F] résout le projet → [E] enregistre l'intention → [D] → [B] spawn ou réveille un worker → session CC démarre. **[A] rend la main immédiatement.**

**Flux 2 — un agent est bloqué.**
Agent → `canUseTool` dans le worker → [C] enregistre la demande, statut `requires_action` dans [E] → notification → téléphone → verdict → [C] réinjecte via `requestId` → l'agent repart.
Ce flux traverse tout le système, dans les deux sens, avec un humain à latence indéterminée au milieu. C'est le chemin critique du harness.

**Flux 3 — le lien tombe.**
[D] détecte, distingue transitoire de terminal, retente en interne. Au retour : `reinitialize()` récupère les demandes de permission en attente, le high-water mark évite de rejouer l'historique, l'epoch empêche un worker fantôme de revendiquer la session. [C] déduplique les demandes redélivrées.
**Ce flux est celui qu'on oublie de spécifier et qui décide si le système est utilisable en mobilité.**

---

## Critère de réussite de la couche 1

Le harness est correct si ces cinq propriétés tiennent :

1. **Non-blocage** — aucune opération de l'orchestrateur n'attend l'exécution d'une équipe.
2. **Isolation** — l'échec d'une équipe n'affecte aucune autre.
3. **Reprise** — perdre le lien réseau puis le retrouver ne perd ni ne duplique aucune demande de permission.
4. **Modularité** — ajouter un projet ne modifie aucun composant existant.
5. **Bornage** — aucune équipe ne peut dépasser son budget sans arrêt automatique.

Chaque propriété est testable ; la branche correspondante porte le test. Une implémentation qui ne peut pas démontrer les cinq n'est pas terminée.
