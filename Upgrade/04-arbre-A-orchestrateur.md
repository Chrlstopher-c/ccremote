# Branche A — Orchestrateur

**Profondeur atteinte : 4.** S'arrête là parce que le niveau 5 serait l'implémentation des handlers d'outils, et chaque handler est une délégation vers une autre branche.

---

## A.1 — Le processus orchestrateur

Une session Agent SDK longue durée sur le Pi. Elle vit tant que le Pi vit.

### A.1.1 Configuration de session `⊣ TERMINAL`

Contrat de démarrage :

- **Prompt système** : preset `claude_code` avec `append`. Vérifié : pour charger un `CLAUDE.md`, il faut **à la fois** `settingSources: ['project']` **et** la forme preset — c'est le piège classique où l'un sans l'autre ne fait rien.
- **Entrée** : `AsyncIterable<SDKUserMessage>` maintenu ouvert (voir A.1.3).
- **Outils** : le serveur MCP de contrôle (A.2) **plus** un jeu minimal de lecture locale. **Pas** `Bash`, **pas** `Write`, **pas** `Edit`. L'orchestrateur ne touche à aucun fichier de projet — il commande, il n'exécute pas.
- **Modèle** : Opus (H-23).
- **Persistance** : `sessionStore` vers SQLite du Pi, plus le disque local.
- `⚠ HYP` **Skills** : aucune par défaut. À rouvrir si l'orchestrateur doit produire des documents.

### A.1.2 Cycle de vie `⊣ TERMINAL`

- **Démarrage à froid** : nouvelle session, `sessionId` fixé par le harness (pas auto-généré) pour être retrouvable après redémarrage du Pi.
- **Reprise** : `resume` avec l'ID connu. `⚠ HYP` la session de l'orchestrateur vit indéfiniment ; à confronter à la compaction — voir A.4.
- **Pré-chauffage** : `startup()` au boot du Pi sort le coût de spawn du chemin critique. Ta première question depuis le téléphone est alors immédiate.
- **Arrêt** : `close()` sur extinction propre. Les workers du PC **survivent** — ils ne sont pas des enfants de l'orchestrateur (voir B.1.4).

### A.1.3 Le générateur d'entrée `⊣ TERMINAL` `☠ CASSE`

L'`AsyncIterable<SDKUserMessage>` doit rester **ouvert tant que la session vit**. S'il se ferme pendant que Claude travaille, `canUseTool` et les hooks cessent d'être appelés — symptôme observé : `Error: Stream closed` sur stderr, et le reste continue de fonctionner, ce qui rend le diagnostic très trompeur.

Contrat : une file de messages avec un signal d'attente ; le générateur n'atteint jamais son terme naturel ; seule la fermeture explicite de la session le termine.

**Test d'acceptation** : ouvrir une session, ne rien envoyer pendant 10 minutes, déclencher une action nécessitant une permission, vérifier que `canUseTool` est appelé.

### A.1.4 Discipline de contexte `⊣ TERMINAL`

Le risque : l'orchestrateur voit passer les événements de N équipes et sature.

Trois mesures, toutes vérifiées comme disponibles :

1. **Rien de brut n'entre.** L'orchestrateur ne reçoit que des résumés produits par [E]. Les flux bruts vont au registre et à l'UI, jamais dans son contexte.
2. **Mesure, pas estimation.** `getContextUsage()` sur la session de l'orchestrateur, échantillonné. Seuils d'alerte, pas de devinette.
3. **Compaction observée.** Les hooks `PreCompact`/`PostCompact` et les messages `SDKCompactBoundaryMessage` permettent de savoir *quand* il a compacté. Une compaction fréquente est le signal que la mesure 1 fuit.

`⚠ HYP` — je suppose que résumer suffit. Si tu constates que l'orchestrateur perd le fil du parc après compaction, la parade est un « état du parc » **reconstruit à la demande** depuis [E] plutôt que mémorisé. Prévoir le point d'extension, pas l'implémenter tout de suite.

---

## A.2 — Le serveur MCP de contrôle

En-process (`createSdkMcpServer`), dans le processus de l'orchestrateur. Ni réseau, ni sous-processus.

### A.2.1 Principe de conception `⊣ TERMINAL`

**Tout outil rend la main immédiatement.** Aucun n'attend qu'une équipe finisse. Un outil qui déclenche un travail long retourne un accusé de prise en compte, et le résultat arrive plus tard comme événement.

**Chaque outil déclare son annotation.** `readOnlyHint: true` sur les outils d'inspection — ça permet de les auto-approuver sans ouvrir les outils mutatifs.

**Granularité** : un outil = une intention utilisateur, pas une opération technique. `relancer_equipe` plutôt que `kill_process` + `spawn_process`.

### A.2.2 Surface d'outils `⊣ TERMINAL`

Groupe **inspection** (lecture seule, auto-approuvables) :

