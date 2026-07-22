# Branche H — Intégration, disponibilité, rétention

Résout les trois dernières questions bloquantes. **Débloque M-60, M-61, M-62.**

**Profondeur atteinte : 4** sur l'intégration et la rétention, **2** sur la disponibilité (volontairement peu, voir H.2).

---

## H.1 — Mission d'intégration `[décision : F2.4 = (b)]`

L'intégration est une **mission comme les autres**, dispatchée par le maître, avec budget, permissions et audit. Pas un mécanisme spécial du harness.

### H.1.1 Pourquoi ça tient `⊣ TERMINAL`

Bénéfice de conception : aucune machinerie nouvelle. L'intégration hérite du plancher de déni, du plafond de budget, de la trace d'audit, de l'observabilité temps réel et de l'arrêt d'urgence. Un mécanisme de fusion dédié aurait dû réimplémenter les cinq.

**Coût assumé, à énoncer clairement** : un agent résout des conflits de fusion sans supervision. Un conflit mal résolu est une **perte de travail silencieuse** — le code compile, les tests passent peut-être, et une décision d'une autre mission a disparu. C'est le risque résiduel principal de l'architecture, et H.1.4 existe pour le borner.

### H.1.2 Déclenchement `⊣ TERMINAL`

L'intégration se rattache au **lot** (F2.1.4), pas à une mission isolée.

Condition : toutes les missions du lot ont atteint un état terminal. Une mission en `echec_definitif` **n'empêche pas** l'intégration — sa branche est simplement exclue, et le fait est consigné dans le mandat d'intégration.

`☠ CASSE` — déclencher l'intégration alors qu'une mission tourne encore produit une fusion sur une base mouvante. La condition se vérifie sur le registre, pas sur une estimation de durée.

`⚠ HYP` — déclenchement automatique à la complétion du lot. Alternative : le maître propose et attend ton accord. Réversible ; c'est un drapeau par lot. Défaut = automatique, conformément à l'objectif d'autonomie.

### H.1.3 Mandat d'intégration `⊣ TERMINAL`

Champs de F2.1.2, plus les spécificités :

| Champ | Contenu |
|---|---|
| `branches_source` | les branches du lot, avec le mandat d'origine de chacune |
| `branche_cible` | où intégrer |
| `ordre` | séquence de fusion — voir H.1.5 |
| `exclusions` | branches écartées, avec motif |
| `critere_arret` | cible à jour, build vert, aucune branche source non traitée |
| `escalade` | **tout conflit sémantique** — voir H.1.4 |

Le mandat porte **les mandats d'origine**, pas seulement les branches. Un agent qui résout un conflit sans savoir ce que chaque mission cherchait à faire arbitre à l'aveugle. C'est le champ qui distingue une intégration informée d'un `git merge` avec un modèle par-dessus.

### H.1.4 Frontière conflit textuel / conflit sémantique `⊣ TERMINAL`

Distinction **structurante**, et c'est elle qui borne le risque de H.1.1.

| Type | Définition | Traitement |
|---|---|---|
| **Textuel** | deux missions ont touché des lignes voisines, les intentions ne s'opposent pas | l'agent résout |
| **Sémantique** | deux missions ont pris des décisions **incompatibles** — signatures divergentes, modèles de données contradictoires, hypothèses opposées | **escalade obligatoire** |

`☠ CASSE` — laisser un agent trancher un conflit sémantique, c'est lui faire choisir entre deux décisions d'architecture prises par d'autres agents, sans le contexte de ni l'une ni l'autre. C'est exactement le cas où la perte est silencieuse.

`⚠ HYP` — je suppose qu'un agent sait distinguer les deux quand on le lui demande explicitement dans le mandat. **À vérifier tôt sur un cas réel.** Si la distinction n'est pas fiable, le repli est d'escalader tout conflit non trivial, ce qui dégrade l'autonomie sans casser l'architecture.

### H.1.5 Ordre et incrémentalité `⊣ TERMINAL`

Fusion **séquentielle**, une branche à la fois, commit après chaque intégration réussie.

Motif : une fusion à trois branches simultanée rend l'attribution des conflits impossible. En séquentiel, chaque conflit a exactement deux origines identifiables.

Ordre : par périmètre croissant — la mission qui a touché le moins de fichiers d'abord. Une branche large fusionnée en premier fait apparaître des conflits sur toutes les suivantes.

`⊣ DÉLÉGUÉ` — l'heuristique d'ordonnancement se raffinera sur des cas réels. Contrainte imposée : l'ordre est **déterminé et consigné avant** de commencer, pas improvisé en cours de route.

