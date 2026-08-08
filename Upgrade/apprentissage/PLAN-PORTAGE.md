# PLAN DE PORTAGE — la boucle d'apprentissage de ccremote

**À qui s'adresse ce document** : aux équipes d'implémentation qui vont écrire le code. Chaque
étape est un **mandat exécutable** : elle nomme son livrable, ses dépendances, et la preuve
mécanique qui la clôt. Une équipe qui prend une étape n'a pas à lire les autres — seulement celles
dont elle dépend, et `SPEC-APPRENTISSAGE.md`.

**Prérequis de lecture pour toute étape** : `SPEC-APPRENTISSAGE.md` (intégralement, il fait 8
sections) et, pour les étapes 2 et 3, la section « Faits ccremote » (§2) qui donne les chemins
réels. `INVENTAIRE-HERMES.md` n'est utile qu'à qui veut comprendre *pourquoi* une décision a été
prise — il n'est jamais nécessaire pour exécuter.

**`☠` CORRECTION DE CAP (2026-08-08, décision opérateur)** — vLLM est ANNULÉ. L'étape E4 ci-dessous
décrit encore un client vLLM (`client-vllm.ts`) ; c'est caduc. L'inférence de toute la boucle passe
par le SDK Claude Code, non interactif, sur `compte-a`, modèle **Haiku 4.5**
(`claude-haiku-4-5-20251001`) — voir `SPEC-APPRENTISSAGE.md` §3 (mis à jour) pour le détail. Le
fichier réel s'appelle `extraction/client-inference.ts` ; le banc réel
`acceptation/apprentissage-inference-reel.ts`. Le reste de l'étape E4 (garde de sortie, prompts,
deux tentatives, timeout, jamais d'exception) est inchangé.

**Règles valables pour toutes les étapes, non répétées ensuite :**

- TypeScript sur Bun. `bun test`, jamais npm/node. Standards maison : fichier ≤ 500 lignes,
  fonction ≤ 35, ligne ≤ 120, zéro `any`, zéro `as` non justifié, types de retour explicites,
  try/catch **avec log** sur tout ce qui touche disque/réseau/base, boucles bornées.
- Logger `pino` par domaine, sur le modèle de `harness/anti-boucle/logger.ts`.
- **Écriture strictement dans `harness/apprentissage/`**, sauf les étapes 6, 7 et 9 qui touchent
  explicitement un autre fichier, nommé dans l'étape. Une étape qui se croit obligée d'en modifier
  un autre s'arrête et le signale.
- En-tête de chaque nouveau fichier : une phrase « Responsabilité : … », et pour le domaine,
  l'attribution `Conception inspirée de Hermes Agent (Nous Research) — MIT.`
- **Aucune passe d'apprentissage ne doit jamais bloquer, ralentir ou faire échouer une mission.**
  C'est l'invariant qui prime sur tout le reste ; en cas de doute, on abandonne la passe.

**Arborescence cible** (le domaine complet, à titre de carte — chaque étape en crée sa part) :

```
harness/apprentissage/
  index.ts                    interface publique du domaine (le seul import autorisé de l'extérieur)
  types.ts                    ResumeMission, IssueMission, Lecon, Competence, OperationCompetence
  logger.ts
  base/
    connexion.ts              ouverture SQLite + PRAGMA
    migrations.ts             schéma versionné
    lecons.ts                 dépôt : leçons, observations, passes
  observation/
    reduction-transcript.ts   C-1 — JSONL → ResumeMission (pur, sans réseau)
    lecture-jsonl.ts          lecture en flux, tolérante aux types inconnus
    classement-issue.ts       C-2 — issue depuis le registre (pur)
  extraction/
    client-inference.ts       C-3 — SEUL point de sortie réseau du domaine (SDK Claude Code)
    prompts.ts                gabarits courts, dimensionnés 8B
    garde-sortie.ts           validation stricte des sorties de modèle
    extraction-lecons.ts      C-3 — orchestration d'une passe
    rapprochement.ts          C-5 — confirmation / contradiction
  competences/
    depot-competences.ts      C-8 — lecture/écriture des COMPETENCE.md
    operations.ts             C-8 — application déterministe des opérations
  service/
    file-attente.ts           file persistante des missions à traiter
    passe-cloture.ts          C-1→C-5→C-8 enchaînés, hors chemin critique
    consolidation.ts          C-4 — passe périodique
    sauvegarde.ts             C-4 — snapshot de la base avant mutation
  injection/
    bloc-lecons.ts            C-6 — composerBlocLecons(), pure, lecture seule
```

