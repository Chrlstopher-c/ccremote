# test-harness — injection de pannes déterministe

Outil de test. **Aucun module de production ne doit importer ce dossier.** Il ne touche
ni processus, ni fichier, ni réseau : tout est en mémoire et le temps est simulé.

Objet : rendre chaque panne silencieuse de `Upgrade/15-grille-revue.md` **déclenchable
de façon reproductible**, pour que la réintroduction du défaut fasse échouer un test.

```
contrats/      interfaces que les missions doivent implémenter pour être testables
doublures/     implémentations en mémoire, avec les injecteurs de pannes
deterministe/  horloge simulée, aléa semé, pompe temps virtuel ↔ microtâches
journal/       trace ordonnée de faits — la seule surface d'assertion
rejeu.ts       preuve de reproductibilité (deux exécutions, même empreinte)
```

## Règles non négociables

1. **Aucun timing réel.** Pas de `setTimeout`, pas de `Date.now`, pas de `sleep`. Le temps
   avance par `HorlogeSimulee.avancer()` ou `avancerAsync()`.
2. **Aucune ressource réelle dans le chemin partagé.** Un appel à un process/fichier/socket
   vit strictement dans l'implémentation réelle, jamais dans du code traversé par la doublure.
3. **On assert sur des faits, pas sur des logs ni des délais.** `JournalPannes` est la surface.
4. **Un injecteur non testé n'existe pas.** Tout injecteur ajouté ici arrive avec son test
   de reproductibilité (`rejouerDeuxFois`).

## Ce que les missions suivantes doivent implémenter

Chaque interface de `contrats/` est le point d'accroche du harness. Une mission qui
ne les respecte pas ne peut pas être testée contre les pannes correspondantes.

| Interface | Mission | Ce que le harness exige |
|---|---|---|
| `Horloge` | toutes | Toute attente passe par `planifier`/`attendre` — jamais `setTimeout` direct. Le composant reçoit son horloge par injection. |
| `Alea` | toutes | Tout aléa passe par `Alea`, jamais `Math.random`. |
| `Tuyau` / `Lien` | M-10, M-12 | Le transport déplace des octets opaques (H-12). Il expose `remonteesTransitoires()` — qui doit rester à 0 — et une taxonomie de fermeture `CodeFermeture`. `4090` ⇒ `rattachementAutorise: false`. |
| `SuperviseurWorkers` | M-01, M-11, M-32 | `inventaire()` fait autorité (B.1.4). `spawner()` porte un `epoch` : deux workers vivants sur un worktree = défaut. `stderrRapatrie: false` ⇒ exit nu. |
| `BusPermissions` | M-21, M-23, M-30 | `redelivrer()` idempotent par `requestId`. Un retour `null` n'est légitime que si l'envoi hors-bande est confirmé. `balayer(seuil)` implémente l'invariant I-5 (`repondue` sans `confirmee`). |
| `StoreSessions` / `StoreObservable` | M-63 | Politique E.3.3 : rejet réessayé 3×, timeout 60 s **non** réessayé, lot abandonné, `mirror_error` émis, sous-processus intact. `listSubkeys` et `delete` sont optionnelles dans le SDK — leur absence est une panne, pas une erreur. |
| `DiffusionObservation` | M-12, M-41/42 | `publier()` rend la main immédiatement. `blocagesProducteur()` doit rester à 0. Reprise par `depuisSequence` (high-water mark, D.2.2). |

Utilisation type dans un test de mission :

```ts
const horloge = new HorlogeSimulee();
const journal = new JournalPannes(horloge);
const superviseur = new SuperviseurFactice(journal, { fencingEpoch: false, stderrRapatrie: true });
// … exercer le composant sous test avec ces doublures …
await avancerAsync(horloge, 60_000);
expect(journal.contient('double_worker_worktree')).toBe(true);
```

## Table de couverture — pannes injectables

| # | Panne | Injecteur | Levier | Test |
|---|---|---|---|---|
| 2 | Pas de fencing par epoch | `SuperviseurFactice` | `{ fencingEpoch: false }` | `doublures/superviseur-factice.test.ts` |
| 4 | `listSubkeys` non implémentée | `StoreSessionsFactice` | `{ listSubkeysImplementee: false }` + `materialiserReprise()` | `doublures/store-sessions-factice.test.ts` |
| 8 | `delete` non implémentée | `StoreSessionsFactice` | `{ deleteImplementee: false }` + `supprimerViaContrat()` | `doublures/store-sessions-factice.test.ts` |
| 24 | `null` sans envoi hors-bande | `BusPermissionsFactice` | `repondreHorsBande(id, verdict, false)` | `doublures/bus-permissions-factice.test.ts` |
| 25 | Redélivrance non dédupliquée | `BusPermissionsFactice` | `{ deduplication: false }` | `doublures/bus-permissions-factice.test.ts` |
| 27 | Tunnel perdant des octets | `TuyauOctets` | `injecterPerte(n)`, mode `perte_silencieuse` vs `strict` | `doublures/tuyau-octets.test.ts` |
| 28 | Transitoire remonté à l'orchestrateur | `LienFactice` | `couperTransitoire()` (sain) vs `remonterTransitoire()` (défaut) | `doublures/lien-factice.test.ts` |
| 29 | Contre-pression jusqu'au worker | `DiffusionFactice` | `{ contrePressionJusquAuWorker: true }` | `doublures/diffusion-factice.test.ts` |

Injecteurs hors grille numérotée, couverts également :

