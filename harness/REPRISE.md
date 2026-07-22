# REPRISE — harness d'orchestration ccremote

Point d'entrée unique pour reprendre le chantier à froid, sans le contexte de la conversation d'origine.
*Dernière mise à jour : 2026-07-22*

---

## En une phrase

Un orchestrateur maître (session Agent SDK sur le Pi) avec qui Chris discute depuis l'app, qui
dispatche des missions Claude Code sur le PC, observables et pilotables à distance depuis mobile.

---

## Où lire quoi

| Besoin | Fichier |
|---|---|
| **Décisions de Chris — FAIT AUTORITÉ sur tout le reste** | `../Upgrade/16-decisions-operateur.md` |
| Faits vérifiés contre le SDK, pièges versionnés | `../Upgrade/01-verification-sdk.md` |
| Architecture en une page, invariants, frontières | `../Upgrade/03-couche-1.md` |
| Ordres de mission exécutables | `../Upgrade/11-missions.md` |
| Ordonnancement, chemin critique, parallélisation | `../Upgrade/12-graphe-dependances.md` |
| **Les 38 pannes silencieuses — à consulter à chaque revue** | `../Upgrade/15-grille-revue.md` |

`☠` **Ne jamais donner le paquet complet à un agent.** Socle (`01`, `02`, `03`, `16`) + **un seul**
fichier de branche + l'ordre de mission. C'est ce qui évite l'explosion de contexte et les
interventions hors périmètre — le défaut même que ce harness existe pour éviter.

---

## État au 2026-07-22 (soir) — MVP fonctionnellement incomplet, chantier réorienté

`⚠` **Le harness n'est PAS exécutable de bout en bout** en déploiement Pi/PC séparé — c'est le
verdict de la mission d'assemblage, pas une prudence de rédaction. Le mode colocalisé s'assemble.
La priorité n°1 donnée par Chris est désormais la communication PC↔Pi réelle (voir « ACTION
SUIVANTE » plus bas et **H-75**).

## État détaillé — clôture du MVP

**Lots 0 à 5 livrés.** Dernier commit `2d81183`. **698 tests verts, typecheck propre.**
Il reste **M-50** (en vol au moment de la compaction) et **M-53** (qui seule clôt le MVP).