---

## Vue d'ensemble et ordre

```
E1 socle ──┬─► E2 réduction ──► E3 issue ──┐
           │                                ├─► E5 extraction+confirmation ──► E6 déclencheur
           └─► E4 client inférence ──────────┘                                        │
                                                                                     ▼
                                  E7 réinjection ◄──────────────────────────── (boucle fermée)
                                        │
                                        ├─► E8 compétences ──► E10 consolidation ──► E11 banc E2E
                                        │
                                        └─► E9 statuer sur la V1 (décision + migration éventuelle)
```

**Ce qui peut partir en parallèle** : E2 et E4 après E1. E9 à tout moment après E7 (c'est une
décision d'opérateur, pas une dépendance technique).

**La boucle est fermée et démontrable dès la fin de E7** — E8 à E11 l'améliorent, elles ne la
créent pas. Si le budget s'épuise, s'arrêter après E7 laisse un système qui apprend vraiment.

---

## E1 — Socle du domaine et base d'apprentissage

**Objectif** : le domaine existe, sa base s'ouvre, son schéma se crée, ses types sont posés.

**Dépendances** : aucune.

**Travail**
- Créer `harness/apprentissage/` avec `index.ts`, `types.ts`, `logger.ts`, `base/`.
- Types de `SPEC-APPRENTISSAGE.md` §5.1 (`ResumeMission`), §5.2 (`IssueMission`), §5.7 (schéma SQL).
- Migrations versionnées sur le modèle exact de `harness/control-plane/registre/migrations.ts`
  (table `migration_appliquee`, application idempotente).
- Chemin de la base : `process.env['CCREMOTE_APPRENTISSAGE_DB']`, repli
  `~/.local/share/ccremote/apprentissage.db`. Création du dossier parent si absent.
- `index.ts` n'exporte que ce dont l'extérieur a besoin ; **aucun autre domaine n'importe un fichier
  interne** (règle appliquée dans tout le harness).

**Livrable nommé** : `harness/apprentissage/base/migrations.ts` + `base/lecons.ts` +
`harness/apprentissage/base/base.test.ts`.

**Preuve à fournir** : `bun test harness/apprentissage/` — un test qui ouvre une base dans un
`mkdtemp`, applique les migrations **deux fois**, insère une leçon, la relit, et vérifie que la
seconde application ne casse rien. Coller la sortie.

**Critère d'arrêt** : `bun test` vert sur le dossier, `bunx tsc --noEmit` sans erreur nouvelle.

**Piège** : ne pas dupliquer l'ouverture SQLite du registre. Lire d'abord
`control-plane/registre/connexion.ts` et `session-store/connexion.ts` et **reprendre les mêmes
PRAGMA** (WAL, busy_timeout) — un écrivain concurrent existe déjà sur cette machine.

---

## E2 — Réduction déterministe d'un transcript (C-1)

**Objectif** : transformer un transcript JSONL réel en `ResumeMission` borné, **sans modèle, sans
réseau**.

**Dépendances** : E1.

**Travail**
- `observation/lecture-jsonl.ts` : lecture **en flux** ligne à ligne (jamais `readFileSync`), une
  `JSON.parse` par ligne, ligne illisible comptée et ignorée, **types inconnus ignorés sans lever**
  (spec §2 F-2 : `queue-operation`, `attachment`, `ai-title`, `last-prompt`, `summary` coexistent).
- `observation/reduction-transcript.ts` : agrégation en `ResumeMission` avec **toutes** les bornes
  de la spec (≤ 10 erreurs, ≤ 30 fichiers, ≤ 10 commandes échouées, extrait final ≤ 1 500 car.).
- Résolution du chemin : **réutiliser** `cleProjet()` / la logique de
  `harness/superviseur/sous-agents-disque.ts`. Ne pas réécrire la convention de nommage.
- Intégrer les transcripts de sous-agents du dossier `<sessionId>/subagents/` s'ils existent.

**Livrable nommé** : `harness/apprentissage/observation/reduction-transcript.ts` +
`reduction-transcript.test.ts` + le banc `harness/acceptation/apprentissage-reduction-reel.ts`.

**Preuve à fournir** — deux, et les deux comptent :
1. `bun test harness/apprentissage/observation/` sur des fixtures qui incluent **au moins un type
   de ligne inconnu** et **une ligne tronquée** ;
2. `bun harness/acceptation/apprentissage-reduction-reel.ts <chemin d'un vrai .jsonl>` — le banc
   lit un transcript **réel** du disque (ex.
   `~/.claude-comptes/compte-a/projects/-mnt-projects-ccremote-harness/*.jsonl`), affiche le
   `ResumeMission` produit et **le nombre de tokens estimé**. Coller la sortie ; le résumé doit
   tenir sous 2 000 tokens.

**Critère d'arrêt** : le banc tourne sur au moins **trois** transcripts réels de tailles très
différentes, dont un > 10 Mo, sans exception et sous la borne.

**Piège `☠`** : un exemple réel bat dix specs. Ne pas construire les fixtures de tête — les
**extraire** d'un vrai transcript, puis les réduire.

---

## E3 — Classement d'issue (C-2)

**Objectif** : dire comment une mission s'est terminée, sans modèle, à partir de ce que le registre
sait déjà.

**Dépendances** : E1. (Indépendante de E2 : elle prend le `Mission` du registre en entrée.)

**Travail**
- `observation/classement-issue.ts` : fonction **pure**
  `classerIssue(mission: DonneesMissionTerminee): IssueMission`.
- Entrée : un objet **plat**, copié depuis `Mission` (`etatHarness`, `derniereRaisonTerminale`,
  `constatGit`, `compteurRelances`, `inspection`, `budgetConsommeUsd`, `budgetMaxUsd`,
  `contexteTokensUtilises`). `☠` Ne pas importer `control-plane/registre/` depuis `apprentissage/` :
  la frontière A↔B est stricte (voir `harness/ARCHITECTURE.md`). Le domaine définit **son propre**
  type d'entrée ; la composition remplit.
- Valeurs : `livree · livree_partielle · sans_effet · boucle · budget_epuise · interrompue ·
  echec_technique · inconnue`.

**Livrable nommé** : `harness/apprentissage/observation/classement-issue.ts` +
`classement-issue.test.ts`.

**Preuve à fournir** : `bun test` avec **un cas par valeur d'issue**, plus le cas capital :
`constatGit === null` ⇒ `inconnue`, **jamais** `livree`. Coller la sortie.

**Piège `☠`** : `constatGit === null` veut dire « jamais mesuré », pas « propre ». C'est écrit dans
`registre/types.ts` et c'est le défaut qui ferait apprendre des leçons sur des missions stériles
présentées comme livrées.

---

## E4 — Client d'inférence (SDK Claude Code) et garde de sortie

**Objectif** : un point de sortie unique vers le modèle, et une garde qui refuse toute sortie non
conforme **avant** la moindre écriture.

**Dépendances** : E1.

**Travail**
- `extraction/client-inference.ts` : SDK Claude Code, `maxTurns: 1`, aucun outil, compte lu dans
  `CCREMOTE_APPRENTISSAGE_CONFIG_DIR` (repli `compte-a`), modèle dans `CCREMOTE_APPRENTISSAGE_MODELE`
  (repli Haiku 4.5). Timeout 45 s, **2 tentatives maximum**.
- Indisponibilité (connexion refusée, timeout, 5xx) ⇒ résultat typé `{ disponible: false }`, **jamais
  d'exception qui remonte**, `warn` loggé. Aucun repli sur un modèle payant : c'est la contrainte
  full local.
- `extraction/garde-sortie.ts` : parse JSON, valide contre le schéma attendu, **rejette** hors
  domaine. Le message de rejet **liste les valeurs acceptées** (un modèle se corrige depuis une
  liste ; un échec muet lui fait réémettre la même valeur).
- `extraction/prompts.ts` : gabarits ≤ 3 000 tokens d'entrée, sortie attendue en JSON court. Y
  inclure verbatim la **liste négative** de la spec §5.3 (les cinq interdits).

**Livrable nommé** : `harness/apprentissage/extraction/client-inference.ts` + `garde-sortie.ts` +
`garde-sortie.test.ts` + le banc `harness/acceptation/apprentissage-inference-reel.ts`.

**Preuve à fournir** — deux :
1. `bun test` sur la garde : sortie valide acceptée ; `portee: "univers"` rejetée ; JSON tronqué
   rejeté ; texte libre rejeté ; **et le message de rejet contient les valeurs acceptées** ;
2. `bun harness/acceptation/apprentissage-inference-reel.ts` avec le vrai compte : envoie un
   `ResumeMission` d'exemple, affiche la réponse brute **et** le verdict de la garde. Coller la
   sortie, y compris le cas serveur éteint (doit rendre `disponible: false`, pas une exception).

**Critère d'arrêt** : les deux preuves fournies, dont **une avec le compte réellement joignable** —
la preuve de grande valeur que vLLM ne pouvait pas fournir.

**Piège `☠`** : toute valeur produite par un modèle et destinée à une écriture est une entrée
utilisateur. Valider **avant la première écriture**, pas au point d'usage : un enregistrement
à moitié écrit plus un rejet est pire qu'un refus propre.

---

## E5 — Extraction de leçons et rapprochement (C-3 + C-5)

**Objectif** : d'un `ResumeMission`, obtenir 0 à 3 leçons validées, et les rapprocher de l'existant.

**Dépendances** : E2, E3, E4.

**Travail**
- `extraction/extraction-lecons.ts` : compose le prompt (résumé + leçons `active` du projet),
  appelle le client, passe la garde, applique le **filtre déterministe** de la liste négative (une
  leçon qui nomme une mission, une date, une branche, ou qui commence par une négation sur un outil
  ⇒ rejetée même si le modèle l'a produite).
- `extraction/rapprochement.ts` : similarité **lexicale d'abord** (normalisation, n-grammes,
  seuil), le modèle seulement pour les cas ambigus. Écrit `confirmations` / `contradictions` et une
  ligne `lecon_observation`.
- Règles : 2 confirmations de **missions distinctes** ⇒ `active` ; **1 contradiction ⇒ retour en
  `candidate`** (asymétrie voulue).

**Livrable nommé** : `harness/apprentissage/extraction/extraction-lecons.ts` +
`rapprochement.ts` + `rapprochement.test.ts`.

**Preuve à fournir** : `bun test` couvrant — deux missions distinctes produisant la même leçon ⇒
promue `active` ; **la même mission rejouée deux fois ⇒ toujours 1 confirmation** (idempotence) ;
une contradiction ⇒ retour immédiat en `candidate`. Coller la sortie.

**Piège `☠`** : le compteur de confirmations est le seul rempart contre une leçon fausse servie à
toutes les équipes. Un doublon d'observation qui l'incrémente **casse la protection sans rien
casser d'autre** — donc sans se voir. Le test d'idempotence n'est pas optionnel.

---

## E6 — Déclenchement à la clôture, hors chemin critique

**Objectif** : quand une mission se termine, une passe est **mise en file** et traitée en fond.

**Dépendances** : E5.

**Travail**
- `service/file-attente.ts` : file **persistante** (table de la base), une entrée par mission,
  contrainte d'unicité sur `mission_id` (table `passe_apprentissage`, spec §5.7).
- `service/passe-cloture.ts` : enchaîne C-1 → C-2 → C-3 → C-5, écrit le résultat, marque la passe.
  Échec ⇒ `erreur` renseignée, entrée **rejouable**, jamais perdue.
- Câblage : **un seul fichier touché hors domaine**, `harness/superviseur/superviseur-workers.ts`,
  dans la boucle de lecture du flux — au point exact où le module conclut la fin de la mission
  (`marquerMort(handle.sessionId)` + `telemetrie.fermer(missionId)`, juste avant le `break`), et
  **nulle part ailleurs**.
- `☠` **Un `result` est la fin d'un TOUR, pas de la session.** C'est écrit en toutes lettres dans ce
  fichier, mesuré sur banc le 23/07 : après un `result`, le lead peut reprendre seul et rendre sa
  synthèse trois minutes plus tard. Enfiler la passe à chaque `result` ferait apprendre huit fois
  sur la même mission, sur des transcripts incomplets. Le point d'accroche est la **conclusion**,
  pas le `result`.
- `☠` Appel **non bloquant** : `void enfiler(...)` avec commentaire justifiant le discard, ou file
  synchrone + traitement asynchrone. La clôture ne doit rien attendre.

**Livrable nommé** : `harness/apprentissage/service/file-attente.ts` + `passe-cloture.ts` +
`passe-cloture.test.ts`.

**Preuve à fournir** — deux :
1. `bun test` : une mission enfilée deux fois ⇒ **une seule** ligne `passe_apprentissage` ; une
   passe qui lève ⇒ entrée conservée avec `erreur`, rejouable ;
2. **preuve d'innocuité** : montrer, avec le moteur d'inférence injoignable (config pointée sur un
   répertoire vide), qu'une mission se clôt normalement et que le
   projet est libéré. Lire la ligne de la mission dans le registre **avant et après**. Coller les
   deux lignes.

**Critère d'arrêt** : les deux preuves. La seconde est la plus importante de tout le plan.

**Piège `☠`** : une mission qui ne se clôt pas verrouille son worktree (H-56, `cloture/politique-cloture.ts`).
Un apprentissage qui empêche une clôture coûte infiniment plus qu'il ne rapporte.

---

## E7 — Réinjection dans le mandat (C-6) — *la boucle se ferme ici*

**Objectif** : une nouvelle équipe démarre en connaissant les leçons `active` de son projet.

**Dépendances** : E5 (E6 pour que la base contienne quelque chose de réel).

**Travail**
- `injection/bloc-lecons.ts` : `composerBlocLecons(projet: string, machine: string): string`,
  **pure et en lecture seule**, ≤ 5 leçons, budget de caractères de la spec §5.6.
- **Zéro leçon ⇒ chaîne vide**, pas un en-tête sans contenu.
- Câblage : `harness/composition/pc/construire-worker-spec.ts` — **le seul fichier modifié hors
  domaine** — concatène le bloc au `mandate` reçu. Le domaine `workers/` reste inchangé et ignorant.
- Conserver verbatim la phrase « contredis-les si tu constates l'inverse » : c'est elle qui alimente
  les contradictions de C-5.

**Livrable nommé** : `harness/apprentissage/injection/bloc-lecons.ts` + `bloc-lecons.test.ts`, et le
diff de `construire-worker-spec.ts`.

**Preuve à fournir** — trois, et la troisième est celle qui compte :
1. `bun test` : bornes respectées, tri correct, base vide ⇒ chaîne vide ;
2. `bunx tsc --noEmit` propre ;
3. **preuve sur artefact réel** : semer une leçon `active` en base, lancer une équipe de test
   (`harness/acceptation/worker-reel.ts` ou équivalent), puis **relire le transcript JSONL de cette
   équipe** et y retrouver la leçon dans le prompt système. Coller l'extrait du JSONL.

**Critère d'arrêt** : la preuve 3. Sans elle, l'étape n'est pas faite — seulement écrite.

**Piège `☠`** : c'est ici que se joue le motif qui a coûté le plus cher à ce projet — « écrit, testé,
branché sur rien ». Un test qui vérifie que la fonction rend le bon texte ne prouve pas que le texte
atteint le modèle. **Le seul artefact qui le prouve est le transcript de l'équipe.** Vérifier aussi
dans les deux sens : retirer la leçon de la base, relancer, constater son absence.

---

## E8 — Compétences écrites depuis l'expérience (C-8)

**Objectif** : la boucle produit du savoir-faire, pas seulement des avertissements.

**Dépendances** : E7.

**Travail**
- `competences/depot-competences.ts` : lecture/écriture des `COMPETENCE.md` (frontmatter YAML +
  corps), sous `~/.local/share/ccremote/apprentissage/competences/<slug>/`.
- `competences/operations.ts` : application **déterministe** des `OperationCompetence` de la spec
  §5.8. `☠` Le modèle ne produit **jamais** de contenu de fichier : il propose `creer`,
  `ajouter_piege`, `ajouter_etape` ou `rien`, et le harness écrit. Toute autre forme ⇒ rejet avec
  liste des opérations acceptées.
- Seuils : `creer` exige **trois** leçons `active` convergentes ; `ajouter_piege` en exige une.
- Extension de `injection/bloc-lecons.ts` : ajouter l'index des compétences (nom, description,
  **chemin absolu**), ≤ 10 lignes.
