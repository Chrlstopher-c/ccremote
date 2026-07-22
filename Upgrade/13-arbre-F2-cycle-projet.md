# Branche F2 — Cycle de vie des projets et modèle de dispatch

**Débloque M-60.** Résout H-32 : l'orchestrateur maître **crée et modifie** des projets.

**Profondeur atteinte : 4** sur le dispatch, **3** sur la création, **2** sur l'intégration (nouvelle question bloquante, voir F2.4).

---

## F2.0 — Deux requalifications imposées par la décision

La création de projet était le point visible. Deux conséquences plus structurantes en découlent.

### F2.0.1 Une équipe est une **instance de mission**, pas une entité durable `⊣ TERMINAL`

Formulation opérateur : *« chaque lancement de team leader sera dans un but bien précis. »*

Cela **requalifie H-11**. Une équipe n'est pas un objet persistant attaché à un projet — c'est une **mission instanciée**, avec un but explicite, une durée de vie liée à l'atteinte de ce but, et un worktree qui naît et meurt avec elle.

| Avant | Après |
|---|---|
| Équipe = entité de long terme sur un projet | Équipe = mission bornée, jetable |
| État `terminee` = fin de vie exceptionnelle | État `terminee` = **cas nominal** |
| Worktree alloué durablement | Worktree = espace de travail d'une mission |
| Le registre suit des équipes | Le registre suit des **missions**, et leur historique |

`☠ CASSE` — dimensionner le registre pour « quelques équipes durables » alors que le régime réel est « beaucoup de missions courtes » produit un modèle de données à refaire. Le volume attendu n'est pas N équipes, c'est N missions × la durée de rétention.

**Conséquence sur M-03** : le schéma doit porter un historique de missions, pas seulement un état courant. Mission à re-notifier.

### F2.0.2 Le maître dispatche **plusieurs équipes**, éventuellement sur le même projet `⊣ TERMINAL`

Formulation opérateur : *« il envoie une ou plusieurs équipes, il gère, envoie les. »*

Git supporte N worktrees sur un dépôt, donc F.1.1 tient. Mais ça fait apparaître un problème qui n'existait pas quand une équipe = un projet : **si trois missions travaillent en parallèle sur le même dépôt, quelqu'un doit intégrer leurs branches.**

F.2.4 classait la fusion en `⊣ HORS-PÉRIMÈTRE` au motif que c'était un choix de workflow git. **Ce classement ne tient plus.** Voir F2.4 — c'est la question bloquante principale.

---

## F2.1 — Modèle de dispatch

### F2.1.1 La chaîne `⊣ TERMINAL`

```
  Toi ──conversation──▶ ORCHESTRATEUR MAÎTRE
                              │
                              │ décompose l'intention en mandats
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                MISSION 1  MISSION 2  MISSION 3
                (lead)     (lead)     (lead)
                    │         │         │
                 teammates / subagents (N2/N3 natifs)
```

Le maître **décompose et dispatche**. Il ne travaille pas.

**Invariant** `☠` : le maître n'a ni `Bash`, ni `Write`, ni `Edit` (A.1.1). Cette contrainte devient plus importante avec la création de projet — la tentation d'échafauder lui-même est directe. **Il délègue l'échafaudage à une mission dédiée** (F2.2.3).

### F2.1.2 Anatomie d'un mandat `⊣ TERMINAL`

Un mandat est l'unité de dispatch. Contenu obligatoire :

| Champ | Rôle | Sans lui |
|---|---|---|
| `but` | une phrase, résultat attendu | la mission dérive |
| `critere_arret` | **testable**, pas subjectif | la mission ne se termine jamais |
| `projet` | projet cible | — |
| `perimetre` | fichiers/répertoires autorisés | recouvrement entre missions |
| `livrable` | branche, commits, format attendu | rien d'intégrable |
| `escalade` | ce qui doit remonter plutôt qu'être décidé | décisions prises trop bas |
| `budget` | plafond de la mission | G.1 |
| `dependances` | missions à attendre | ordonnancement impossible |

