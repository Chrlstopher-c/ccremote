# ARCHITECTURE — harness d'orchestration ccremote

Référence : `Upgrade/03-couche-1.md` (les sept composants, les six frontières, les cinq propriétés).
Ce document en est la traduction en dossiers réels, plus le contrat anti-pourrissement exigé par
`code-standards.md` : une définition non ambiguë de chaque dossier racine.

## Carte des domaines

```
composition/            racine d'assemblage — construit le graphe réel, expose les bin-*.ts
control-plane/          tout ce qui vit sur le Pi (autorité unique)
  ├─ registre/           E.1 — état persistant SQLite (missions, comptes, quotas)
  ├─ session-store/       E.3 — miroir best-effort des sessions (H-15, jamais l'autorité)
  ├─ bus-permissions/     C.2/C.3 — machine à états des demandes de permission
  ├─ audit-permissions/   C.5 — trace d'audit, arbitrage délégué
  ├─ observabilite/       E.2/C.4.2 — client temps réel, flux par mission/sous-agent
  ├─ reconciliation/      E.1.4/A.4.2/D.2.4 — registre Pi ↔ inventaire réel du PC
  └─ orchestrateur/       A — la session Agent SDK avec qui Chris parle
      ├─ entree/           A.1.3 — flux d'entrée asynchrone, un seul lecteur
      ├─ mcp-controle/     A.2 — serveur MCP de contrôle du parc
      └─ processus/        A.1/A.3.2/A.4.2 — démarrage, identité, options, contexte
workers/                B.1 — un worker = un process + une session SDK + un worktree
superviseur/            B.1.4/D.3 — superviseur de workers du PC, canal de contrôle
transport/              D — canaux réseau Pi↔PC (D.1 données, D.3 relayé par superviseur/)
plancher-deni/          C.1.3/G.2 — motifs Bash scopés, jamais autorisés
budgets/                G.1 — plafond de parc, classification d'usage, retry watchdog
anti-boucle/            H-68 — juge Haiku, détecteur de boucle (pas un plafond en $)
arret-urgence/          G.4.3 — drill récurrent de l'arrêt d'urgence
discipline-contexte/    A.1.4 — échantillonnage et compaction de contexte
relance/                B.3.2 — politique de relance après terminaison de tour
projets/                F — projet ↔ worktree ↔ équipe, cycle de vie git
pause/                  B.4 — pause/reprise d'un worker sans perte ni duplication
test-harness/           outillage de test (contrats de pannes, doublures, déterminisme)
validation-proprietes/  M-53 — preuve des cinq propriétés de couche 1
acceptation/            bancs d'essai réels (hors bun test, jamais en CI)
```

**Règle de lecture** : la profondeur d'un dossier suit le risque (`03-couche-1.md`), pas une
convention uniforme. `plancher-deni/` est plat parce que le risque y est simple à énoncer ;
`superviseur/` est large parce que c'est là que vivent la persistance, le fencing et l'arrêt
d'urgence en même temps.

## Définition non ambiguë de chaque dossier racine