- `☠` **Aucune exécution** : ni substitution de variables, ni shell inline. Une compétence est du
  texte lu par un lead.

**Livrable nommé** : `harness/apprentissage/competences/operations.ts` + `depot-competences.ts` +
`operations.test.ts`.

**Preuve à fournir** — deux :
1. `bun test` : une opération inconnue rejetée ; un `slug` inexistant rejeté ; `creer` refusé sous
   le seuil de trois leçons ; un `ajouter_piege` appliqué **au bon endroit** du fichier ;
2. **artefact réel** : afficher un `COMPETENCE.md` produit par la boucle, avant et après un
   `ajouter_piege`. Coller les deux versions.

**Piège `☠`** : Hermes documente lui-même l'échec de cette brique — une bibliothèque de centaines de
compétences étroites. Le seuil est la prévention ; le relâcher « juste pour voir » coûte une passe
de consolidation par semaine.

---

## E9 — Statuer sur la mémoire sémantique V1 (décision + migration éventuelle)

**Objectif** : trancher, artefacts en main, ce que devient la V1 maintenant que la boucle existe.
**Cette étape est une décision d'opérateur préparée par une équipe, pas un développement.**

**Dépendances** : E7 (il faut une boucle qui tourne pour comparer autre chose que des intentions).

**Position par défaut** (spec §4.3) : **V1 reléguée au rang de magasin de consultation**, la boucle
a son stockage propre, les deux corpus coexistent avec une frontière nette. Cette position ne coûte
**rien** : aucune migration, aucun code touché, la V1 continue de servir en lecture. C'est ce qui se
passe si personne ne tranche.

