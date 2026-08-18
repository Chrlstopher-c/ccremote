# ARCHITECTURE — harness d'orchestration ccremote

Référence : `Upgrade/03-couche-1.md` (les sept composants, les six frontières, les cinq propriétés).
Ce document en est la traduction en dossiers réels, plus le contrat anti-pourrissement exigé par
`code-standards.md` : une définition non ambiguë de chaque dossier racine.

## Carte des domaines

```
composition/            racine d'assemblage — construit le graphe réel, expose les bin-*.ts
control-plane/          tout ce qui vit sur le Pi (autorité unique)
  ├─ registre/           E.1 — état persistant SQLite (missions, comptes, quotas, conversations)
  ├─ session-store/       E.3 — miroir best-effort des sessions (H-15, jamais l'autorité)
  ├─ audit-permissions/   C.5 — trace d'audit des décisions de permission (hooks SDK réels)
  ├─ autonomie/           qui autorise un mandat, fenêtre et plafond d'autonomie d'un fil
  ├─ cloture/             ce qui empêche une équipe au repos de verrouiller son projet (H-56)
  ├─ inspection/          H-68 — inspection à la demande, verdict du juge anti-boucle persisté
  ├─ notifications/       canal asynchrone Chris/orchestrateur, deux textes par fait
  ├─ observabilite/       E.2/C.4.2 — client temps réel, flux par mission/sous-agent
  ├─ pieces-jointes/      fichiers joints à un message opérateur, écrits sur disque, jamais en mémoire
  ├─ rappels/             ce qui permet à l'orchestrateur d'agir sur le temps
  ├─ reconciliation/      E.1.4/A.4.2/D.2.4 — registre Pi ↔ inventaire réel du PC
  ├─ api-web/             API HTTP loopback lue par pi-web, jamais authentifiée elle-même
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
apprentissage/          boucle post-mission : observer → extraire → confirmer → réinjecter
shared/                 règles transverses partagées entre domaines, une par fichier, sans I/O
config-equipe/          configuration Claude Code installée sur un compte d'équipe
pilotage/               banc de pilotage du harness de production depuis une session de code
test-harness/           outillage de test (contrats de pannes, doublures, déterminisme)
validation-proprietes/  M-53 — preuve des cinq propriétés de couche 1
acceptation/            bancs d'essai réels (hors bun test, jamais en CI)
```

**Règle de lecture** : la profondeur d'un dossier suit le risque (`03-couche-1.md`), pas une
convention uniforme. `plancher-deni/` est plat parce que le risque y est simple à énoncer ;
`control-plane/` est large parce que c'est là que vivent tout ce qui n'existe qu'en un seul
exemplaire faisant autorité (registre, quotas, orchestrateur maître) en même temps.

## Définition non ambiguë de chaque dossier racine

