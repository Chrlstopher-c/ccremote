# SPEC — la boucle d'apprentissage de ccremote

**Ce document dit ce qu'on construit.** Il est indépendant de Python et de Hermes : il s'appuie sur
`INVENTAIRE-HERMES.md` (le relevé de la source) mais ne transpose rien mécaniquement. Le découpage
en étapes exécutables est dans `PLAN-PORTAGE.md`.

**Attribution** — la conception d'origine vient de **Hermes Agent, Nous Research, licence MIT**
(`/mnt/projects/hermes-agent/LICENSE`). La transposition est légitime ; toute implémentation issue
de ce document porte, dans l'en-tête du domaine, la mention :
`Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.`
Aucune ligne de code Python n'est copiée : la réécriture est intégrale.

---

## 1. Ce qui n'est pas transposable, et pourquoi ça change tout

Hermes et ccremote n'ont pas la même forme. Trois écarts commandent toutes les décisions qui
suivent.

| | Hermes Agent | ccremote |
|---|---|---|
| **Qui apprend** | un agent, sur la durée, pour un utilisateur | le **harness**. Une équipe est éphémère et ne revit jamais |
| **Ce qu'on observe** | la liste de messages en mémoire vive du tour courant | un **transcript JSONL sur disque**, complet, après coup |
| **Qui paie l'inférence** | le même fournisseur que la session | **vLLM local**, jamais le quota Claude |

**Conséquence n°1 — le déclencheur change de nature.** Chez Hermes, la revue tourne *pendant* la
vie de l'agent, tous les 10 tours, et le bénéfice arrive à la session suivante du même agent. Chez
nous, une équipe qui finit ne reviendra pas : le bénéfice ne peut aller qu'aux **équipes
suivantes**. La revue se déclenche donc à la **clôture d'une mission**, pas à un compteur de tours.
On y gagne accessoirement l'artefact complet plutôt qu'un instantané.

**Conséquence n°2 — l'objet appris change.** Hermes apprend *qui est l'utilisateur* (`USER.md`) et
*comment faire cette classe de tâche pour lui* (skills). Chez nous, l'utilisateur du lead n'est pas
un humain : c'est l'orchestrateur. Le pendant de `USER.md` n'a donc pas de destinataire —
ce que ccremote doit apprendre, c'est **comment une équipe de ce harness réussit ou échoue sur ce
projet-là**. Une seule des deux dimensions de Hermes survit, et elle est renommée en conséquence.

**Conséquence n°3 — écrire est plus risqué chez nous.** Chez Hermes, une mauvaise entrée de mémoire
gêne un utilisateur qui la voit et la supprime. Chez nous, une leçon fausse est injectée dans le
mandat de **toutes** les équipes suivantes d'un projet, sans qu'aucun humain la relise. C'est
exactement le motif que Hermes documente dans ses listes négatives (« X ne marche pas » se durcit
en refus des mois après la réparation). D'où deux règles dures, posées ici et rappelées à chaque
mécanisme retenu :

- **`☠` Aucune leçon n'entre dans un mandat sans être *confirmée par deux missions distinctes*, ou
  contresignée par l'orchestrateur.** Une observation à une occurrence est stockée en `candidate`,
  jamais servie.