`☠ CASSE` — un `critere_arret` non testable (« améliorer la qualité du code ») produit une mission qui consomme son budget entier sans jamais conclure. C'est le mode de défaillance le plus coûteux du dispatch multi-missions, parce qu'il se multiplie par le nombre d'équipes.

**Règle imposée au maître** : refuser de dispatcher un mandat sans critère d'arrêt testable. Il demande une reformulation plutôt que de lancer.

### F2.1.3 Décomposition d'une intention `⊣ DÉLÉGUÉ`

Passer de « refais l'authentification » à N mandats disjoints est un problème de prompt engineering, pas d'architecture.

Contraintes imposées, elles, architecturales :

- **Périmètres disjoints.** Deux missions simultanées sur le même projet ne doivent pas se recouvrir en fichiers. Le maître vérifie avant dispatch ; recouvrement ⇒ sérialiser au lieu de paralléliser.
- **Pas de dépendance circulaire** entre mandats.
- **Nombre borné** de missions simultanées par projet (G.1.3 en aval).

`⚠ HYP` — la vérification de disjonction est déclarative (le mandat déclare son périmètre), pas vérifiée à l'exécution. Un agent qui sort de son périmètre déclaré n'est pas bloqué par le harness, seulement par son mandat et le plancher de déni. **Renforçable par bac à sable système de fichiers** (G.3) si ça se révèle insuffisant.

### F2.1.4 Suivi d'un lot `⊣ TERMINAL`

Quand le maître dispatche N missions pour une intention, il crée un **lot**. Le registre suit le lot, pas seulement les missions.

Un lot porte : l'intention d'origine en langage naturel, ses missions, son état agrégé, son budget cumulé, et le point d'intégration (F2.4).

Sans notion de lot, tu ne peux pas répondre à « où en est ce que j'ai demandé hier soir » — seulement à « quelles missions tournent ».

---

## F2.2 — Création de projet

### F2.2.1 Ce que « créer » recouvre `⊣ TERMINAL`

Trois cas distincts, à ne pas confondre :

| Cas | Ce qui existe déjà | Action |
|---|---|---|
| **Adoption** | dépôt git existant, non connu du harness | écrire la config, valider, rien d'autre |
| **Initialisation** | rien | `git init`, échafaudage, config, premier commit |
| **Clonage** | dépôt distant | cloner, config, valider |

L'adoption est le cas fréquent et sans risque. L'initialisation est le seul qui produise du contenu.

### F2.2.2 Séquence d'initialisation `⊣ TERMINAL`

1. **Valider l'emplacement** — dans une racine de projets déclarée, jamais ailleurs. `☠` sans cette contrainte, le maître peut créer un dépôt n'importe où sur le poste.
2. **Vérifier la non-collision** — nom et chemin libres.
3. **Créer le dépôt** et le commit initial.
4. **Écrire la configuration harness** (F.1.2).
5. **Valider** comme un projet découvert (F.4.2) — même chemin de validation, pas de raccourci.
6. **Publier** le projet.

`☠ CASSE` — court-circuiter l'étape 5 parce que « c'est nous qui venons de l'écrire » laisse passer des configurations invalides qui échoueront au spawn, bien plus tard.

### F2.2.3 Échafaudage `⊣ TERMINAL`

Le maître **ne génère pas** le contenu initial (F2.1.1). Il crée le dépôt vide et configuré, puis **dispatche une mission d'échafaudage** avec un mandat comme les autres.

Bénéfices : le maître garde son contexte propre ; l'échafaudage passe par le même chemin de permissions, de budget et d'audit que le reste ; il est observable en temps réel.

### F2.2.4 Modèles de projet `⊣ DÉLÉGUÉ`

`⚠ HYP` — je suppose que l'échafaudage part d'un mandat en langage naturel, sans bibliothèque de modèles. C'est le plus simple et le plus souple.

À rouvrir si tu constates que tu redis les mêmes choses. La bascule est un répertoire de modèles référencés par la config projet — additif, pas structurant.

---

## F2.3 — Modification de projet

### F2.3.1 Deux natures de modification `⊣ TERMINAL`