**Travail**
- Mesurer, sur 30 jours de boucle : nombre de leçons `active` par projet, nombre de compétences,
  taux de contradiction, et **combien de fois une équipe a réellement appelé `memory_search`**
  (comptable depuis les transcripts JSONL — les `tool_use` y sont).
- Rédiger, dans `Upgrade/apprentissage/`, une note de décision chiffrée avec les trois options :

| Option | Ce que ça implique | Coût |
|---|---|---|
| **A — statu quo** (défaut) | deux corpus, frontière du §4.3, V1 en lecture pour les équipes | **nul** |
| **B — V1 rétrogradée en archive** | on retire `semantic-memory` de `MCP_EQUIPE` (`harness/workers/mcp-du-poste.ts`) ; les équipes ne consultent plus que la boucle | faible en code (une constante), **irréversible côté contexte** : le savoir écrit par Chris cesse d'atteindre les équipes. À ne faire que si la mesure montre que `memory_search` n'est quasiment jamais appelé |
| **C — export de la boucle vers la V1** | les leçons `active` sont poussées dans la mémoire sémantique | **le plus cher, et pas surtout en code** : il faut un jeton d'écriture pour ccremote, ce qui contredit F-7 et H-66 (une équipe ne parle pas au nom de Chris). Techniquement : un client d'écriture, un mapping leçon→document, une idempotence sur ré-export, une politique de conflit. Compter une étape entière. **Ne pas engager sans arbitrage explicite de l'opérateur** |