| Outil | Intention | Délègue à |
|---|---|---|
| `lister_equipes` | Quelles équipes, quels états | E |
| `etat_equipe` | Détail d'une équipe : tâche, coût, contexte, dernier événement | E |
| `lister_projets` | Projets connus et leur worktree | F |
| `historique_equipe` | Derniers échanges, **résumés** | E |
| `permissions_en_attente` | Ce qui bloque, et depuis quand | C |

Groupe **cycle de vie** (mutatif) :

| Outil | Intention | Délègue à |
|---|---|---|
| `creer_equipe` | Nouvelle équipe sur un projet, avec un mandat | F puis B |
| `envoyer_a_equipe` | Transmettre une instruction | D |
| `interrompre_equipe` | Stopper le tour en cours | B |
| `arreter_equipe` | Fin de vie, libération du worktree | F puis B |
| `relancer_equipe` | Reprendre après crash, avec `resume` | B |

Groupe **arbitrage** :

| Outil | Intention | Délègue à |
|---|---|---|
| `repondre_permission` | Verdict sur une demande | C |
| `definir_budget` | Plafond d'une équipe | G |
| `arret_urgence` | Tout arrêter, immédiatement | G |

**RÉSOLU — voir H-47.** L'arbitrage nominal appartient au lead de chaque équipe via `permissionMode: 'auto'` (H-40). L'orchestrateur **ne répond pas aux permissions en régime nominal.**

`repondre_permission` subsiste pour la **seule voie d'escalade** — ce que le classifieur a refusé et qui remonte à l'humain. Son verdict est tracé comme **décision humaine par procuration**, pas comme décision d'agent.

Écarté définitivement : un orchestrateur habilité à répondre à tout. Un agent capable de s'accorder ses propres permissions n'a plus de garde-fou.

### A.2.3 Contrat de retour `⊣ TERMINAL`

Uniforme sur tous les outils. Forme de données (spec, pas implémentation) :

```
{
  ok: boolean
  intention: string          // ce qui a été compris
  effet: 'applique' | 'accepte' | 'refuse' | 'differe'
  ref?: string               // id de suivi pour un effet asynchrone
  etat?: <résumé court>      // état APRÈS, pour éviter un aller-retour
  raison?: string            // obligatoire si refuse
}
```

`effet: 'accepte'` = pris en compte, pas terminé. La distinction avec `'applique'` est ce qui empêche l'orchestrateur de croire qu'un travail long est fini.

### A.2.4 Erreurs `⊣ TERMINAL`

Un outil de contrôle ne lève **jamais** vers le modèle. Il retourne `ok: false` avec une raison en langage naturel exploitable. Une exception qui remonte fait dérailler le tour de l'orchestrateur et coûte un contexte entier.

---

## A.3 — Traduction intention → action

### A.3.1 Formulation du mandat `⊣ DÉLÉGUÉ`

Quand tu dis « lance une équipe pour refaire l'authentification sur projet-alpha », l'orchestrateur doit produire le prompt initial de l'équipe. C'est un problème de **prompt engineering**, pas d'architecture : il se re-décompose une fois qu'on voit de vrais mandats.

Contraintes fixées : le mandat doit contenir un critère d'arrêt explicite, le périmètre de fichiers autorisé, et l'interdiction de sortir du worktree. Il ne doit pas contenir de secrets.

### A.3.2 Désambiguïsation `⊣ TERMINAL`

Quand l'intention est ambiguë (« arrête ça » avec trois équipes actives), l'orchestrateur demande, il ne devine pas. Le SDK expose `AskUserQuestion` — utiliser le mécanisme natif plutôt qu'inventer un protocole de question.

Vérifié : `AskUserQuestion` atteint `canUseTool` **même si une règle d'allow correspond**, et en mode `dontAsk` il est **refusé** au lieu d'être présenté. Conséquence directe : une équipe en `dontAsk` ne peut pas poser de question — si elle a besoin d'un arbitrage, elle échoue. À documenter comme propriété du mode, pas comme bug.

---

## A.4 — Longévité

### A.4.1 Rotation `⊣ DÉLÉGUÉ`

Une session d'orchestrateur qui vit des semaines finira par compacter de façon répétée et perdre en qualité.

Trois stratégies, à départager par mesure et non a priori :

- **(a)** Laisser compacter. Simple, dégrade lentement.
- **(b)** Rotation périodique : nouvelle session, amorcée par un état du parc reconstruit depuis [E]. `forkSession` existe et facilite ça.
- **(c)** Deux sessions : une courte pour la conversation, une longue pour l'état. Complexe.

**Instruction à l'agent** : instrumenter (b) comme point d'extension, démarrer en (a), décider avec des chiffres.

### A.4.2 Survie au redémarrage du Pi `⊣ TERMINAL`

Au boot : reprendre la session par son ID connu, puis **réconcilier** — [E] réinterroge le PC pour savoir quelles équipes tournent encore, et corrige le registre. Le registre du Pi n'est pas l'autorité sur ce qui tourne réellement ; le PC l'est.

`☠ CASSE` — sans cette réconciliation, tu obtiens des équipes fantômes (au registre mais mortes) et des équipes orphelines (vivantes mais inconnues). Les orphelines sont pires : elles consomment ton budget sans apparaître nulle part.