| Mission | Dossier | État |
|---|---|---|
| M-01 squelette worker | `workers/` | livré |
| M-02 générateur d'entrée | `control-plane/orchestrateur/entree/` | livré |
| M-03 registre SQLite | `control-plane/registre/` | livré |
| M-04 harnais de pannes | `test-harness/` | livré — voir `test-harness/README.md` |
| M-10 tunnel WebSocket + ping/pong | `transport/` | livré — voir `transport/DECISION-TRANSPORT.md` |
| M-20 plancher de déni | `plancher-deni/` | livré · **moteur réel vérifié** |
| M-21 machine à états des demandes | `control-plane/bus-permissions/` | livré |
| M-22 audit des permissions | `control-plane/audit-permissions/` | livré · **corrigé par banc réel** |
| M-34 relance et classification | `relance/` | livré · ⚠ **non câblé** |
| M-30 réconciliation | `control-plane/reconciliation/` | livré · ⚠ ports non implémentés |
| M-32 modèle de projets | `projets/` | livré · ⚠ git réel jamais exercé |
| M-33 pause et reprise | `pause/` | livré |
| M-31 adaptateur `SessionStore` | `control-plane/session-store/` | livré · **vérifié sur vrai SDK** |
| M-41 session orchestrateur | `control-plane/orchestrateur/processus/` | livré · A.1/A.3.2/A.4.2 · dette `surFermetureImprevue` (H-60) branchée sur alarme réelle · **corrigé 2026-07-22 sur banc réel** (`acceptation/orchestrateur-reel.ts`) : `demarrerOrchestrateur()` n'attend plus jamais `init` (interblocage structurel, le SDK ne l'émet qu'après un 1er message utilisateur) et ne consomme plus lui-même `query` (double-lecteur) — `poignee.ingererMessage()` délègue ça au vrai lecteur |
| M-13 canal de contrôle + superviseur de workers | `superviseur/` | livré 2026-07-22 · `CanalControle` (D.3, idempotence par `opId` mécanique, jamais par convention) + `SuperviseurWorkers` implémentant réellement `InventairePc`/`ReinitialisateurSession` (M-30) et `RepertoireCibles`/`ArreteurMission`/`RelanceurMission` (A.2) · `deciderRelance()` (dette M-34) câblé dans l'unique lecteur du `Query` d'un worker · `workers/` étendu d'un mode `resume` (`composeWorkerOptions`, `startWorker`) pour la relance · `⚠ HYP à vérifier sur banc réel` : le type public `SDKControlInitializeResponse` ne porte pas `pending_permission_requests` — lecture défensive en attendant confirmation, voir `superviseur/reponse-reinitialize.ts` · 40 tests ajoutés, aucun test existant cassé |
| M-11 fencing par epoch | `superviseur/fencing-epoch.ts` | livré · clé = **le worktree**, égalité d'epoch rejetée explicitement, worker évincé réellement aborté |
| M-40 outils MCP de contrôle | `control-plane/orchestrateur/mcp-controle/` | livré · 12 outils · non-blocage **prouvé** (port mort ⇒ main rendue < 500 ms) · `arret_urgence` **absent** (H-57 > spec) |
| M-42 discipline de contexte | `discipline-contexte/` | livré · n'utilise **pas** `percentage` (échelle non documentée) · seuil pathologique : < 15 min entre 2 auto, ou ≥ 3 en 60 min |
| M-51 budgets | `budgets/` | livré · classification sur les **vraies constantes SDK** · plafond de parc **incapable par le type** de tuer une mission |
| M-52 arrêt d'urgence | `arret-urgence/` + `superviseur/arret-urgence-sequence.ts` | livré · chemin **ne traversant jamais** `control-plane/orchestrateur/` (vérifié par grep des imports) · aucun chemin vers `liberer()` |
| M-50 client temps réel | ? | `⚠` **EN VOL à la compaction — vérifier sur disque** |
| M-53 validation des 5 propriétés | — | **à lancer** · seule mission autorisée à déclarer le harness terminé |
| Maquette UI v2 | `../design-v2/` | **validée par Chris le 2026-07-22** |
| Maquette UI v3 | `../design-v3/` | livrée · H-70/H-71/H-72 · `⚠` **jamais regardée par Chris** |

**Bancs d'essai réels** (`acceptation/`, hors `bun test` volontairement — ils ouvrent de vraies
sessions) : `m02-flux-entree.ts` · `plancher-moteur-reel.ts` · `multi-comptes-reel.ts` ·
`session-store-reel.ts` · `orchestrateur-reel.ts` · `worker-reel.ts` · `worktree-git-reel.ts` ·
`observabilite-sousagents-reel.ts` · `observabilite-5-sousagents-reel.ts`.

**H-69 lève la parcimonie** : un banc réel est le moyen **normal** de lever un doute, pas un luxe.
`☠` **Chacun de ces neuf bancs a trouvé un défaut que les tests unitaires ne voyaient pas** — dont
deux qui rendaient un composant strictement inutilisable (interblocage au démarrage de
l'orchestrateur) et un bug de **perte de données** (suppression de worktree portant du travail non
commité). C'est le principal enseignement de la journée : sur ce projet, le vert des tests unitaires
ne prouve pas grand-chose.