| Nature | Exemples | Chemin |
|---|---|---|
| **Configuration** | budget, modèle, plancher de déni, Agent Teams | outil de contrôle direct |
| **Contenu** | code, structure, dépendances | **mission**, jamais direct |

`☠` La deuxième ligne est la frontière de A.1.1. Un maître qui modifie du contenu directement contourne permissions, budget et audit d'un seul coup.

### F2.3.2 Modification à chaud `⊣ TERMINAL`

Un changement de configuration pendant que des missions tournent :

- **N'affecte pas** les missions en cours — leurs options sont figées au spawn.
- **S'applique** aux missions suivantes.
- Exception : certaines clés sont modifiables en session via `applyFlagSettings()`, avec des règles de prise d'effet précises (voir ci-dessous).

Vérifié sur `applyFlagSettings()` :
- **Au tour suivant** : `effortLevel`, `ultracode`, `permissions`, `hooks`, `skillOverrides`, `fastMode`, `agent`. Changer `agent` applique aussi le modèle, les hooks et le prompt système de cet agent au tour suivant.
- **Pendant le tour courant** : `model`. Depuis CC v2.1.212, la réponse en cours de génération se termine sur l'ancien modèle et la suite du tour bascule ; les subagents gardent le leur.
- **Aucun effet en session** : les options de prompt système. Résolues une fois au démarrage — l'appel réussit mais la session garde la valeur d'origine. **Il faut une nouvelle session.**

`☠ CASSE` — croire qu'on peut changer le mandat d'une mission en vol. Le prompt système est figé. Changer un mandat = arrêter et redispatcher.

Autre règle vérifiée : les appels successifs **fusionnent en surface** les clés de premier niveau. Un second appel avec `{permissions: {...}}` **remplace entièrement** l'objet `permissions` du premier au lieu de fusionner en profondeur. Passer `null` pour retirer une clé et retomber sur les sources de moindre précédence ; `undefined` n'a aucun effet, la sérialisation JSON le supprime.

### F2.3.3 Suppression `⊣ TERMINAL`

Retirer un projet exige : aucune mission active, aucun worktree non libéré, aucun travail non commité (F.2.3).

`⚠ HYP` — le harness retire le projet de sa configuration mais **ne supprime jamais le dépôt du disque.** Détruire du code sur une commande en langage naturel mal comprise n'est pas un risque que je prends par défaut.

---

## F2.4 — Intégration `⊣ QUESTION BLOQUANTE`

**Requalifié depuis `⊣ HORS-PÉRIMÈTRE` (F.2.4).** Le motif d'exclusion — « une équipe par projet, la fusion est un choix de workflow » — ne tient plus dès lors que le maître dispatche plusieurs missions sur un même dépôt.

### Le problème

Trois missions, trois branches, sur un projet. Chacune conclut. Ensuite ?

Trois postures, aux conséquences très différentes :

- **(a) Le harness n'intègre pas.** Il expose l'état git de chaque branche et **tu** fusionnes. Simple, sûr, mais ça te remet dans la boucle — contraire à l'objectif « ne pas avoir à être derrière ».
- **(b) Une mission d'intégration.** Le maître dispatche une mission finale, dont le mandat est de fusionner les branches du lot et de résoudre les conflits. Cohérent avec toute l'architecture — c'est une mission comme une autre, avec budget, permissions et audit. **Mon défaut.** Coût : un agent résout des conflits de fusion sans supervision, et un conflit mal résolu est une perte de travail silencieuse.
- **(c) Intégration continue.** Les missions rebasent régulièrement sur la branche cible au lieu de diverger. Réduit les conflits terminaux mais fait perdre l'isolation du worktree en cours de route — deux missions qui rebasent l'une sur l'autre se voient mutuellement.

**Je ne tranche pas.** Le choix dépend de ton niveau de tolérance à une fusion automatique non revue, et je n'ai pas d'élément pour le supposer. Les trois sont spécifiables ; (b) est le seul qui préserve pleinement l'objectif d'autonomie.

**Ce qui est imposé quelle que soit la réponse** : le registre expose, par mission, la branche, l'avance/retard sur la cible, et les conflits potentiels détectés. Cette information est nécessaire dans les trois cas.