**Livrable nommé** : `Upgrade/apprentissage/DECISION-MEMOIRE-V1.md` — la note chiffrée, les trois
options, les mesures réelles, et une recommandation d'une ligne.

**Preuve à fournir** : les **mesures**, pas les avis. La commande qui compte les appels
`memory_search` dans les transcripts, et sa sortie.

**Critère d'arrêt** : la note existe et porte des chiffres. Aucun code n'est modifié dans cette
étape ; l'option retenue devient, le cas échéant, une étape à part entière.

---

## E10 — Consolidation périodique et sauvegarde (C-4 + réduction de H-9)

**Objectif** : le corpus se réorganise seul, et une passe ratée ne détruit rien.

**Dépendances** : E8.

**Travail**
- `service/sauvegarde.ts` : copie de `apprentissage.db` (et du dossier `competences/`) sous
  `apprentissage/sauvegardes/<iso>/` **avant toute passe mutante**, 5 conservées.
- `service/consolidation.ts` : (1) transitions par horloge, **sans modèle** — promotion, mise en
  dormance à 60 jours, réveil sur nouvelle confirmation, péremption sur contradiction ; (2) fusion
  par le modèle local des leçons et compétences redondantes d'un même projet.
- Portes : ≥ 7 jours depuis la dernière passe, **aucune mission active sur la machine**, compte
  Claude Code joignable. Première observation ⇒ on **sème** l'horodatage et on diffère d'un
  intervalle complet.