| Dossier | Ce qu'il contient | Ce qu'il ne contient PAS |
|---|---|---|
| `composition/` | Construction du graphe d'objets réel, points d'entrée exécutables, ports qui ne peuvent être fournis QUE par assemblage (ex. `LecteurUtilisationParc` réel, client réseau D.3) | Aucune règle métier nouvelle — une règle qui vivrait ici et nulle part ailleurs est un signe qu'elle est au mauvais endroit |
| `control-plane/` | Tout ce qui s'exécute physiquement sur le Pi | Rien qui décide d'un spawn/arrêt de process — ça appartient à `superviseur/` |
| `workers/` | Cycle de vie d'UN worker (spawn, options SDK, capacités, `canUseTool`) | La notion de plusieurs workers, de parc, de fencing — ça appartient à `superviseur/` |
| `superviseur/` | Le parc de workers du PC : registre, persistance, fencing, arrêt d'urgence, canal D.3 | Aucune connaissance du registre SQLite du Pi (frontière A↔B inexistante, `03-couche-1.md`) |
| `transport/` | Le canal D.1 (données) : trames, reprise, ping/pong | Toute sémantique de contrôle (D.3, dans `superviseur/canal-controle.ts`) |
| `plancher-deni/` | Motifs Bash structurellement interdits, quel que soit le mode de permission | Tout arbitrage dynamique — c'est `bus-permissions/` |
| `budgets/` | Ce qui est réellement mesurable (pourcentage de quota, catégories de message d'usage) | Un anti-boucle — un montant en $ ne mesure pas une boucle (H-68) |
| `anti-boucle/` | Le juge Haiku, ses paliers, sa décision de coupure | L'appel réel au SDK en dehors de `juge-haiku.ts` (règle non négociable H-68) |
| `projets/` | Le triplet projet/worktree/équipe et son cycle de vie git | Toute décision de spawn de process — ça appartient à `superviseur/` |
| `test-harness/` | Doublures et contrats de pannes injectables | Toute logique consommée par un module de production (règle 1, `test-harness/README.md`) |

**Frontière A↔B inexistante, appliquée deux fois** : ni `control-plane/` n'importe de fichier de
`superviseur/`/`workers/`, ni l'inverse. Tout passage entre les deux traverse un port défini dans
`control-plane/reconciliation/types.ts` ou `control-plane/orchestrateur/mcp-controle/types.ts`, et
n'est composé que dans `composition/`.

**`service`/`manager`/`helper` non utilisés dans ce dépôt** — le nommage suit le vocabulaire
métier français déjà établi (mission, garde-fou, port, câblage). Pas de définition
supplémentaire nécessaire ici : aucun de ces trois mots n'apparaît comme nom de dossier.

## Ce que la composition a révélé (2026-07-22)

Avant cette mission, aucun exécutable ne construisait le graphe complet — chaque domaine avait ses
tests et parfois un banc `acceptation/*.ts` isolé, mais rien ne les assemblait avec des dépendances
réelles. `composition/assemblage.test.ts` est le premier test qui échoue si un garde-fou cesse
d'être branché (H-74).

### Assemblé et vérifié par composition
- **G.1.3, plafond de parc** — `composition/pi/port-utilisation-parc.ts` fournit un
  `LecteurUtilisationParc` réel (source : `Registre.comptes`), consommé par `proposerCreationEquipe`
  et prouvé par assemblage (refuse/autorise selon un vrai relevé de quota).
- **H-73.1, bus de permissions → `canUseTool`** — `composition/bus-permissions/port-colocalise.ts`
  route réellement vers `MachineEtatsDemandes`, dans le cas colocalisé (voir limite ci-dessous).
- **Dette n°1, persistance du registre PC** — `composition/pc/assembler-superviseur.ts` construit
  `PersistanceRegistreSqlite` et appelle `superviseur.restaurer()` au démarrage ; prouvé par
  assemblage (un worker écrit par une instance précédente survit à un redémarrage).
- **H-68, juge anti-boucle** — `composition/pc/assembler-superviseur.ts` est le premier site de
  production à fournir `jugeBoucle: creerJugeHaiku()` à `SuperviseurWorkers`.
- **G.4, arrêt d'urgence** — prouvé par assemblage : `arret_urgence` traverse réellement
  `CanalControle` → `SuperviseurWorkers.arretUrgence()`.
- **A.1.2, identité de session Pi** — `composition/pi/verificateur-session-sdk.ts` fournit le
  premier `VerificateurSessionExistante` réel (`getSessionInfo` du SDK, jusqu'ici jamais appelé
  hors doublure).
- **D.3, canal de contrôle réseau** — `composition/pc/serveur-controle.ts` (serveur WS) et
  `composition/pi/client-superviseur-pc.ts` (client) sont la première liaison réseau réelle de
  `CanalControle`, qui n'existait jusqu'ici que dans ses propres tests.

### Ce qui ne s'assemble PAS — documenté, pas contourné

1. **`workers/index.ts` n'exporte pas `DemandeCanUseTool`/`PortBusPermissions`/`VerdictCanUseTool`.**
   Un autre domaine (`composition/`) qui doit fournir ce port est obligé d'importer directement
   `workers/types.ts` (fichier interne), en violation de la règle « aucun autre module n'importe les
   fichiers internes de ce dossier » énoncée dans `workers/index.ts` lui-même. Corriger revient à
   ajouter trois exports à `workers/index.ts` — hors zone de cette mission (écriture interdite hors
   `composition/`), signalé ici pour action.

2. **Le port `PortBusPermissions` (H-73.1) n'a pas de wiring cross-machine possible avec l'existant.**
   Le contrat attend un rappel exécuté DANS le worker (PC), atteignant `MachineEtatsDemandes` (Pi)
   de façon quasi synchrone (5 s, `workers/can-use-tool.ts`). Le seul canal de contrôle qui existe
   (D.3, `superviseur/canal-controle.ts`) est **Pi-initié uniquement** (« le PC n'initie jamais »,
   D.3.2) — l'inverse de ce qu'il faudrait ici. Le canal d'observation (E.2) est PC-initié mais
   strictement descendant (aucune opération de retour de verdict). **Fermer cet écart pour de vrai
   exige un nouveau canal bidirectionnel initié par le PC — une décision d'architecture, pas un
   câblage.** `composition/bus-permissions/port-colocalise.ts` fournit la version qui fonctionne
   quand Pi et PC sont colocalisés dans le même process (mode développement), et documente cette
   limite en tête de fichier plutôt que de la travestir en solution complète.

3. **`RepertoireCibles` (parler à une équipe en cours) et `DefinisseurBudget` (`definir_budget`)
   n'ont aucune implémentation réseau possible avec les contrats existants.** Le premier exigerait un
   canal D.1 par worker composé depuis le Pi (non construit — portée trop large pour cette mission,
   un client D.1 par mission active est un sous-système à part entière). Le second exigerait une
   septième variante à `OperationControle` (D.3) qui n'existe pas — l'ajouter est une extension de
   contrat d'un autre domaine, hors mandat. `composition/pi/ports-non-cables.ts` les implémente en
   REFUS EXPLICITE et journalisé (`warn`), jamais en faux succès (H-74, principe 2).

4. **`workers/options-composition.ts` (`composeWorkerOptions`, le seul site de production qui
   compose les `Options` d'un worker) ne fixe jamais `options.hooks`.** Conséquence concrète : les
   hooks d'audit (`control-plane/audit-permissions/hooks-sdk.ts`, `creerHooksAuditPermissions`,
   mission M-22) — présentés comme « branché sur `PreToolUse`, exhaustivité vérifiée à 100 % » dans
   `REPRISE.md` — ne sont en réalité RACCORDÉS À AUCUN worker en production : le test qui le prouve
   (`acceptation/audit-permissions-reel.ts`) construit son propre `query()` avec ses propres hooks,
   pas via `composeWorkerOptions`. C'est structurellement le même défaut que H-74, découvert par
   cette mission, sur un module que H-74 ne visait pas. Corriger appartient au domaine `workers/`
   (hors zone d'écriture de cette mission) : fusionner un jeu de hooks fourni par l'appelant avec
   ceux, éventuels, déjà posés par `WorkerSpec`.

5. **`DependancesServeurControle.utilisationParc`/`configPlafondParc` restent typés optionnels**
   dans `control-plane/orchestrateur/mcp-controle/types.ts`, avec repli
   `UTILISATION_PARC_DESACTIVEE`/`{}` dans `serveur.ts` — exactement l'occurrence n°2 citée par H-74
   elle-même. `composition/pi/assembler-control-plane.ts` fournit toujours les deux réellement, mais
   le TYPE laisse encore un futur appelant les omettre en silence. Corriger (les rendre obligatoires)
   appartient au domaine `mcp-controle/`, hors zone d'écriture de cette mission.

## Test d'assemblage — ce qu'il couvre, ce qu'il ne couvre pas

Voir `composition/assemblage.test.ts` (en-tête) et `validation-proprietes/README.md` (les cinq
propriétés, dont ce test est un prolongement direct pour H-74). Aucune session Claude Code réelle,
aucun worker réel, aucun test E2E : le test construit et vérifie le CÂBLAGE, jamais l'exécution
d'une vraie mission.
