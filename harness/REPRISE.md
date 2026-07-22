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

## État au 2026-07-22

**Lot 0 livré.** Commit `5c2f65f` poussé sur `origin/master`. **93 tests verts, typecheck propre.**

| Mission | Dossier | État |
|---|---|---|
| M-01 squelette worker | `workers/` | livré |
| M-02 générateur d'entrée | `control-plane/orchestrateur/entree/` | livré |
| M-03 registre SQLite | `control-plane/registre/` | livré |
| M-04 harnais de pannes | `test-harness/` | livré — voir `test-harness/README.md` |
| Maquette UI v2 | `../design-v2/` | **validée par Chris le 2026-07-22** |

**Lot 0 complet. 180 tests verts.** Maquette v2 validée : `index.html` (1717 l., autonome, navigable
et simulant les événements). Sa DA cream/serif/orange est actée — la reprendre, ne pas la réinventer.

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
bun test              # doit afficher 93 pass, 0 fail (ou plus)
git log --oneline -3
```

`⚠` Deux agents tournaient au moment de la coupure de contexte (tests+README de M-04, et
`COMPARAISON.md`). **Vérifier sur disque ce qui a réellement abouti avant de relancer quoi que ce
soit** — ne pas refaire à l'aveugle. Un plan en mémoire ne prouve pas qu'il n'a pas déjà été exécuté.

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

**Lancer la vague 2.** Rien n'est en cours, aucun agent ne tourne, l'arbre de travail est propre.

Lancer **M-10** et **M-20** en priorité (chemin critique + garde-fou minimal), en subagents
`model="sonnet"`, périmètres disjoints. Puis M-21, M-22, M-31, M-34 si le parallélisme le permet.

Brief type qui a fonctionné au Lot 0, à reproduire :
- socle imposé : `01`, `02`, `03`, **`16`** (celui-ci fait autorité) + **un seul** fichier de branche
  + `15-grille-revue.md` + `rules/code-standards.md`
- interdiction explicite de lancer un test E2E ou une session Claude Code réelle — **le subagent
  produit, le parent valide**
- « une `⚠ HYP` constatée fausse ⇒ remonter, ne pas improviser »
- « tout `☠ CASSE` de ta branche a un test associé »
- rappel de ne pas casser les tests existants (compte de référence à jour ci-dessus)

Correspondance mission → fichier de branche : voir le tableau de `../Upgrade/12-graphe-dependances.md`.

---

## Prochaine étape : Vague 2

Dépend du Lot 0. Missions parallélisables : **M-10** (tunnel, chemin critique), **M-20** (plancher de
déni), **M-21** (machine à états des demandes), **M-22** (arbitrage délégué + audit), **M-31**
(adaptateur SessionStore), **M-34** (relance et classification).

Si le parallélisme doit être limité : prioriser **M-10** (chemin critique) et **M-20** (garde-fou
minimal avant toute exécution non surveillée).

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51.** Développer sans plancher de déni
ni budget est acceptable ; laisser tourner une nuit sans eux ne l'est pas.

### Point de synchronisation de la vague 1 — ✅ PASSÉ le 2026-07-22

Script rejouable : `acceptation/m02-flux-entree.ts` (hors `bun test` **volontairement** : il ouvre une
vraie session). `SILENCE_S=20` pour répéter le protocole à blanc, `MODE=default` pour exercer
`canUseTool`.

Résultat réel, 10 minutes de silence (09:51 → 10:01) : tour 2 reçu après le silence · hook
`PreToolUse` appelé · générateur resté `ouvert` · aucun `Stream closed` · `surFermetureImprevue`
jamais déclenché. **La panne #1 ne se produit pas** sur le transport du SDK 0.3.217.

`⚠` Le critère d'origine « `canUseTool` appelé » était **inatteignable en mode production** : voir la
ligne correspondante du tableau des pièges. Il n'est exigé que sous `MODE=default`.

Protocole d'origine, conservé pour mémoire :

1. Instancier `GenerateurEntree` avec un `surFermetureImprevue` qui **échoue bruyamment**.
2. `query({ prompt: generateur.flux, options: { canUseTool, hooks: { PreToolUse } } })`.
3. Un tour trivial, puis **10 minutes réelles de silence** (pas de temps simulé — le but est
   d'exercer le SDK et le transport).
4. Envoyer une instruction déclenchant une permission.
5. Attendu : `canUseTool` appelé · hook `PreToolUse` appelé · `etat === 'ouvert'` · **aucun
   `Error: Stream closed` sur stderr** · `surFermetureImprevue` jamais déclenché.
6. `☠` Rester en `permissionMode` ≠ `bypassPermissions` — sinon `canUseTool` n'est jamais appelé et
   le test est vert pour la mauvaise raison.

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

**Quotas** : `rate_limit_event` (poussé, temps réel) et
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (tiré, donne le **pourcentage 0-100**
par fenêtre, ⚠ ALPHA → isoler derrière une couche d'adaptation). `accountInfo()` confirme sous quel
compte tourne un worker. Ne **pas** s'appuyer sur le message `init` : ses champs de quota sont
revenus `null` en test.