- `☠` **Jamais de suppression** : état `obsolete`, la ligne et le fichier restent.
- Rapport de passe Markdown daté sous `apprentissage/rapports/`.

**Livrable nommé** : `harness/apprentissage/service/consolidation.ts` + `sauvegarde.ts` +
`consolidation.test.ts`.

**Preuve à fournir** — deux :
1. `bun test` : les quatre transitions ; refus de tourner à moins de 7 jours ; refus si une mission
   est active ; première observation ⇒ semée, pas exécutée ;
2. **artefact réel** : le contenu d'un rapport de passe généré, et le listing du dossier de
   sauvegardes montrant la rotation à 5.

**Piège `☠`** : la porte « aucune mission active » se vérifie sur le **registre**, pas sur une
estimation de durée. Consolider pendant qu'une équipe travaille, c'est modifier le corpus qu'une
autre est en train de lire.

`☠` **CÂBLÉ** (mandat de branchement) : `service/consolidation.ts` était écrit et testé, mais
rien ne l'appelait jamais — exactement le motif qui a le plus coûté à ce projet. Le déclenchement
périodique vit maintenant dans `service/consolidation-periodique.ts` (tick programmé, portes
relues à chaque tick, jamais de valeur figée) et le câblage dans `superviseur-workers.ts`
calcule `aucuneMissionActive` depuis `RegistreWorkers.tous()`. Voir `ACTIVATION.md` pour
l'interrupteur (même variable, même logique qu'E6) et la preuve d'artefact réel.