### H.1.6 Échec `⊣ TERMINAL`

Une intégration qui échoue **ne laisse pas la cible dans un état intermédiaire.** Soit la fusion d'une branche aboutit et est commitée, soit elle est abandonnée et la cible revient à son état précédent.

Les branches sources **survivent toujours** à un échec d'intégration. F.2.3 s'applique : aucun worktree porteur de travail non intégré n'est supprimé.

État du lot : `integration_partielle`, avec la liste de ce qui est passé et de ce qui reste. Notification.

---

## H.2 — Disponibilité de la machine `[décision : H-30 = non bloquant]`

### H.2.1 Décision `⊣ TERMINAL`

Pas de réveil de machine, pas de file « en attente de machine ». Justification opérateur : quand tu parles au maître pour travailler, le PC est allumé.

**Conséquence** : D.4 et M-61 sont **clos sans implémentation.** Spécifier un mode dégradé pour un problème qui ne se pose pas est du gaspillage — c'était l'instruction de D.4, elle s'applique.

### H.2.2 Ce qui reste nécessaire `⊣ TERMINAL`

Un PC indisponible reste **possible** — extinction accidentelle, coupure, redémarrage. Le comportement doit être propre, sans machinerie :

- PC injoignable au dispatch ⇒ le maître **répond clairement** que la machine n'est pas disponible. Il ne met pas en file, ne réessaie pas indéfiniment.
- PC qui disparaît en cours de mission ⇒ traité par D.2.1 (transitoire absorbé, terminal remonté) et par la réconciliation D.2.4 au retour.
- Les missions en cours **survivent** à un redémarrage du Pi (B.1.4), pas à celui du PC.

`☠ CASSE` — implémenter une file d'attente « pour plus tard » alors qu'aucun réveil n'existe produit des missions qui dorment indéfiniment sans que personne ne le sache. **Échouer visiblement vaut mieux qu'attendre en silence.**

### H.2.3 Chemin serveur `⊣ HORS-PÉRIMÈTRE — futur`

Intention déclarée : plus tard, faire tourner ça sur un serveur.

**Ne rien spécifier maintenant.** Ce qui rend la migration possible est déjà en place par construction : le PC ne prend aucune décision (`03`), le transport est isolé derrière `spawnClaudeCodeProcess` (D.1.3), la config machine est lue et non embarquée (H-44), et l'état vit au Pi (H-21).

**La seule règle à préserver activement** : aucun composant ne suppose que le PC est *ta* machine. Pas de chemins absolus en dur, pas d'hypothèse d'utilisateur unique, pas de dépendance à un environnement graphique. Une mission qui introduit ça ferme la porte du serveur sans le dire — à signaler en revue.

---

## H.3 — Rétention et compression `[décision : H-33]`

Décision opérateur : on garde les transcripts, et le maître les compresse au fil de l'avancée, selon le besoin.

### H.3.1 Deux niveaux de vérité `⊣ TERMINAL` `☠ CASSE`

Distinction **non négociable**, elle découle de H-15 :

| Niveau | Emplacement | Statut | Compressible ? |
|---|---|---|---|
| **Vérité** | disque du PC, JSONL local | complet, durable | **non** |
| **Miroir** | `SessionStore` au Pi | best-effort, incomplet par conception | **oui** |

`☠` **Ne jamais compresser la vérité.** Le miroir est déjà lacunaire — après trois échecs et un timeout de 60 s, un lot est **abandonné** et un `mirror_error` est émis, le sous-processus continuant sans être affecté. Compresser un miroir déjà troué en croyant compresser la source produit une perte irrécupérable.

La politique de rétention du disque PC est une question d'exploitation, distincte, et ne relève pas du harness.

### H.3.2 Trois paliers, du moins cher au plus cher `⊣ TERMINAL`

Le mot « compresser » recouvre trois choses de natures très différentes. Les confondre fait dépenser des tokens pour ce qu'un `gzip` réglerait.

**Palier 1 — sidecar incrémental. Gratuit, sans perte, fourni.**

`foldSessionSummary(prev, key, entries, {mtime})` (⚠ ALPHA) est appelée par le store **depuis l'intérieur d'`append()`** pour maintenir un `SessionSummaryEntry` à jour **sans relire le transcript**.