| Invariant | Injecteur | Levier |
|---|---|---|
| B.1.5 — exit nu (crash muet) | `SuperviseurFactice` | `{ stderrRapatrie: false }` |
| E.3.3 — politique d'échec du store | `StoreSessionsFactice` | `injecterRejets(n)`, `injecterTimeout()` |
| I-5 — agent bloqué (`repondue` ≠ `confirmee`) | `BusPermissionsFactice` | `balayer(seuilMs)` |
| D.2.1 — taxonomie de fermeture | `LienFactice` | `couperTerminal(code)` |
| D.2.2 — reprise au high-water mark | `DiffusionFactice` | `abonner(id, capacite, depuisSequence)` |

## Pannes NON injectables par ce harness

À lire comme une liste de trous : ces défauts ne seront pas attrapés par `bun test` sur
`test-harness/`. Trois catégories.

### A — déjà couvertes ailleurs dans le dépôt (aucune action)

| # | Panne | Où |
|---|---|---|
| 5 | Registre dimensionné pour des équipes durables | `control-plane/registre/missions.test.ts` |
| 18 | `settingSources: []` | `workers/options-composition.test.ts`, `workers/preflight-config.test.ts` |
| 19 | `env` sans `...process.env` | `workers/options-composition.test.ts` |
| 20 | Plancher validé sur l'alias | `workers/model-floor.test.ts` |
| 30 | États SDK et harness fusionnés | `control-plane/registre/registre.test.ts` |
| 37 | `TeamCreate` / `TeamDelete` / `team_name` supprimés | `workers/removed-apis.test.ts` |
| 38 | `unstable_v2_*` supprimée | `workers/removed-apis.test.ts` |

### B — injectables plus tard, quand le composant existera

Le vocabulaire de faits (`journal/faits.ts`) est déjà en place ; il manque le composant
sous test, pas le harness.

| # | Panne | Ce qui manque | Mission |
|---|---|---|---|
| 1 | Générateur d'entrée fermé pendant le travail | Un worker réel avec son générateur async ; le harness ne modélise pas le cycle `canUseTool`/hooks | M-02 |
| 3 | `reinitialize()` absent du rattachement | La séquence de rattachement elle-même (faits `reinitialize_appele`, `permission_orpheline` prévus) | M-30 |
| 10 | Association worktree enregistrée après le spawn | Le modèle projets ↔ worktree ↔ équipe | M-32 |
| 11 | Orphelin ignoré à la réconciliation | La réconciliation (faits `orphelin_adopte` / `orphelin_ignore` prévus) | M-30 |
| 12 / 13 | Échec structurel et `budget_exhausted` relancés | La politique de relance et sa taxonomie d'échecs | M-34, M-51 |
| 15 | `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget | Le composant budgets | M-51 |
| 16 | Avertissement d'usage traité comme erreur | Le classifieur de préfixes d'usage (E.4.3) | M-51 |
| 17 | Flux brut routé vers l'orchestrateur | Le routage A ↔ E ; testable ensuite via `DiffusionFactice` | M-41/42 |
| 21 / 22 | Plancher de déni nu, ou jamais testé | Le plancher lui-même ; c'est un test de motifs, pas une injection | M-20 |
| 23 | `canUseTool` pris pour un audit exhaustif | L'étage `PreToolUse` ; nécessite un vrai worker | M-22 |
| 31 | `mtime` du sidecar dérivé des entrées | Le sidecar de rétention (fichier réel) | M-63 |
| 33 | Arrêt d'urgence passant par l'orchestrateur | Le chemin d'arrêt d'urgence | M-52 |

### C — structurellement non injectables (ne le seront jamais ici)

Aucun test unitaire déterministe ne peut les attraper. Elles relèvent de la revue humaine,
de l'outillage statique ou d'une nuit de fonctionnement réel. **C'est le vrai risque résiduel.**

| # | Panne | Pourquoi hors de portée |
|---|---|---|
| 6 | Conflit **sémantique** résolu par l'agent d'intégration | Le code compile et les tests passent — par définition, aucun signal mécanique. Revue humaine du diff d'intégration. |
| 7 | Compression appliquée à la vérité (disque PC) | Panne de doctrine, pas de code : il faudrait tester que le développeur a compris quelle source fait autorité. |
| 9 | Worktree supprimé avec travail non commité | Exige un vrai dépôt git et un vrai `rm`. Le harness s'interdit le disque. Test d'intégration dédié, hors périmètre M-04. |
| 14 | `critere_arret` non testable dans un mandat | Propriété d'un texte en langage naturel. Ni typable ni simulable. |
| 26 | Prompt système modifié via `applyFlagSettings()` | L'appel réussit et la valeur ne change pas — comportement du SDK réel. Ne peut être constaté que contre le vrai SDK. |
| 32 | File d'attente sans réveil | Clos par décision : la file « pour plus tard » n'existe plus dans le périmètre. |
| 34 | Paquet complet donné à chaque agent | Panne de process de rédaction des briefs, pas de code. |
| 35 | Validation court-circuitée pour un projet auto-créé | Panne de process : c'est l'absence d'appel au validateur qui est le défaut. Détectable par revue ou lint, pas par injection. |
| 36 | Intégration déclenchée avec une mission encore active | Dépend de l'ordonnancement réel des missions ; le harness ne modélise pas l'ordonnanceur. |

**Résumé** : 8 pannes injectables ici, 7 couvertes ailleurs, 14 en attente de leur composant,
9 structurellement hors de portée. Les 9 de la catégorie C sont celles qui atteindront la
production sans qu'aucun test ne les arrête.

## Lancer

```bash
cd /mnt/projects/ccremote/harness
bun test test-harness      # suite du harness seule
bun run typecheck
HARNESS_LOG_LEVEL=debug bun test test-harness   # trace pino des faits
```