| Dossier | Ce qu'il contient | Ce qu'il ne contient PAS |
|---|---|---|
| `composition/` | Construction du graphe d'objets réel, points d'entrée exécutables (`bin-pc.ts`, `bin-pi.ts`), ports qui ne peuvent être fournis QUE par assemblage (client réseau D.3, unités systemd de déploiement) | Aucune règle métier nouvelle — une règle qui vivrait ici et nulle part ailleurs est un signe qu'elle est au mauvais endroit |
| `control-plane/` | Tout ce qui s'exécute physiquement sur le Pi : registre SQLite, orchestrateur maître, API web, notifications, rappels, clôture, autonomie, réconciliation | Rien qui décide d'un spawn/arrêt de process sur le PC — ça appartient à `superviseur/` |
| `workers/` | Cycle de vie d'UN worker (spawn, options SDK, capacités, `canUseTool`) | La notion de plusieurs workers, de parc, de fencing — ça appartient à `superviseur/` |
| `superviseur/` | Le parc de workers du PC : registre local, persistance, fencing, arrêt d'urgence, canal D.3 | Aucune connaissance du registre SQLite du Pi (frontière A↔B inexistante, `03-couche-1.md`) |
| `transport/` | Le canal D.1 (données) : trames, reprise, ping/pong | Toute sémantique de contrôle (D.3, dans `superviseur/canal-controle.ts`) |
| `plancher-deni/` | Motifs Bash structurellement interdits, quel que soit le mode de permission — refus statique | Tout arbitrage dynamique ou dépendant d'un mandat — c'est `shared/acces-mandat.ts` |
| `budgets/` | Ce qui est réellement mesurable (pourcentage de quota, catégories de message d'usage) | Un anti-boucle — un montant en $ ne mesure pas une boucle (H-68) |
| `anti-boucle/` | Le juge Haiku, ses paliers, sa décision de coupure | L'appel réel au SDK en dehors de `juge-haiku.ts` (règle non négociable H-68) |
| `arret-urgence/` | Le drill récurrent (canari process réel, vérificateur périodique) qui prouve que l'arrêt d'urgence fonctionne encore | La commande d'arrêt elle-même — ça appartient à `superviseur/` |
| `discipline-contexte/` | Échantillonnage et compaction de contexte d'une session (A.1.4) | Toute décision de contenu du mandat — ça appartient à `control-plane/orchestrateur/` |
| `relance/` | La politique de relance après terminaison de tour (B.3.2/M-34) | Le déclenchement du relancement réel — ça appartient à `superviseur/` |
| `projets/` | Le triplet projet/worktree/équipe et son cycle de vie git | Toute décision de spawn de process — ça appartient à `superviseur/` |
| `pause/` | Pause/reprise d'UN worker sans perte ni duplication de tour (B.4) | Le cycle de vie complet d'un worker — ça appartient à `workers/` |
| `apprentissage/` | La boucle post-mission (observation → extraction → confirmation → injection) et sa propre base SQLite `apprentissage.db`, indépendante du registre | Toute connaissance du registre `control-plane/registre/` — un type d'entrée propre lui est dédié, jamais importé de là |
| `shared/` | Règles transverses consommées par plusieurs domaines (accès mandat, budget d'équipe, modèles Claude, saturation de compte, routage machine), sans I/O | Toute logique propre à un seul domaine — la duplication tolérée bat une mutualisation prématurée (DRY, `code-standards.md`) |
| `config-equipe/` | La configuration Claude Code installée sur un compte d'équipe (CLAUDE.md dérivé, script d'installation par liens symboliques) | Le code du harness lui-même — ce dossier est livré à un compte, pas importé par un module |
| `pilotage/` | Client et rendu terminal pour piloter le harness de production DEPUIS une session de code (hors mandat d'équipe) | Toute logique de décision du harness — ce dossier ne fait qu'afficher/relayer |
| `test-harness/` | Doublures et contrats de pannes injectables | Toute logique consommée par un module de production (règle 1, `test-harness/README.md`) |
| `validation-proprietes/` | La preuve exécutable des cinq propriétés de couche 1 (M-53) | Toute implémentation des propriétés elles-mêmes — c'est un banc de vérification, pas un domaine métier |
| `acceptation/` | Bancs d'essai RÉELS (aucune doublure), hors `bun test`, jamais lancés en CI | Tout ce qui doit tourner en CI ou sans quota réel — ça vit dans les `*.test.ts` du domaine concerné |

**Frontière A↔B inexistante, appliquée deux fois** : ni `control-plane/` n'importe de fichier de
`superviseur/`/`workers/`, ni l'inverse. Tout passage entre les deux traverse un port défini dans
`control-plane/reconciliation/types.ts` ou `control-plane/orchestrateur/mcp-controle/types.ts`, et
n'est composé que dans `composition/`.

**Frontière `apprentissage/` ↔ `control-plane/registre/`** : `apprentissage/` a sa propre base
(`apprentissage.db`, migrations et connexion dédiées) et son propre type d'observation d'issue de
mission — jamais le type du registre. Le seul lien entre les deux est la lecture, en fin de
mission, d'un transcript JSONL déjà écrit sur disque par le SDK ; aucun import croisé de code.

**Frontière `shared/` ↔ tout le reste** : `shared/` ne contient que des règles pures, sans I/O,
consommées à l'identique par au moins deux domaines (ex. `acces-mandat.ts` par `plancher-deni/` et
par `control-plane/`). Une règle qui ne sert qu'à un seul domaine n'y entre pas, même si elle
semble transverse — c'est le domaine appelant qui la porte.

**`config-equipe/` n'est pas un domaine de code** : c'est un livrable (fichiers de config +
script shell) installé SUR un compte d'équipe, jamais importé par un `import` TypeScript depuis
un autre dossier de `harness/`. C'est ce qui le distingue de `shared/`, qui est du code importé.

**`service`/`manager`/`helper` non utilisés dans ce dépôt** — le nommage suit le vocabulaire
métier français déjà établi (mission, garde-fou, port, câblage). Pas de définition
supplémentaire nécessaire ici : aucun de ces trois mots n'apparaît comme nom de dossier.

## Historique de composition — ce qui a changé de forme depuis

`composition/` a livré la première preuve que le graphe s'assemble réellement avec des
dépendances réelles (H-74, 22/07 : `composition/assemblage.test.ts`), puis l'inversion du lien
Pi↔PC (H-75, 22/07 : le Pi héberge `composition/pi/serveur-lien-pc.ts`, le PC initie
`composition/pc/client-lien-pi.ts`), toujours en vigueur. Le détail mission par mission de ce
qui s'est assemblé, ce qui restait en refus explicite, et ce qui a changé depuis (dont le retrait
du bus de permissions `control-plane/bus-permissions/` le 31/07 — jamais câblé à un producteur
réel, ce qui protège en pratique un mandat est `plancher-deni/` + `shared/acces-mandat.ts`) vit
dans `REPRISE.md`, journal de reprise à froid, plutôt que dupliqué et daté ici.

## Test d'assemblage — ce qu'il couvre, ce qu'il ne couvre pas

Voir `composition/assemblage.test.ts` (en-tête) et `validation-proprietes/README.md` (les cinq
propriétés, dont ce test est un prolongement direct pour H-74). Aucune session Claude Code réelle,
aucun worker réel, aucun test E2E : le test construit et vérifie le CÂBLAGE, jamais l'exécution
d'une vraie mission.