Contrat vérifié :
- `data` est un blob **opaque, propriété du SDK**. Le store le persiste **verbatim** et **ne doit pas l'interpréter**.
- Champs figés à la première apparition : `isSidechain`, `createdAt`, `cwd`, `firstPrompt`. Champs à dernier-gagne : `customTitle`, `aiTitle`, `lastPrompt`, `summaryHint`, `gitBranch`, `tag`.
- `☠` `mtime` **n'est pas dérivé des horodatages d'entrées.** L'adaptateur doit l'estampiller **au moment de la persistance**, avec la même horloge que le `mtime` de `listSessions()`. Les horodatages d'entrées et les temps d'écriture diffèrent par lotissement et latence réseau ; les confondre **annule le contrôle de fraîcheur**.
- `⚠` `foldSessionSummary` est **pure** ; la maîtrise de la concurrence appartient au store. Si des `append()` peuvent entrer en concurrence sur la même session, le cycle lire-plier-écrire doit être **sérialisé** — transaction, CAS, ou verrou par session.
- Implémenter `listSessionSummaries?` permet à `listSessions({sessionStore})` de tout lire en **un aller-retour** ; sans elle, repli sur `listSessions()` + un `load()` par session.

**À faire dès M-31.** Ça donne l'index et les métadonnées de toutes les missions sans coûter un token de modèle.

**Palier 2 — compression de stockage. Bon marché, sans perte.**

Compression classique des transcripts froids. Aucune décision de modèle, réversible intégralement.

`⚠ HYP` — seuil d'âge à définir par mesure. À faire **avant** d'envisager le palier 3 : si le palier 2 suffit, le 3 est du budget dépensé pour rien.

**Palier 3 — condensation sémantique par le maître. Cher, avec perte, irréversible.**

C'est ce que tu décris : le maître condense selon le besoin.

`☠ CASSE` — **une condensation sémantique est une décision de modèle sur ce qui mérite d'être oublié, et elle est irréversible.** Trois règles pour la rendre acceptable :

1. **Jamais sur la vérité** (H.3.1). Le disque PC reste intact ; on condense le miroir.
2. **Jamais sur une mission non terminale.** Une mission en cours peut avoir besoin de son contexte.
3. **Toujours traçable.** Le condensé enregistre quelle plage il remplace et quand. Sans ça, on ne peut pas savoir ce qui a disparu.

### H.3.3 Qui décide, et selon quoi `⊣ TERMINAL`

Formulation opérateur : « selon ce dont on a besoin ». C'est un jugement, donc un travail de modèle — cohérent avec l'esprit du système.

**Mais** : la condensation est un travail long. Elle ne se fait **pas dans le tour de conversation du maître** (invariant de non-blocage, `03`). Elle est **dispatchée comme mission**, comme l'intégration et l'échafaudage.

Le maître décide **quoi** condenser ; une mission dédiée **exécute**. Bénéfices identiques à H.1.1 : budget, audit, observabilité, et le contexte du maître reste propre.

`⚠ HYP` — je suppose que la condensation est occasionnelle et déclenchée par un besoin, pas continue. Si elle devient permanente, elle mérite une planification plutôt qu'un dispatch au coup par coup.

### H.3.4 Suppression `⊣ TERMINAL`

`SessionStore.delete?(key)` est **optionnelle** : si elle n'est pas définie, la suppression est un **no-op silencieux** — comportement adapté aux backends WORM ou append-only comme S3.

`☠ CASSE` — un store sans `delete` accepte les demandes de suppression **sans rien supprimer et sans erreur**. Sur SQLite (H-21), l'implémenter ; sur tout autre backend, vérifier avant de promettre une suppression.

### H.3.5 Transcripts de sous-agents `⊣ TERMINAL` `☠ CASSE`

`listSubkeys?(key)` liste les clés de sous-chemins d'une session — **les transcripts de sous-agents**. Elle est utilisée à la reprise pour découvrir et matérialiser toutes les données de sous-agents.

`☠` **Si elle n'est pas définie, la reprise ne matérialise que le transcript principal.** Une mission reprise perd donc tout l'historique de ses sous-agents, **sans erreur**. Avec ton architecture à trois niveaux, c'est une perte majeure et invisible.

**Obligation** : implémenter `listSubkeys` dans l'adaptateur. À ajouter aux critères d'acceptation de M-31.

`⚠` `loadTimeoutMs` (défaut 60000) borne **chaque** appel à `load()` et `listSubkeys()` pendant la matérialisation de reprise. Si l'adaptateur ne répond pas dans la fenêtre, la requête **échoue au lieu de rester suspendue**. Une mission avec beaucoup de sous-agents peut sortir de la fenêtre — à mesurer, pas à supposer.