- **`☠` Toute leçon servie porte sa provenance** (mission, date, extrait d'origine) et **peut être
  retirée d'un geste**. Une leçon non confirmée par une nouvelle observation en 60 jours retombe
  en `candidate`.

---

## 2. Les faits ccremote sur lesquels cette spec s'appuie (vérifiés, pas supposés)

Chaque implémenteur doit pouvoir refaire ces vérifications avant de coder.

**F-1 — Les transcripts existent, sur disque, par compte.** Disposition constatée le 2026-08-08 sur
le PC :
```
<CLAUDE_CONFIG_DIR>/projects/<cwd absolu, '/' → '-'>/<sessionId>.jsonl          transcript principal
<CLAUDE_CONFIG_DIR>/projects/<cwd absolu, '/' → '-'>/<sessionId>/subagents/agent-<id>.jsonl
<CLAUDE_CONFIG_DIR>/projects/<cwd absolu, '/' → '-'>/<sessionId>/subagents/agent-<id>.meta.json
```
Exemple réel : `/home/trinity/.claude-comptes/compte-a/projects/-mnt-projects-ccremote-harness/8ac51b0e-….jsonl`.
La convention de clé de projet et la résolution du dossier sont déjà écrites dans
`harness/superviseur/sous-agents-disque.ts` (`cleProjet()`, `dossierSousAgents()`) — **la boucle les
réutilise, elle n'en écrit pas une deuxième**.

**F-2 — Format d'une ligne de transcript.** Une ligne = un objet JSON. Champs racine observés sur
une entrée `user` : `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`,
`isSidechain`, `permissionMode`, `version`, `message`. `message.content` est soit une chaîne, soit
une liste de blocs (`text`, `thinking`, `tool_use`, `tool_result`). Les entrées `assistant`
portent `message.usage`. D'autres `type` cohabitent et doivent être ignorés sans erreur :
`queue-operation`, `attachment`, `ai-title`, `last-prompt`, `summary`.
`☠` **Le lecteur doit tolérer les types inconnus** : le CLI en ajoute au fil des versions, et une
boucle qui lève sur un type inattendu s'éteint silencieusement au prochain upgrade.

**F-3 — `CLAUDE_CONFIG_DIR` est posé par le harness, par compte.** `harness/workers/options-composition.ts:27`
(`CONFIG_DIR_ENV`), valeur issue de `Compte.configDir` du registre (`control-plane/registre/types.ts:84-94`).
Le transcript d'une mission est donc localisable **de façon déterministe** à partir de trois
colonnes déjà persistées : `mission.sessionId`, `mission.worktree` (ou `projet`) et
`compte.configDir`.

**F-4 — Le mandat est le seul canal d'entrée dans le contexte d'une équipe.**
`harness/workers/options-composition.ts:115` : `systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.mandate }`.
Et `harness/composition/pc/construire-worker-spec.ts` est, par son propre en-tête, **le point unique
où un `WorkerSpec` de production est construit**. C'est là que la réinjection se branche.

**F-5 — La fin de vie d'une équipe est déjà un événement du système.**
`harness/control-plane/cloture/` (`missionsAClore`, `ServiceCloture`, `DELAI_CLOTURE_IDLE_MS`), plus
les états terminaux de `control-plane/registre/types.ts` (`ETATS_HARNESS_TERMINAUX`) et le champ
`derniereRaisonTerminale`. La boucle n'invente pas son horloge : elle s'accroche à celle-ci.

**F-6 — Le registre sait déjà ce qu'une mission a coûté et produit.** `Mission` porte `mandat`,
`critereArret`, `modeleResolu`, `budgetConsommeUsd`, `contexteTokensUtilises`,
`compteurRelances`, `inspection` (verdict anti-boucle H-68), `constatGit`
(`fichiersModifies`, `branche`, `dernierCommit`, `releveA`), `demarreeA`/`termineeA`. **Ce sont des
signaux d'issue gratuits** : aucun modèle n'est nécessaire pour savoir qu'une mission a fini sans
un seul fichier modifié, ou après quatre relances.

**F-7 — `☠` La mémoire sémantique est en LECTURE SEULE pour tout ccremote.** Décision de
l'opérateur du 2026-08-01, appliquée dans `harness/workers/mcp-du-poste.ts` : le harness impose le
point d'accès `CCREMOTE_MEMOIRE_URL_LECTURE` / `_JETON_LECTURE`, et **si aucun accès en lecture
n'est fourni, la mémoire est retirée de la boîte à outils plutôt que passée en écriture**.
L'orchestrateur lui-même n'écrit pas (H-66 : la parole d'une équipe n'est pas celle de l'humain).
**Cela tranche la question du stockage** — voir §4.

**F-8 — Il existe déjà un réducteur de tours bon marché.** `harness/anti-boucle/extraction-signaux.ts`
réduit N tours en signaux (`ResumeTour` : outils, cibles, erreurs, fichiers, tests) **sans jamais
donner le transcript à un modèle**. La boucle d'apprentissage réutilise cette forme comme entrée
intermédiaire ; elle ne rebâtit pas un second extracteur.

---

## 3. Contrainte d'inférence : vLLM local, Qwen3 8B AWQ

Contrainte dure de l'opérateur. Elle n'est pas une préférence de déploiement, elle **dimensionne
les prompts**.

- **Un seul point de sortie**, `harness/apprentissage/client-vllm.ts`, endpoint compatible OpenAI
  (`POST /v1/chat/completions`), URL et modèle lus dans l'environnement
  (`CCREMOTE_APPRENTISSAGE_VLLM_URL`, `CCREMOTE_APPRENTISSAGE_VLLM_MODELE`). Aucun autre fichier du
  domaine ne fait d'appel réseau. **Zéro appel à l'API Anthropic, zéro token de quota Claude.**
- **Indisponible ⇒ dégradation, jamais échec.** vLLM éteint (le PC ne réserve pas sa VRAM, cf.
  `mcp-du-poste.ts` sur `echohub`) ⇒ la passe est **différée**, l'observation reste en file sur
  disque, et un `warn` le dit. Jamais de repli sur un modèle payant, jamais de blocage d'une
  clôture de mission.
- **Budget par appel** : ≤ 3 000 tokens d'entrée, ≤ 300 de sortie, température 0.2, timeout 45 s,
  **2 tentatives maximum** puis abandon de la passe (boucle bornée, standard maison).
- **Sorties structurées courtes et validées.** Toute réponse du modèle est **entrée non fiable** :
  elle est parsée en JSON, validée contre un schéma explicite, et **rejetée avant toute écriture**
  si elle ne correspond pas. Un rejet est loggé avec l'extrait fautif, jamais avalé.
- **Découpe obligatoire.** Un 8B ne lit pas une mission entière. Le pipeline est en deux temps :
  (1) réduction **déterministe et sans modèle** du transcript en `ResumeMission` (§5.1) ;
  (2) une à trois requêtes courtes sur ce résumé, **jamais sur le JSONL brut**.
- **Aucun raisonnement long attendu.** Les prompts demandent des listes de 0 à 3 éléments, chacun
  en une phrase. Pas de chaîne de raisonnement, pas de plan, pas de justification en prose.

---

## 4. La mémoire sémantique V1 face à la boucle : ce qui manque, et ce qu'on en fait

Cadrage de l'opérateur (2026-08-08, transmis par l'orchestrateur) : la mémoire sémantique branchée
aujourd'hui est une **V1 de mémoire — stockage et recherche, en PULL**. Ce n'est pas un système
d'apprentissage et ce n'est pas une référence à préserver. La question n'est donc pas « comment
cohabiter » mais « qu'est-ce que la boucle de Hermes fait que notre mémoire ne fait pas ».

### 4.1 Ce que la V1 sait faire

Capacités exposées aux équipes, telles que le harness les leur donne (`MCP_EQUIPE` dans
`harness/workers/mcp-du-poste.ts`, serveur `semantic-memory`) : recherche sémantique
(`memory_search`), listage et arborescence (`memory_list`, `memory_tree`, `memory_overview`),
descente dans un nœud et voisinage (`memory_drill_down`, `memory_get_neighbors`), contexte de projet
(`memory_get_project_context`), statistiques, todos, profil, liste de projets. **Toutes en lecture.**
L'écriture n'est pas transmise (F-7 : le harness impose le point d'accès en lecture, et retire la
mémoire de la boîte à outils plutôt que de passer un jeton d'écriture).

C'est un magasin interrogeable. Rien de plus, et ce n'est pas un défaut de qualité : c'est une
catégorie d'outil différente.

### 4.2 Les quatre capacités que la boucle Hermes a en plus

Chacune est vérifiée dans le code de Hermes, pas déduite.

| Capacité | Ce que la V1 fait | Ce que Hermes fait en plus | Où c'est vérifié |
|---|---|---|---|
| **Boucle fermée** — l'agent relit ce qu'il a fait et en tire des leçons **sans qu'on le lui demande** | rien : il faut qu'un agent pense à appeler `memory_search`, et personne ne lui demande jamais d'écrire | un thread de revue est armé par un compteur et part **tout seul** après chaque réponse, sur un instantané de la conversation | `agent/turn_context.py:210-217`, `agent/turn_finalizer.py:375-401`, `agent/background_review.py:327-568` (H-1) |
| **Curation autonome** — le corpus se réorganise seul | rien : ce qui est écrit reste tel quel, indéfiniment, et grossit | un curateur périodique fusionne les entrées redondantes en parapluies, archive l'inactif, patche l'obsolète, et écrit un rapport de passe | `agent/curator.py:198-315` (transitions par horloge, sans modèle) et `344-489` + `1407-1610` (revue par modèle auxiliaire) (H-8) |
| **Compétences créées et améliorées depuis l'expérience** — le corpus contient du *savoir-faire*, pas seulement des faits | des documents à retrouver | l'agent **écrit ses propres procédures** : `skill_manage` expose `create, patch, edit, delete, write_file, remove_file`, et le prompt de revue lui ordonne de patcher en priorité une compétence déjà chargée plutôt que d'en créer une nouvelle | `tools/skill_manager_tool.py:838` et `:1028` (actions), `:965-977` (télémétrie de patch), `agent/background_review.py:45-149` (ordre de préférence 1→4) (H-4/H-5) |
| **Réinjection en PUSH** — le savoir est **déjà là** au démarrage | PULL : rien n'arrive si personne n'interroge | l'index des compétences et l'instantané de mémoire entrent dans le **system prompt**, dans la zone stable mise en cache — l'agent démarre en sachant | `agent/system_prompt.py:207-215`, `agent/prompt_builder.py:1118-1200` (H-4), `tools/memory_tool.py:133-172` (instantané gelé, H-2) |

Le mot qui résume l'écart : la V1 est un **magasin**, la boucle Hermes est un **cycle**. Un magasin
ne se remplit pas tout seul, ne se nettoie pas tout seul, et ne se présente pas tout seul.

### 4.3 Ce qu'il advient de la V1 — tranché

**Reléguée au rang de magasin de consultation, derrière la nouvelle boucle. Ni absorbée, ni
supprimée.** Raison, en trois points :

1. **Elle ne peut pas porter la boucle**, même si on le voulait. Le point de réinjection est
   `construireWorkerSpec` (F-4), **avant** que la session n'existe : à cet instant il n'y a aucun
   agent pour appeler un outil MCP. Le PUSH exige une lecture par du code, locale et synchrone. Une
   V1 en PULL, derrière HTTP et un jeton, ne peut structurellement pas servir ce point.
2. **Elle n'a pas la granularité.** Une leçon porte un cycle de vie (`candidate → active →
   dormante → obsolete`), des compteurs de confirmation **et de contradiction**, une provenance de
   mission, une portée. La V1 indexe des documents pour la recherche ; elle n'arbitre pas de cycle
   de vie et ne répond pas à « donne-moi les 5 leçons actives de ce projet, triées par
   confirmations ».
3. **Elle reste utile telle quelle pour ce qu'elle fait bien.** Elle porte le contexte durable écrit
   par l'humain, partagé entre projets et entre équipes. La boucle ne le reprend pas et ne le
   duplique pas : elle **lit** ce corpus quand elle en a besoin, et écrit le sien ailleurs.

**Conséquence assumée : deux corpus coexistent, avec une frontière nette.**

| | mémoire sémantique V1 | `apprentissage.db` + bibliothèque de compétences (C-7, C-8) |
|---|---|---|
| Qui écrit | l'humain, depuis ses propres sessions | le harness, après la mort d'une équipe |
| Ce qu'on y met | ce que Chris décide de retenir | ce que les équipes ont **fait** et ce qui en découle |
| Comment ça arrive | PULL, sur appel d'outil | PUSH, dans le mandat, sans rien demander |
| Cycle de vie | aucun | confirmation, contradiction, consolidation, péremption |

**Ce qui n'est pas tranché ici, et pourquoi** : faire de `apprentissage.db` la source d'un futur
export vers la V1 (ou l'inverse) est une décision d'opérateur, pas d'implémenteur — elle touche
H-66 (ccremote n'écrit pas au nom de Chris). La v1 de la boucle ne le fait pas. Le chemin reste
ouvert : une leçon promue `active` peut être **proposée** par notification, à charge de l'humain de
la verser lui-même s'il la valide. Voir `PLAN-PORTAGE.md`, étape 9, pour le coût si l'opérateur
tranche dans l'autre sens.

---

## 5. Mécanismes RETENUS

Nommage : `C-n` (ccremote). La correspondance Hermes est indiquée, elle n'est jamais une
transposition ligne à ligne.

**Table de décision — les onze mécanismes de l'inventaire, un verdict chacun :**

| Inventaire | Verdict | Devient |
|---|---|---|
| H-1 revue de fin de tour en fork | **retenu en intention, mécanisme écarté** | C-3 (déclenché à la clôture, servi par vLLM) |
| H-2 `MEMORY.md` | **retenu, refondu** | C-7 (`apprentissage.db`) — la moitié `USER.md` est écartée |
| H-3 fournisseurs de mémoire externes | **écarté** | — |
| H-4 bibliothèque de skills + index | **retenu** | C-8 + l'étage index de C-6 |
| H-5 chargement à la demande | **retenu dégraissé** | C-8 (le préprocessing est écarté) |
| H-6 bundles | **écarté** | — |
| H-7 compteurs d'usage | **écarté sous cette forme** | remplacé par les confirmations de C-5 |
| H-8 curator | **retenu** | C-4 |
| H-9 snapshot/rollback | **retenu en version réduite** | la sauvegarde de C-4 |
| H-10 insights | **écarté** | — |
| H-11 trajectoires + compresseur | **écarté** | son heuristique inspire C-1 |

Les motifs des écarts sont en §7, un par ligne.

### C-1 — Réduction déterministe d'un transcript en `ResumeMission`

*(Pas d'équivalent Hermes : chez lui, le contexte est déjà en mémoire vive. C'est notre socle, et
c'est le seul mécanisme dont tout le reste dépend.)*

- **Ce que ça devient** : une fonction **pure, sans modèle, sans réseau** qui lit un transcript
  JSONL et rend un objet borné. C'est la brique qui rend le reste finançable : un 8B ne verra
  jamais autre chose que sa sortie.
- **Source de données réelle** : F-1/F-2/F-3 — le fichier
  `<configDir>/projects/<cleProjet(cwd)>/<sessionId>.jsonl` et, s'ils existent, les transcripts de
  sous-agents du même dossier. Chemin résolu par réutilisation de `sous-agents-disque.ts`.
- **Artefact écrit** : aucun sur disque à ce stade ; la valeur est passée à C-2. (Elle peut être
  mise en cache dans `apprentissage.db`, table `resume_mission`, pour ne pas relire un JSONL deux
  fois.)
- **Moment du cycle de vie** : à la clôture d'une mission (§6).
- **Forme** (contrat, pas implémentation) :

```ts
export interface ResumeMission {
  readonly missionId: string;
  readonly sessionId: string;
  readonly projet: string;               // chemin du dépôt, pas le worktree
  readonly mandatResume: string;         // 400 caractères max, tête du mandat
  readonly critereArret: string | null;
  readonly issue: IssueMission;          // voir C-2
  readonly dureeMs: number;
  readonly nbTours: number;
  readonly outils: readonly { readonly nom: string; readonly appels: number; readonly echecs: number }[];
  readonly erreurs: readonly string[];   // messages d'erreur d'outil normalisés, ≤ 10, dédupliqués
  readonly fichiersTouches: readonly string[];   // ≤ 30, chemins relatifs au projet
  readonly commandesEchouees: readonly string[]; // ≤ 10, commande + code de sortie
  readonly sousAgents: readonly { readonly type: string | null; readonly description: string | null }[];
  readonly extraitFinal: string;         // 1 500 caractères du dernier message assistant
}
```

- **Bornes non négociables** : la sortie tient sous **2 000 tokens** quelle que soit la taille du
  transcript. Un transcript de 200 Mo produit le même gabarit qu'un transcript de 40 ko.
- **`☠` Lecture en flux, jamais `readFileSync` entier** : un transcript de mission longue dépasse
  facilement la centaine de Mo. Lecture ligne à ligne, `JSON.parse` par ligne, ligne illisible
  comptée et ignorée (le compteur est loggé, un fichier tronqué en fin d'écriture est un cas
  normal).

### C-2 — Classement d'issue (sans modèle)

*(Correspond au *signal* que Hermes laisse au jugement du modèle — chez nous, il est gratuit et
déterministe, donc il ne coûte pas un token.)*

- **Ce que ça devient** : une fonction pure qui décide comment une mission s'est terminée, à partir
  de faits déjà persistés.
- **Source de données réelle** : F-5 et F-6 — `etatHarness` terminal, `derniereRaisonTerminale`,
  `constatGit` (`fichiersModifies`, `dernierCommit`), `compteurRelances`, `inspection` (verdict
  anti-boucle), `budgetConsommeUsd` vs `budgetMaxUsd`, `contexteTokensUtilises`.
- **Artefact écrit** : le champ `issue` de `ResumeMission`, et une colonne dans `apprentissage.db`.
- **Moment** : même passe que C-1.
- **Valeurs** : `livree` · `livree_partielle` · `sans_effet` (terminée, zéro fichier modifié) ·
  `boucle` (verdict H-68) · `budget_epuise` · `interrompue` · `echec_technique`.
- **`☠` `constatGit === null` signifie « jamais mesuré », jamais « propre »** — c'est écrit noir sur
  blanc dans `registre/types.ts`, et c'est exactement l'erreur qui présenterait une équipe stérile
  comme une équipe qui a livré. Une mission sans constat produit `issue = inconnue` et **n'alimente
  aucune leçon**.

### C-3 — Extraction de leçons par le modèle local

*(Transposition de H-1, le fork de revue — mais déclenché à la clôture, restreint aux skills, et
servi par vLLM.)*

- **Ce que ça devient** : une passe locale qui reçoit **un `ResumeMission`** (jamais un transcript)
  et rend **0 à 3 leçons candidates**, chacune en une phrase, avec sa portée.
- **Source de données réelle** : la sortie de C-1/C-2, plus la liste des leçons **déjà actives** du
  même projet — pour que le modèle puisse dire « c'est la même que L-17 » au lieu d'en créer une
  dix-septième variante.
- **Artefact écrit** : lignes dans `apprentissage.db`, table `lecon` (§5.6), à l'état `candidate`.
- **Moment** : à la clôture, après C-1/C-2, en tâche de fond ; **jamais dans le chemin de clôture
  lui-même** (une clôture ne doit pas attendre le GPU).
- **Forme de sortie exigée du modèle** (schéma validé, toute autre forme rejetée) :

```ts
export interface LeconExtraite {
  readonly enonce: string;        // une phrase, impératif, ≤ 200 caractères
  readonly categorie: 'outil' | 'projet' | 'methode' | 'piege';
  readonly portee: 'projet' | 'machine' | 'global';
  readonly preuve: string;        // ≤ 200 caractères, cité depuis le ResumeMission
  readonly doublonDe: string | null; // id d'une leçon active, si c'en est une reformulation
}
```

- **Liste négative, reprise de Hermes parce qu'elle vient de dégâts réels** — le prompt l'énonce et
  un filtre déterministe la rattrape après coup :
  1. pas de panne d'environnement (binaire absent, service éteint, identifiants non configurés) ;
  2. **pas d'affirmation négative sur un outil** (« Playwright ne marche pas ») — c'est le motif qui
     se durcit en refus permanent ; si un outil a échoué par défaut de configuration, la leçon est
     *le correctif*, jamais *l'incapacité* ;
  3. pas d'erreur transitoire résolue dans la même mission (la leçon serait le retry, pas la panne) ;
  4. pas de narration de tâche unique (« corriger le bug X du 8 août ») ;
  5. **pas de leçon qui nomme une mission, une date ou un identifiant de branche** — si l'énoncé
     n'a de sens que pour cette mission-là, il est rejeté.
- **`☠` Sortie de modèle = entrée non fiable.** `portee` et `categorie` sont validées contre
  l'ensemble accepté ; `doublonDe` doit désigner une leçon existante du même projet ou être `null` ;
  un énoncé hors bornes est tronqué-rejeté, pas tronqué-accepté. Le message de rejet **liste les
  valeurs acceptées** (standard maison : un rejet doit être actionnable par un modèle).

### C-4 — Consolidation périodique (le curateur)

*(Transposition de H-8, ramenée à ce qu'un 8B sait faire.)*

- **Ce que ça devient** : une passe périodique qui (1) applique des **transitions d'état par
  horloge, sans modèle**, et (2) demande au modèle local, projet par projet, de fusionner les
  leçons actives qui disent la même chose.
- **Source de données réelle** : `apprentissage.db` seule. Aucun transcript relu.
- **Artefact écrit** : mises à jour d'état dans `lecon`, plus un **rapport de passe** Markdown daté
  sous `~/.local/share/ccremote/apprentissage/rapports/<iso>.md` — ce qui a été fusionné, promu,
  retiré, et pourquoi.
- **Moment** : sur un tick d'arrière-plan du superviseur, avec les mêmes portes que Hermes :
  intervalle minimum **7 jours** depuis la dernière passe, **aucune mission active sur la machine**,
  vLLM joignable. Première observation : on **sème** l'horodatage et on diffère d'un intervalle
  complet (on ne consolide pas une base de trois leçons).
- **Transitions par horloge, sans modèle** :
  - `candidate` → `active` : deux confirmations par des missions **distinctes** (C-5).
  - `active` → `dormante` : 60 jours sans nouvelle confirmation.
  - `dormante` → `active` : une nouvelle confirmation.
  - `active` → `obsolete` : **uniquement** sur contradiction (C-5) ou sur geste explicite.
- **`☠` Jamais de suppression.** État `obsolete` et exclusion du service ; la ligne reste, avec sa
  provenance. Le corollaire Hermes s'applique tel quel : archiver est récupérable, supprimer ne
  l'est pas.
- **`☠` Snapshot avant toute passe mutante** : copie de `apprentissage.db` dans
  `apprentissage/sauvegardes/<iso>.db`, 5 conservées. C'est H-9, réduit à sa forme utile — la base
  est un fichier, la sauvegarde est une copie, il n'y a pas d'archive à construire.

### C-5 — Confirmation et contradiction

*(Sans équivalent Hermes. C'est notre garde-fou n°1, celui qui remplace la relecture humaine que
Hermes obtient gratuitement.)*

- **Ce que ça devient** : à chaque nouvelle extraction (C-3), les leçons rendues sont **rapprochées
  des leçons existantes** du même projet. Une leçon re-produite par une mission distincte gagne une
  confirmation ; une leçon dont l'inverse est observé gagne une **contradiction**.
- **Source de données réelle** : les `LeconExtraite` de la passe courante + la table `lecon`. Le
  rapprochement est **d'abord lexical** (normalisation, n-grammes, seuil de similarité) et n'appelle
  le modèle que pour départager les cas ambigus — un 8B n'est pas nécessaire pour reconnaître deux
  phrases quasi identiques.
- **Artefact écrit** : `confirmations`, `contradictions`, `derniereConfirmationA` sur la ligne
  `lecon`, et une ligne dans `lecon_observation` (mission d'origine, date, extrait).
- **Moment** : dans la même passe que C-3.
- **Règles** : deux confirmations de **missions différentes** promeuvent en `active`. **Une seule
  contradiction rétrograde immédiatement en `candidate`** — l'asymétrie est voulue : servir une
  leçon fausse coûte plus cher que ne pas servir une leçon vraie.

### C-6 — Réinjection dans le mandat d'une équipe

*(Transposition de H-4 : l'index compact des skills. Même principe — peu de contexte, toujours
présent — mais notre index tient en cinq lignes, pas en cent.)*

- **Ce que ça devient** : un bloc de texte court ajouté au mandat d'une équipe au moment où son
  `WorkerSpec` est construit. C'est **le** mécanisme de PUSH — la capacité que la V1 n'a pas
  (§4.2) : une équipe démarre en sachant, sans avoir rien demandé.
- **Source de données réelle** : `apprentissage.db`, leçons `active` dont la portée couvre le
  projet visé, triées par (confirmations décroissantes, récence) ; **et** l'index des compétences
  `active` de C-8 (nom, description, chemin absolu).
- **Point de branchement** : `harness/composition/pc/construire-worker-spec.ts` — F-4. Le domaine
  `apprentissage/` **expose une fonction pure** `composerBlocLecons(projet, machine): string` ; le
  site de composition l'appelle et concatène. Le domaine `workers/` reste ignorant de tout ceci
  (frontière respectée : `workers/` ne connaît qu'un `mandate: string`).
- **Artefact écrit** : rien — c'est le seul mécanisme en lecture pure.
- **Moment** : au dispatch, avant le démarrage de la session.
- **Bornes** : **5 leçons + 10 compétences maximum, 1 200 caractères au total**, sous un titre
  explicite. Au-delà, on ne sert pas — on laisse la place au mandat, qui est le vrai travail. Le
  budget est petit **par construction** : l'index ne porte jamais de corps de procédure, seulement
  de quoi décider d'aller le lire. Format servi :

```
CE QUE LES ÉQUIPES PRÉCÉDENTES ONT APPRIS SUR CE PROJET
(observations automatiques, confirmées au moins deux fois — contredis-les si tu constates l'inverse)
· <énoncé> [confirmée 3×, dernière le 2026-08-04]
· <énoncé> [confirmée 2×, dernière le 2026-07-29]

PROCÉDURES DÉJÀ ÉCRITES POUR CE PROJET — ouvre le fichier si ta tâche en relève
· reprise-worktree-git — reprendre un worktree laissé par une équipe précédente
  /home/trinity/.local/share/ccremote/apprentissage/competences/reprise-worktree-git/COMPETENCE.md
```

- **`☠` La phrase « contredis-les si tu constates l'inverse » n'est pas décorative** : elle est ce
  qui empêche une leçon fausse de se figer en dogme, et elle est ce qui alimente C-5 en
  contradictions. Elle ne se retire pas.
- **`☠` Zéro leçon active ⇒ bloc absent, pas bloc vide.** Un en-tête sans contenu consomme du
  contexte et apprend au lead que le mécanisme est creux.

### C-7 — Stockage propre : `apprentissage.db`

*(Correspond à H-2 + H-7 : le magasin et sa télémétrie, fondus en une base unique parce que chez
nous il n'y a ni fichier lisible par l'humain à maintenir, ni bibliothèque de fichiers à indexer.)*

- **Ce que ça devient** : une base SQLite (Bun `bun:sqlite`, comme le registre et le session-store)
  sur la machine de travail, à côté de `registre-pc.db`.
- **Source de données réelle** : uniquement les sorties de C-2, C-3 et C-5 — ce magasin ne lit
  aucune source externe. Il est le seul état durable de la boucle, avec les fichiers de C-8.
- **Emplacement** : `${CCREMOTE_APPRENTISSAGE_DB:-~/.local/share/ccremote/apprentissage.db}`.
- **Pourquoi côté PC et pas au Pi** : les deux extrémités de la boucle y sont — le transcript (F-1)
  et le GPU. Faire transiter des transcrits par le canal D.3 pour les traiter au Pi, qui n'a ni
  l'un ni l'autre, ajouterait une extension de contrat (signalée comme coûteuse dans
  `harness/ARCHITECTURE.md`, point 3) pour aucun gain. La conséquence assumée est énoncée en §8.
- **Schéma** (contrat) :

```sql
CREATE TABLE lecon (
  id TEXT PRIMARY KEY,
  projet TEXT NOT NULL,               -- chemin du dépôt ; '*' pour une portée globale
  machine TEXT,                       -- NULL si la leçon ne dépend pas de la machine
  enonce TEXT NOT NULL,
  categorie TEXT NOT NULL,            -- outil | projet | methode | piege
  portee TEXT NOT NULL,               -- projet | machine | global
  etat TEXT NOT NULL,                 -- candidate | active | dormante | obsolete
  confirmations INTEGER NOT NULL DEFAULT 1,
  contradictions INTEGER NOT NULL DEFAULT 0,
  creee_a INTEGER NOT NULL,
  derniere_confirmation_a INTEGER NOT NULL,
  servie_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE lecon_observation (
  lecon_id TEXT NOT NULL REFERENCES lecon(id),
  mission_id TEXT NOT NULL,
  sens TEXT NOT NULL,                 -- confirme | contredit
  preuve TEXT NOT NULL,
  observee_a INTEGER NOT NULL
);
CREATE TABLE passe_apprentissage (
  mission_id TEXT PRIMARY KEY,        -- une mission n'est traitée qu'une fois
  traitee_a INTEGER NOT NULL,
  issue TEXT NOT NULL,
  lecons_extraites INTEGER NOT NULL,
  erreur TEXT                         -- non NULL ⇒ passe échouée, rejouable
);
```

- **`☠` `passe_apprentissage` est la clé d'idempotence.** Sans elle, une relance du superviseur
  retraite les mêmes missions et gonfle les compteurs de confirmation avec **la même** observation —
  ce qui promeut en `active` une leçon vue une seule fois. C'est le défaut le plus probable de ce
  sous-système ; il est structurellement fermé par cette table, pas par une précaution d'appelant.

### C-8 — Compétences : du savoir-faire écrit depuis l'expérience

*(Transposition de H-4 + H-5 + la partie « skills » de H-1. C'est la capacité n°3 du §4.2 — ce qui
distingue un corpus de faits d'un corpus de savoir-faire. Une leçon (C-3) dit « attention à ceci » ;
une compétence dit « voici comment on fait ceci, ici ».)*

- **Ce que ça devient** : une bibliothèque de procédures, écrite par la boucle, portée par le
  harness, servie en PUSH à toute équipe dont la mission relève du sujet.
- **Source de données réelle** : les mêmes `ResumeMission` que C-3, plus les compétences existantes.
  Une compétence naît quand **trois leçons `active` du même projet partagent une catégorie et un
  vocabulaire** — c'est-à-dire quand la boucle constate qu'un thème revient assez pour mériter une
  procédure, et non à chaque mission.
- **Artefact écrit** : un dossier par compétence, en **fichiers lisibles**, pas en base :

```
~/.local/share/ccremote/apprentissage/competences/<slug>/COMPETENCE.md
                                                        references/<sujet>.md   (optionnel)
```
```markdown
---
nom: reprise-worktree-git
description: Reprendre un worktree laissé par une équipe précédente sans perdre son travail
portee: projet            # projet | machine | global
projet: /mnt/projects/ccremote
etat: active              # candidate | active | dormante | obsolete
confirmations: 4
origine: [mission-a3f, mission-b81, mission-c04]
maj: 2026-08-04
---

## Quand ça s'applique
· <une ligne>

## Marche à suivre
1. <une ligne>

## Pièges déjà payés
· <une ligne> [mission-b81, 2026-07-29]
```

- **Moment du cycle de vie** :
  - *création / amendement* — dans la passe de clôture, après C-3/C-5 ;
  - *consolidation / archivage* — dans la passe périodique C-4, qui traite compétences et leçons
    dans le même mouvement (fusionner deux compétences jumelles, rétrograder l'inactive) ;
  - *service* — au dispatch, par C-6.
- **`☠` Le modèle local ne réécrit JAMAIS un fichier.** C'est la différence majeure avec Hermes, et
  elle est délibérée : Hermes confie `skill_manage(action='write_file')` à un modèle frontière avec
  un humain qui lit derrière ; nous avons un 8B et personne qui relit. Le 8B **propose une
  opération structurée**, le harness l'**applique de façon déterministe** :

```ts
export type OperationCompetence =
  | { readonly type: 'creer'; readonly nom: string; readonly description: string;
      readonly quand: readonly string[]; readonly etapes: readonly string[] }   // ≤ 3 · ≤ 5
  | { readonly type: 'ajouter_piege'; readonly slug: string; readonly ligne: string }
  | { readonly type: 'ajouter_etape'; readonly slug: string; readonly ligne: string;
      readonly apresEtape: number }
  | { readonly type: 'rien' };
```

  Une opération inconnue, un `slug` qui ne désigne aucune compétence existante, une ligne au-delà
  de 200 caractères ⇒ **rejet avant toute écriture**, avec la liste des opérations acceptées dans le
  message (un modèle se corrige depuis une liste, pas depuis un échec muet). Il n'existe **aucun
  chemin** par lequel du texte généré devienne un fichier entier.
- **`☠` Un `create` exige trois leçons `active` convergentes ; un `ajouter_piege` exige une leçon
  `active`.** Sans ce seuil, une bibliothèque de 200 procédures d'une ligne apparaît en trois
  semaines — c'est exactement l'échec que le curateur de Hermes passe son temps à réparer
  (`curator.py:344-360` : « a collection of hundreds of narrow skills … is a FAILURE of the library,
  not a feature »). On préfère prévenir : le seuil coûte moins cher que la consolidation.
- **`☠` Aucune exécution depuis une compétence.** Pas de substitution de variables, pas de shell
  inline (Hermes a `!`cmd`` désactivé par défaut, `skill_preprocessing.py:130-138`). Une compétence
  est du **texte lu par un lead**, jamais un script exécuté par le harness. Cette porte reste fermée.
- **Réinjection** : deux étages, comme Hermes, et pour la même raison de coût.
  1. **Index compact, en PUSH dans le mandat** (C-6) : nom, description, chemin absolu du fichier.
     ≤ 10 lignes.
  2. **Corps complet à la demande** : le lead ouvre le fichier avec l'outil `Read` qu'il a déjà.
     Aucun MCP à écrire, aucun outil à ajouter, aucune permission nouvelle — le chemin absolu dans
     l'index suffit.

---

## 6. Le cycle de vie, de bout en bout

```
  dispatch                                                            clôture
     │                                                                   │
     ▼                                                                   ▼
 construireWorkerSpec ──C-6──► mandat enrichi ──► session ──► JSONL ──► ServiceCloture
   (lecture seule)                                            sur disque      │
                                                                              │ file d'attente
                                                                              ▼
                                                        ┌──────── tâche de fond ────────┐
                                                        │ C-1 réduction (sans modèle)   │
                                                        │ C-2 issue    (sans modèle)    │
                                                        │ C-3 extraction (vLLM local)   │
                                                        │ C-5 confirmation/contradiction│
                                                        │ C-8 création/amendement       │
                                                        └───────────────┬───────────────┘
                                                                        ▼
                                                     apprentissage.db  +  competences/*.md
                                                                        │
                                     tous les 7 jours, machine au repos  ▼
                                                                 C-4 consolidation
```

**Trois points de branchement, et aucun autre :**

1. **Entrée** — un observateur s'abonne à la clôture (`control-plane/cloture/` côté Pi transporte la
   décision, le superviseur PC la constate). `☠` La passe est **asynchrone et sans effet de bord sur
   la clôture** : une passe qui échoue, qui rame ou qui trouve vLLM éteint ne doit **jamais**
   empêcher une mission d'être close ni un projet d'être libéré (H-56 : une mission qui ne se ferme
   pas verrouille son worktree). En file, rejouable, et c'est tout.
2. **Sortie** — `construireWorkerSpec` (F-4).
3. **Horloge** — un tick du superviseur pour C-4.

---

## 7. Mécanismes ÉCARTÉS, et pourquoi

Un portage 1:1 n'est pas l'objectif. Ce qui suit est écarté **délibérément**, avec le motif ; une
équipe qui voudrait en réintroduire un doit d'abord réfuter le motif.

| Hermes | Décision | Motif |
|---|---|---|
| **H-2 `USER.md`** (profil de l'utilisateur) | **Écarté** | L'« utilisateur » d'un lead ccremote est l'orchestrateur, dont le comportement est déjà écrit dans le prompt système. Apprendre le profil d'un agent que l'on programme soi-même est une boucle qui se mord la queue. Le profil de **l'humain** existe déjà en mémoire sémantique, et ccremote n'y écrit pas (F-7). |
| **H-3 fournisseurs de mémoire externes** (`MemoryManager` + plugins) | **Écarté** | C'est une couche d'adaptation vers des services tiers (honcho, mem0, supermemory). Nous n'en avons aucun et n'en voulons aucun : full local. La V1 sémantique n'en est pas un non plus — elle reste consultée par les équipes via son MCP, sans passer par une abstraction de fournisseur. |
| **H-4 skills en fichiers** | **RETENU → C-8** | Requalifié après la correction de cap du 2026-08-08 : c'est l'une des quatre capacités que la V1 n'a pas (§4.2). Transposé avec deux durcissements imposés par le modèle 8B et l'absence de relecture humaine : opérations d'édition **structurées et appliquées par le harness** (jamais d'écriture de fichier par le modèle), et **seuil de trois leçons convergentes** avant création. |
| **H-5 chargement à la demande** | **RETENU en version dégraissée → C-8** | Le chargement à la demande est conservé (l'index pousse, le corps se lit) mais **sans machinerie** : le lead ouvre le fichier avec `Read`, il n'y a ni commande slash à écrire, ni MCP, ni catalogue à maintenir. **Écarté de H-5** : le préprocessing — substitution de variables et surtout shell inline ``!`cmd` ``. Une surface d'exécution ouverte par du texte généré localement n'a aucune contrepartie ; Hermes lui-même la livre désactivée. |
| **H-6 bundles** | **Écarté** | Grouper des compétences pour les charger ensemble suppose un catalogue assez gros pour qu'on s'y perde. À dix compétences par projet, c'est de la machinerie sans problème à résoudre. À rouvrir si l'index de C-6 sature durablement. |
| **H-7 compteurs d'usage** (`use_count`…) | **Écarté sous cette forme** | Hermes compte les *vues* et *usages* d'un fichier de skill. Chez nous, une leçon est **toujours** servie si elle est active : le compteur n'apprend rien. Ce qui apprend, ce sont les **confirmations et contradictions** (C-5), qui mesurent la véracité et non la popularité. La règle 4 du prompt de curation Hermes dit d'ailleurs déjà de ne pas décider sur des compteurs d'usage. Un unique `servie_count` est conservé, pour l'exploitation, jamais pour la décision. |
| **H-9 rollback complet** (tar.gz, manifeste, cron) | **Retenu en version réduite** (dans C-4) | La machinerie Hermes existe parce qu'une arborescence de centaines de fichiers est en jeu, avec des références croisées dans des tâches cron. Chez nous l'état tient dans **un fichier SQLite** : la sauvegarde est une copie, la restauration aussi. Le reste est du poids mort. |
| **H-10 insights** (analytique tokens/coûts) | **Écarté** | ccremote a déjà `budgets/`, `superviseur/collecteur-telemetrie.ts`, `control-plane/api-web/` et la sonde de quotas. Reconstruire une analytique serait un doublon, et le mandat exclut explicitement tout dashboard. |
| **H-11 trajectoires ShareGPT + compresseur** | **Écarté** | C'est une chaîne de production de **données d'entraînement** pour fine-tuner un modèle, pas une boucle d'apprentissage en ligne. Personne ici n'entraîne de modèle sur les sessions ccremote. **Ce qu'on en garde** : l'heuristique de compression (protéger les extrémités, condenser le milieu) inspire C-1. |
| **H-1 fork héritant du runtime parent + cache de préfixe** | **Écarté** | Toute son ingénierie (system prompt épinglé, `session_id` partagé, compression désactivée pour ne pas gagner une course) sert à **réutiliser le cache du fournisseur payant**. Notre inférence est locale, gratuite, et tourne **après** la mort de la session : il n'y a ni cache à préserver, ni course à perdre. Ce qui est retenu de H-1, c'est son **intention** (une passe de revue hors du chemin critique, aux outils strictement bornés) et ses **listes négatives**, pas son mécanisme. |
| **Nudge par compteur de tours (10 tours / 10 itérations)** | **Écarté** | Remplacé par le déclencheur de clôture. Une équipe ccremote ne revit pas : apprendre au milieu de sa vie ne profiterait à personne, et coûterait du GPU pendant qu'elle travaille. |
| **Écriture pendant la session** | **Écarté, et c'est structurel** | Chez Hermes l'agent s'écrit à lui-même. Chez nous, une équipe **ne doit jamais** pouvoir écrire dans `apprentissage.db` : ce serait lui donner le droit d'inscrire dans le mandat de toutes les suivantes. Seul le harness écrit, et seulement après la mort de la session. |

---

## 8. Ce que cette spec assume, et qui pourrait la mordre

Énoncé ici pour qu'une équipe d'implémentation n'ait pas à le redécouvrir.

1. **Une leçon fausse promue est le pire cas.** C-5 (deux confirmations, une contradiction suffit à
   rétrograder) et le libellé de C-6 (« contredis-les ») sont les deux seules protections. Aucun
   humain ne relit. Si cette boucle devait déraper, c'est par là.
2. **La base vit sur la machine de travail.** Deux machines ⇒ deux bases, donc une leçon apprise sur
   le PC ne sert pas une équipe du VPS. Assumé pour la v1 : les leçons de portée `projet` sont
   naturellement liées à la machine qui héberge le dépôt. Une agrégation ultérieure passerait par le
   lien Pi↔PC existant, sans nouveau transport.
3. **vLLM est un service que le harness ne possède pas.** Le PC ne réserve pas sa VRAM. La boucle
   doit donc traiter l'indisponibilité comme le cas **normal**, pas comme une panne : file d'attente
   persistante, reprise à la passe suivante, jamais de perte de l'observation.
4. **Le format du JSONL appartient au CLI Claude Code.** Il changera. C-1 est la seule fenêtre sur ce
   format ; elle tolère l'inconnu (F-2) et un banc d'acceptation sur un transcript réel est ce qui
   détectera une rupture — pas un test unitaire sur une fixture figée.
5. **Un budget de contexte de 1 200 caractères est un choix, pas une mesure.** Il est délibérément
   petit : le mandat est le vrai travail, les leçons et l'index de compétences sont un supplément. À
   réviser sur constat, pas sur intuition.
6. **Deux corpus coexistent** (§4.3) et rien ne garantit qu'ils ne se contredisent pas : une note
   écrite par Chris en mémoire sémantique peut dire l'inverse d'une leçon apprise par la boucle. La
   v1 ne tente pas de réconcilier — l'humain fait autorité, et une contradiction constatée par une
   équipe doit remonter dans son rapport, pas être arbitrée par un 8B.
7. **La bibliothèque de compétences peut proliférer.** C'est l'échec documenté de Hermes, réparé
   chez lui à coups de curation. Le seuil de trois leçons convergentes (C-8) est notre prévention ;
   s'il ne suffit pas, le signal sera visible tôt — nombre de compétences `active` par projet dans
   le rapport de passe de C-4 — et le remède est de monter le seuil, pas d'ajouter de la
   consolidation.