---

## E11 — Banc d'acceptation de bout en bout

**Objectif** : prouver la boucle **entière** sur des artefacts réels, une seule fois, mais
complètement.

**Dépendances** : E10 (ou E7 pour une version réduite).

**Travail**
- `harness/acceptation/apprentissage-boucle-reelle.ts` : hors `bun test`, jamais en CI, sur le modèle
  des bancs existants (`worker-reel.ts`, `session-store-reel.ts`).
- Scénario : lancer une équipe réelle sur un projet jetable avec un mandat qui provoque une erreur
  reproductible → la laisser se clore → déclencher la passe → vérifier la leçon `candidate` en base
  → **relancer une seconde équipe** produisant la même observation → vérifier la promotion en
  `active` → lancer une **troisième** équipe et **retrouver la leçon dans son transcript JSONL**.

**Livrable nommé** : `harness/acceptation/apprentissage-boucle-reelle.ts` + le journal de son
exécution collé dans le rapport.

**Preuve à fournir** : la sortie du banc, avec pour chaque étape la **ligne d'artefact** lue (ligne
de base, extrait de JSONL), et la vérification **dans les deux sens** : la troisième équipe lancée
avec la leçon retirée de la base **ne** doit **pas** avoir le bloc dans son transcript.

**Critère d'arrêt** : le cycle complet observé sur artefacts, dans les deux sens.

---

## Ce qui n'est dans aucune étape, volontairement

- **Aucun dashboard, aucune interface, aucune gamification.** Hors périmètre, dit par le mandat.
  Les rapports de passe sont des fichiers Markdown, lus par qui veut.
- **Aucune écriture dans la mémoire sémantique.** Voir E9 : c'est une décision d'opérateur, pas un
  développement à engager par défaut.
- **Aucun sous-processus Python.** Contrainte dure. Le compresseur de trajectoires de Hermes n'est
  pas porté (spec §7) ; seule son heuristique inspire C-1.
- **Aucune écriture par une équipe dans `apprentissage.db`.** Structurel : seul le harness écrit, et
  seulement après la mort de la session. Une étape qui a besoin de contourner ça s'arrête et
  remonte.
