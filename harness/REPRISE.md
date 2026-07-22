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
| M-04 harnais de pannes | `test-harness/` | contrats + doublures livrés ; **tests et README en cours** |
| Maquette UI v2 | `../design-v2/` | `index.html` livré ; **`COMPARAISON.md` en cours** |

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

## Prochaine étape : Vague 2

Dépend du Lot 0. Missions parallélisables : **M-10** (tunnel, chemin critique), **M-20** (plancher de
déni), **M-21** (machine à états des demandes), **M-22** (arbitrage délégué + audit), **M-31**
(adaptateur SessionStore), **M-34** (relance et classification).

Si le parallélisme doit être limité : prioriser **M-10** (chemin critique) et **M-20** (garde-fou
minimal avant toute exécution non surveillée).

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51.** Développer sans plancher de déni
ni budget est acceptable ; laisser tourner une nuit sans eux ne l'est pas.

### Point de synchronisation de la vague 1, à valider par le parent

Le seul test qui n'a pas pu être fait (il exige une vraie session, interdite aux subagents) :

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

**Quotas** : `rate_limit_event` (poussé, temps réel) et
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (tiré, donne le **pourcentage 0-100**
par fenêtre, ⚠ ALPHA → isoler derrière une couche d'adaptation). `accountInfo()` confirme sous quel
compte tourne un worker. Ne **pas** s'appuyer sur le message `init` : ses champs de quota sont
revenus `null` en test.