**Faits mesurés sur le `SessionStore` réel** : le SDK appelle `append` par lots (~480-530 ms
d'intervalle), la `projectKey` est le **cwd sanitisé** (`-mnt-projects-ccremote-harness`), et sur une
session courte **seul `append` est sollicité** — `load`/`delete`/`listSubkeys` restent non exercés.

**Maquettes** : `design-v2/` **validée par Chris**, DA cream/serif/orange actée — la reprendre, ne
jamais la réinventer. `design-v3/` (2179 l.) étend la v2 avec H-70/H-71/H-72 — **à faire valider par
Chris**, jamais regardée par lui.

`⚠` La v1 de cette maquette avait été rejetée : « plus une vitrine qu'autre chose », rien de
cliquable. Voir **H-65** : pour ce produit, une maquette statique ne prouve rien — l'essentiel est le
comportement dans le temps.

### Ce que le harnais de pannes ne pourra jamais tester

Table de couverture complète dans `test-harness/README.md`. Le point à retenir : **9 pannes de la
grille sont structurellement hors de portée d'un test automatisé** — c'est le risque résiduel réel du
projet, à traiter par revue humaine et non par CI.

Les trois qui comptent le plus : **#6** conflit sémantique à l'intégration (le code compile, aucun
signal mécanique n'existe — hors périmètre v1 par H-56, mais reviendra avec le parallélisme) ·
**#9** worktree supprimé avec du travail non commité (exige un vrai dépôt git et un vrai `rm`, que le
harnais s'interdit) · **#26** `applyFlagSettings()` dont l'appel réussit sans effet (seul le vrai SDK
peut le montrer).

14 autres pannes sont **en attente de leur composant** : le vocabulaire de faits existe déjà
(`reinitialize_appele`, `orphelin_ignore`…), c'est le code sous test qui manque. Elles deviendront
testables au fil des vagues — vérifier le README à chaque mission plutôt que de réinventer un
injecteur.

### Vérifier l'état réel avant de reprendre

```bash
cd /mnt/projects/ccremote/harness
bun run typecheck     # doit être silencieux
bun test              # doit afficher 698 pass, 0 fail (ou plus)
git log --oneline -3
```

`⚠` **M-50 tournait au moment de la compaction.** Vérifier sur disque ce qui a abouti avant de
relancer quoi que ce soit — ne pas refaire à l'aveugle. Un plan en mémoire ne prouve pas qu'il n'a
pas déjà été exécuté.

---

## Priorités — à respecter

**La priorité reste la chaîne technique : vague 2, puis la suite du graphe de dépendances.**

Les décisions **H-61 à H-67** (autorisation au dispatch, attribution de l'émetteur, sidebar
arborescente, messages en file, jauges, orchestrateur autonome, permissions dans le fil) sont
**actées et documentées, mais explicitement non prioritaires** — décision de l'opérateur du
2026-07-22. Elles sont dans `TODO.md` sous « Features actées, à implémenter — MAIS PAS PRIORITAIRES ».

`⚠` Ne pas les laisser s'insérer dans la vague 2 parce qu'elles sont fraîches et intéressantes. Elles
touchent surtout A (orchestrateur) et l'UI, qui viennent aux lots 4 et 5. Les traiter maintenant
reviendrait à construire la surface avant le transport.

**Exception** : H-66 (attribution de l'émetteur) a une conséquence sur le **schéma du registre** —
prévoir le champ émetteur quand M-31/M-30 toucheront au stockage des messages, plutôt que de migrer
après coup.

---

## ▶ ACTION SUIVANTE — à faire en premier à la reprise
*Réécrit le 2026-07-22 au soir. Ce qui précède décrivait la clôture du MVP ; le chantier a changé
d'objectif depuis, sur décision de Chris.*

### Objectif courant, dans cet ordre — priorités données par Chris

1. **Rendre la communication PC↔Pi réellement fonctionnelle** (priorité n°1).
2. **Câbler concrètement l'interface** — elle est fusionnée dans `pi-web/` mais ses données sont
   encore des mocks.
3. Poursuivre le reste des dettes.

### ☠ À FAIRE EN PREMIER : revoir le lien PC↔Pi, livré par un agent interrompu

Trois agents ont été **coupés en plein vol** par la limite de quota (2026-07-22 au soir). Vérifié
immédiatement après : **aucune casse** — 904 tests verts, typecheck propre, pile de `git stash`
vide, `pi-web` répond. Le travail rescapé est commité (`3cdf465`).

**Mais un seul des trois a produit du code, et son rapport n'a jamais été rendu.** Ce qui est sur
disque n'a donc **pas été revu** :

| Agent | État |
|---|---|
| Inversion du lien PC↔Pi | **code livré, rapport perdu** — `composition/lien-pc-pi/`, `composition/pc/client-lien-pi.ts`, `composition/pi/serveur-lien-pc.ts`, `composition/deploiement/ccremote-pc.service`, `horloge-avec-gigue.ts`, `port-bus-permissions-distant.ts`, `permission-verdict-distant.ts`, `reconciliation-sur-rattachement.ts` · `composition/pc/serveur-controle.ts` **supprimé** (le PC n'écoute plus) |
| API HTTP du control-plane | **rien écrit** — `control-plane/api-web/` n'existe pas |
| Branchement de l'UI sur l'API | **rien écrit** — `pi-web/` inchangé, données toujours mockées |

**Revue à faire sur le code du lien, sur ces points précis** (c'est ce que le rapport aurait dû
établir) :
1. l'**epoch est-il réellement incrémenté à chaque rattachement** ? Sans ça le fencing (M-11) ne
   peut pas distinguer la nouvelle instance de l'ancienne ;
2. le backoff a-t-il une **gigue** ? Sans elle, PC et Pi qui redémarrent ensemble se resynchronisent
   et se martèlent ;
3. une coupure **transitoire** ne remonte-t-elle jamais comme terminale ? (`transport/lien-websocket.ts`
   implémente déjà cette distinction — a-t-elle été réutilisée, ou un second mécanisme réinventé ?)
4. le secret partagé est-il bien **hors du code et hors des logs** ?
5. **rien de mutant ne s'exécute au rattachement** : le retour du PC restaure un état lisible,
   relancer une mission reste une décision (voir H-75).

`⚠` Aucun de ces points n'a été exercé en réel : pas de vrai réseau, pas de vrai redémarrage.

### Ensuite : les deux chantiers jamais commencés

- **API HTTP du control-plane** (`control-plane/api-web/`, à créer). Spécification :
  `pi-web/CONTRAT-API-HARNESS.md`, 27 endpoints. `☠` Exposer un état existant, **jamais** le recréer :
  une donnée absente du harness se déclare absente, elle ne s'invente pas.
- **Branchement de l'UI** : proxy `/api/harness/*` dans `pi-web/app.py` derrière `check_session`,
  puis `static/harness-api.js` sur les vrais endpoints, en gardant un **basculement explicite** vers
  les mocks (on doit savoir en regardant l'écran si l'on voit du réel).

### L'architecture est tranchée : lire H-75 avant de toucher au transport

`Upgrade/16-decisions-operateur.md`, **H-75**. En résumé : **le Pi héberge, le PC est client**, un
seul lien, `server/server.py` en `127.0.0.1` appelé localement par le harness. Objectif
d'exploitation, mot de Chris : *« j'éteins le PC, je vais me coucher, je le relance le lendemain :
tout doit se reconnecter parfaitement tout seul. »*

`☠` **Le piège qui casse ce scénario** est corrigé mais mérite d'être connu : `(pid, starttime)` ne
survit pas à un redémarrage (`starttime` compte depuis le boot). Sans `boot_id`, le harness croirait
un worker mort encore vivant — worktree bloqué chaque nuit — ou signalerait un process étranger.

### État de l'interface

Les vues du harness sont **réellement intégrées** à `pi-web/` (routeur, modules, template servis par
la vraie app FastAPI) — ce n'est pas une maquette posée à côté. Mais **toutes les données du bloc
harness sont mockées**. Le contrat des 27 endpoints est écrit :
**`pi-web/CONTRAT-API-HARNESS.md`**, et il fait foi des deux côtés. Tout accès passe par
`pi-web/static/harness-api.js` — point unique de branchement.

`⚠` Ce qui reste réel et fonctionnel dans l'app : statut PC, réveil, extinction, sessions tmux,
agent conversationnel, login. **Ne pas toucher à la logique du bouton d'extinction** — irréversible,
et déjà noté comme non re-testé en réel.

### Ce qui ne s'assemble pas encore

Le harness **n'est pas exécutable de bout en bout** en déploiement Pi/PC séparé ; le mode colocalisé,
lui, s'assemble. Détail dans `harness/ARCHITECTURE.md` et `TODO.md`.

### Puis : les dettes restantes
Voir `../TODO.md`, registre en tête de fichier.

---

## Historique — clôture du MVP (2026-07-22, journée)

*Écrit le 2026-07-22, juste avant une compaction de conversation.*

### 1. VÉRIFIER D'ABORD : un agent tournait au moment de la compaction

**M-50 (client temps réel) était EN VOL.** Avant toute chose :

```bash
cd /mnt/projects/ccremote/harness
git status --short          # M-50 écrit-il ? (dossier neuf sous harness/)
bun run typecheck && bun test
git log --oneline -3
```

Base de référence au moment de la compaction : **698 tests verts**, dernier commit `2d81183`.
`☠` **Ne rien refaire à l'aveugle** — vérifier sur disque ce qui a abouti. Un plan en mémoire ne
prouve pas qu'il n'a pas déjà été exécuté.

Si M-50 a livré : relire son code (pas son rapport) sur **deux points qui décident de sa qualité** —
(1) la divergence flux/store est-elle réellement **visible**, jamais lissée ? (2) le high-water mark
évite-t-il le rejeu complet ?

### 2. PUIS : lancer M-53, qui clôt le MVP

**M-53 est la seule mission autorisée à déclarer le harness terminé.** Périmètre : les cinq
propriétés de `03-couche-1.md` — non-blocage, isolation, reprise, modularité, bornage. Un test par
propriété.

`⚠` Lui passer **le registre des dettes** (`../TODO.md`) : une propriété « isolation » validée sur un
`RegistreWorkers` **en mémoire** ne vaut que tant que le superviseur PC ne redémarre pas. Ça doit
figurer dans sa validation, pas être découvert après.

### 3. ENSUITE : la dette n°1, priorité explicite de Chris

**Persistance du registre de workers côté PC.** Voir `../TODO.md`, section « REGISTRE DES DETTES ».
C'est la seule dette restante capable de **détruire du travail en silence**.

### 4. APRÈS le MVP : H-70, H-71, H-72 (décidées, spécifiées, non implémentées)
Atterrissage avant saturation de quota · choix modèle/raisonnement dans le fil · jauges 5 h/7 j par
compte et navigation par sous-agent. Spécification complète dans `../Upgrade/16-decisions-operateur.md`.
Maquette correspondante déjà produite : `../design-v3/index.html` (à faire valider par Chris).

---

## Brief type pour un subagent — celui qui a fonctionné toute la journée

- socle imposé : `01`, `02`, `03`, **`16`** (fait autorité) + **un seul** fichier de branche
  + `15-grille-revue.md` + `rules/code-standards.md`
- ☠ **jamais le paquet complet** — c'est ce qui évite l'explosion de contexte et le hors-périmètre
- interdiction explicite de lancer un test E2E ou une session Claude Code réelle — **le subagent
  produit, le parent valide** (les bancs `acceptation/` sont le travail du parent)
- « une `⚠ HYP` constatée fausse ⇒ remonter, ne pas improviser »
- « tout `☠ CASSE` de ta branche a un test associé »
- rappel du compte de tests à ne pas casser
- `☠` **en parallélisme, interdire `git stash` / `git checkout` / `git reset`** : ces commandes
  retirent aux autres agents leurs fichiers sous les pieds. Pour vérifier si un échec préexiste,
  lire la version commitée via `git show HEAD:<chemin>`, sans toucher au disque.
- `☠` **prévenir qu'un typecheck rouge peut venir d'un autre agent** : vérifier le chemin du fichier
  fautif avant de conclure sur son propre travail
- `☠` **aucun interrupteur de simulation de panne dans un module de production** — un interrupteur
  capable de produire la panne est lui-même la panne
- **lancer en `model="sonnet"`** (demande de Chris, coût)
- **côté parent** : commit **sélectif** tant qu'un agent tourne (`git add <chemins>`), jamais
  `git add -A` — sinon on emporte son travail en vol dans un commit qui n'en parle pas

Correspondance mission → fichier de branche : tableau de `../Upgrade/12-graphe-dependances.md`.

---

## Règles de travail, non négociables

1. **SDK épinglé à `0.3.217`.** Ne pas mettre à jour sans revérifier `01-verification-sdk.md`.
2. **Vérifier les capacités via `SDKSystemMessage.capabilities`**, jamais supposer une version.
3. **Tout `☠ CASSE` a un test associé.** Sans test, la mission n'est pas terminée — ces défauts ne se
   voient pas à la lecture.
4. **Une `⚠ HYP` constatée fausse ⇒ remonter**, ne pas improviser. Une hypothèse fausse propagée sur
   six niveaux coûte plus cher que l'aller-retour.
5. **Les subagents produisent, le parent valide.** Interdiction explicite dans chaque brief de lancer
   un test E2E ou une session Claude Code réelle.
6. **Lancer les subagents en `model="sonnet"`** (demande de Chris, 2026-07-22, raison de coût).
7. Standards : fichier 500 l. max, fonction 35 l. max, zéro `any`, try/catch + log sur tout ce qui
   touche API/DB/FS, logging via pino.

---

## Pièges déjà payés — ne pas les repayer

| Piège | Conséquence |
|---|---|
| `settingSources: []` « pour être déterministe » | neutralise en silence toute la config machine |
| `env` sans `...process.env` | `env` **remplace**, `PATH` perdu ⇒ git/node/credentials introuvables |
| Plancher Sonnet validé sur l'alias | `'inherit'` ne garantit rien — valider sur le **modèle résolu** |
| `res.changes` de bun:sqlite comme compteur métier | compte **aussi** les lignes supprimées en cascade (bug réel corrigé le 2026-07-22) |
| Fencing qui ne rejette que les epochs **strictement inférieurs** | deux workers de même epoch coexistent sans trace — la panne #2 **avec** le fencing activé. Traiter l'égalité explicitement (bug réel corrigé) |
| Un interrupteur de simulation de panne dans un module de production | **l'interrupteur est la panne.** Vécu le 2026-07-22 : M-30 avait ajouté `simulerPanneOrphelinIgnore` pour tester la panne #11 — retiré. Un invariant se teste sur le **seul chemin qui existe**, pas en codant un chemin qui le viole |
| `git add -A` **côté parent** pendant qu'un agent écrit | emporte son travail en vol dans un commit qui n'en parle pas, sans relecture. Vécu le 2026-07-22 (commit `01617ea`, code cohérent a posteriori mais message trompeur). ⇒ **commit sélectif tant qu'un agent tourne** — la règle vaut aussi pour le parent |
| `git stash` dans un subagent pendant que d'autres agents écrivent | **retire leurs fichiers sous leurs pieds** : l'écriture suivante part d'un état incohérent, ou le travail disparaît. Vécu le 2026-07-22 (rattrapé de justesse, stash bien restauré). ⇒ **interdire explicitement `git stash`/`checkout`/`reset` dans tout brief lancé en parallèle** ; pour isoler un doute, lire le fichier commité via `git show HEAD:<chemin>` |
| Attribuer à sa propre mission un typecheck rouge en parallélisme | les erreurs viennent souvent du dossier d'un **autre** agent en vol. Vérifier le chemin du fichier fautif avant de conclure |
| Un « pire cas sûr » posé dans un `catch`, sur un exécuteur qui **ne lève pas** | **le catch est du code mort.** Vécu le 2026-07-22 : `executer()` avalait l'échec de `git` et rendait `stdout: ''` ; `aTravailNonCommite` lisait ça comme « rien à sauver » et **envoyait le worktree à la suppression**. Seul `git worktree remove` (qui refuse un `.git` manquant) a évité la perte. ⇒ vérifier le **code de sortie**, pas seulement l'exception. Banc : `acceptation/worktree-git-reel.ts` |
| Un niveau d'`effort` invalide passé au SDK | **silencieusement ignoré, jamais rejeté.** Mesuré le 2026-07-22 : `effort: 'ultra'` (inexistant) rend `is_error: false`, `terminal_reason: 'completed'` — le tour se déroule comme si de rien n'était, au niveau par défaut. ⇒ valider contre `supportedModels()[].supportedEffortLevels` **avant** l'appel : le SDK ne le fera pas. Niveaux réels : `low \| medium \| high \| xhigh \| max`, **`max` est le maximum** |
| Attendre le message `init` avant d'avoir envoyé quoi que ce soit | **mesuré le 2026-07-22 : le SDK n'émet `init` qu'APRÈS le premier message utilisateur.** Un démarrage qui bloque sur `init` avec un flux d'entrée silencieux ne démarre **jamais** (constaté sur `demarrerOrchestrateur`, 60 s de timeout). `startWorker` y échappe parce qu'il passe un prompt initial. Sonde : `scratchpad/sonde-init.ts` |
| Attendre un `SDKPermissionDeniedMessage` pour tracer un refus | **mesuré le 2026-07-22 : il n'est JAMAIS émis** sur un refus par `disallowedTools` en `auto`. Le seul signal réel est le **`tool_result` avec `is_error: true`** portant le texte du refus, dans un message `user`. Un audit qui n'écoute que le message `system` compte 0 refus alors qu'il y en a eu |
| Compter sur `canUseTool` pour l'audit ou le garde-fou | **mesuré le 2026-07-22 : en `permissionMode: 'auto'`, il n'est JAMAIS appelé** — pas même sur `rm -rf`. Le classifieur tranche seul. Ce n'est pas un défaut de câblage (prouvé : en `default` il est appelé, **après** le hook). ⇒ l'audit passe par `PreToolUse`, et le plancher de déni est le seul garde-fou mécanique restant |
| `maxBudgetUsd` présenté comme l'anti-boucle | **faux** — un montant mesure du volume, pas une boucle. Voir **H-68** : paliers d'inspection + juge Haiku. `12 $ ≈ 6 min de Sonnet 5` |
| API V2 du SDK (`unstable_v2_*`, `send()`/`stream()`) | **supprimée** en SDK 0.3.142, encore recommandée par des articles récents |
| `TeamCreate` / `TeamDelete` / `team_name` | **supprimés** en Claude Code v2.1.178 |
| Nom d'outil nu dans le plancher de déni | ampute la capacité au lieu de borner le danger — seules les règles **scopées** survivent à tous les modes |
| Retour `null` sur `canUseTool` sans envoi hors-bande confirmé | les invites **n'expirent jamais** ⇒ agent bloqué indéfiniment |

---

## Multi-comptes Claude Code — vérifié en exécution réelle

`CLAUDE_CONFIG_DIR` isole **totalement** les credentials par process. Vérifié le 2026-07-22 : un dir
vide donne « Not logged in » alors que `~/.claude/.credentials.json` est valide ; un dir contenant le
snapshot d'un autre compte authentifie ce compte **sans toucher** au fichier global.

⇒ N workers peuvent tourner simultanément sur N comptes, via
`env: { ...process.env, CLAUDE_CONFIG_DIR: <dir du compte> }`.

Le mécanisme historique de ccremote (écraser `.credentials.json` + relancer les sessions tmux) est
**obsolète pour le harness** ; il reste valable pour le Claude Code interactif du poste.

`☠` Le `CLAUDE_CONFIG_DIR` d'un worker reçoit **aussi les transcripts JSONL locaux**, qui sont la
source de vérité (H.3.1). Ne pas le pointer vers `/tmp` sans mesurer l'impact sur la rétention.

`☠` **Isoler le compte isole AUSSI toute la config.** Constaté le 2026-07-22 : un dossier de compte
fraîchement authentifié n'a ni `CLAUDE.md`, ni `settings.json`, ni `skills/`, ni serveurs MCP. Un
worker lancé dessus perdait donc les standards de code **et** Playwright/CodeIndex — alors que H-52
exige qu'un lead fasse ses tests E2E avec les MCP. Le pré-vol de M-01 l'a détecté et a refusé de
spawner (`machine_claude_md_missing`) : le garde-fou B.1.2 a fonctionné.

⇒ Correctif appliqué : **liens symboliques** de `~/.claude/{CLAUDE.md,settings.json,rules,skills,
commands,plugins}` vers chaque `~/.claude-comptes/<compte>/`. On isole ce qui est propre au compte
(credentials, sessions, transcripts), on partage ce qui est commun (config, outils). À refaire pour
tout nouveau compte ajouté.

`☠` **La rotation par snapshot de credentials ne marche pas.** Vérifié le 2026-07-22 : les deux
snapshots (`~/.claude/.credentials_account1.json` du 11/07, `_account2.json` du 19/07) échouent tous
les deux en `Failed to authenticate: OAuth session expired and could not be refreshed`. Les refresh
tokens **tournent** ; un fichier copié à un instant T se périme tout seul, en silence, et ne se
découvre qu'au moment où on en a besoin.

⇒ Conception à retenir : **un `CLAUDE_CONFIG_DIR` persistant par compte**, authentifié une fois
(`/login` interactif, action de Chris) et laissé se rafraîchir tout seul. Ne jamais recopier un
snapshot dans le dossier d'un worker au moment de la bascule.

**Emplacement retenu** : `~/.claude-comptes/<compte>/`, un dossier persistant par compte.
`compte-a` est en place et vérifié le 2026-07-22 (banc d'essai passé 5/5 dessus). Il s'est peuplé
tout seul de `projects/`, `sessions/`, `.claude.json` — conforme à H.3.1 : les transcripts JSONL
vivent dans le `CLAUDE_CONFIG_DIR`, ce qui rend chaque compte réellement autonome.

`⚠` **`compte-a` est le compte du poste** (amorcé par copie une fois — acceptable, contrairement à
une recopie à chaque bascule). Le **second** compte n'existe pas encore : il exige un `/login`
interactif dans son propre dossier, action de Chris :

```bash
CLAUDE_CONFIG_DIR=/home/trinity/.claude-comptes/compte-b claude   # puis /login
```

Tant que `compte-b` n'est pas authentifié, **la rotation n'a qu'un seul compte** et ne rote rien.

`⚠` Non vérifié : que le rafraîchissement automatique du jeton s'écrive bien **dans** le dossier
isolé. Ça ne s'observe qu'à l'expiration, non forçable. À confirmer à la première bascule réelle.

**Quotas et identité — vérifiés en réel le 2026-07-22**, deux comptes en parallèle
(`acceptation/multi-comptes-reel.ts`, banc rejouable) :

- `accountInfo()` → `{ email, organization, subscriptionType, apiProvider }`. **L'e-mail identifie le
  compte de façon fiable** : `compte-a` = `compte-a@exemple.fr`, `compte-b` = `compte-b@exemple.fr`.
  C'est la source d'identité pour la rotation — ne pas se fier au nom du dossier.
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` → `utilization` **bien présent**
  (0-100) par fenêtre `five_hour` / `seven_day`, plus `resets_at`. ⚠ ALPHA → isoler derrière une
  couche d'adaptation.
- ☠ **Ces méthodes doivent être appelées PENDANT que la session vit.** Après le message `result`, le
  transport est fermé et tout appel échoue en `ProcessTransport is not ready for writing`. Piège
  réellement payé.
- ☠ **Les fenêtres 5 h ne sont PAS synchronisées entre comptes** (mesuré : reset 15:00 vs 13:29). Un
  compte saturé n'implique donc rien sur l'autre — c'est ce qui rend la rotation utile. Corollaire
  pour H-63 : la jauge doit être **par compte**, avec son propre `resets_at`.
- `limit_dollars` / `used_dollars` / `remaining_dollars` sont **`null`** sur abonnement : la seule
  mesure exploitable est le **pourcentage**, jamais un montant. Confirme H-58/H-68.

`⚠` **`extra_usage` est ACTIF sur les deux comptes** : au-delà du quota d'abonnement, la
consommation bascule sur des crédits payants en euros (mesuré : 11,83 € et 10,63 € sur 70 €/mois).
Un parc autonome peut donc dépenser de l'argent réel **sans passer par l'API**. À arbitrer par Chris
— voir `TODO.md`.

Ne **pas** s'appuyer sur le message `init` : ses champs de quota sont revenus `null` en test.
