# Contrat API — harness (orchestrateur + équipes)

Ce document décrit ce que le control plane du harness sert RÉELLEMENT à `pi-web`, et ce que
`pi-web` en appelle. Il n'est plus une spécification à venir : le back-end existe
(`harness/control-plane/api-web/serveur-api.ts` pour les lectures,
`harness/control-plane/api-web/ecritures.ts` pour les ordres) et tourne sur le Pi.

Chemin complet d'un appel :

```
navigateur → /api/harness/…  (pi-web, FastAPI, porte la session)
           → harness_proxy.py (relais)
           → HARNESS_API_URL, 127.0.0.1:8722 par défaut (Bun)
```

`☠` Le serveur Bun n'a **aucune authentification propre** et REFUSE de démarrer sur `0.0.0.0`,
`::` ou `*` (échec bruyant, pas un avertissement). C'est `pi-web` qui porte le mot de passe et la
session : dupliquer l'authentification créerait deux vérités sur « qui a le droit », et la plus
permissive gagnerait en silence.

`☠` Côté navigateur, toutes les vues passent par `HarnessAPI` (`pi-web/static/harness-api.js`) —
jamais par `fetch` directement. C'est le seul endroit qui connaît la forme des routes.

`☠` Trois issues distinctes côté client, jamais confondues (`lireReel`) :
`{ pcOnline: true }` données fraîches · `{ pcOnline: false }` machine éteinte, normal ·
`{ erreur: … }` le control plane lui-même ne répond pas. Le relais répond **502** avec
`{ error: 'harness_injoignable', message }` quand le process Bun est mort — jamais un
`pcOnline: false` qui ferait chercher un problème sur le PC.

## Principe transversal — H-75 : le PC (donc le harness) peut être absent, ce n'est pas une erreur

Toute réponse de **lecture** passe par `enveloppe()` et distingue trois états, jamais une simple
erreur HTTP :

```json
{ "pcOnline": true,  "stale": false, "data": {...} }
{ "pcOnline": false, "stale": true,  "data": {...}, "message": "PC absent — dernières données connues, pas d'erreur." }
{ "pcOnline": false, "stale": true,  "data": null,  "message": "PC absent — dernières données connues, pas d'erreur." }
```

- `pcOnline: false` n'est **jamais** un code 4xx/5xx. C'est un état affichable normalement
  (H-75 : « le PC peut être absent des heures, c'est normal »).
- Les données du registre restent servies quand le PC est absent — elles sont persistées côté Pi —
  et sont alors marquées `stale: true`.
- Une vraie panne (le control plane lui-même échoue) reste une erreur HTTP normale, corps
  `{ "error": "…" }`.

`☠` **Les écritures ne portent PAS l'enveloppe.** Un POST rend un objet nu :
`{ ok: true, effet: "…" }`, éventuellement enrichi (`reply`, `inspection`, `conversation`,
`missionId`, `compacted`, `interrupted`, `machine`, `marquee(s)`). Ne pas y chercher `pcOnline` ni
`data` — `ecrireReel` laisse passer tout le corps tel quel.

`☠` **Toutes** les routes d'écriture non-conversation exigent un lien vers le PC : sans
`deps.pc`, `routerEcriture` répond **501** avant même de regarder le chemin — y compris pour
`/orchestrator/message` et `/safety/emergency-stop`. Les écritures de conversation, elles, sont
traitées AVANT ce garde : elles touchent la session du Pi et ne doivent pas dépendre du PC.

Codes d'erreur en usage : `400` requête invalide (message affichable tel quel), `404` introuvable
ou route inconnue, `409` conflit d'état ou règle métier connue, `501` capacité non câblée sur ce
déploiement, `500` panne réelle du control plane.

---

## Missions

### `GET /api/harness/missions` → `HarnessAPI.getMissions()`
Liste les missions récentes du parc (`registre.missions.listerRecentes()`).

`☠` La LISTE porte aussi ses `subagents` : sans eux, la carte du parc affiche « lead seul » sur une
équipe de cinq, et l'écart avec la vue détail passe pour un bug d'affichage. En revanche `feed` est
vide et `partial` est `null` — voir plus bas.

```ts
type Mission = {
  id: string;
  title: string;
  project: string;                 // nom du projet
  worktree: string;                // '' si non alloué
  branch: string;                  // '' si non alloué
  account: string;                 // identifiant de compte, PAS un 1|2
  machine: string | null;          // machine de travail (migration 22), null avant la V2
  git: { uncommitted: number; branch: string|null; lastCommit: string|null; at: number } | null;
  state: 'requires_action' | 'running' | 'idle' | 'paused' | 'echec' | 'terminee';
  ctx: number;                     // % contexte — mesuré, 0 si aucun relevé, jamais estimé
  ctxDetail: { nom: string; tokens: number; differe: boolean }[];
  ctxTokens: { utilises: number|null; max: number|null };
  cost: number;                    // $ consommés — une ESTIMATION client (H-68)
  team: string;                    // « lead seul » ou « lead + N sous-agents », COMPTÉ
  model: string;                   // résolu, sinon demandé, sinon '(non résolu)'
  epoch: number;                   // fencing D.2.3/M-11
  retries: string;                 // « 1 / 3 »
  sessionId: string | null;
  mandate: { but: string; critere: string };
  inspection: InspectionApi;       // voir « Inspection » plus bas
  blockedSince: string | null;     // un seul de ces quatre est renseigné à la fois
  pausedAgo: string | null;
  idleAgo: string | null;
  doneAgo: string | null;
  freshlyDispatched: boolean;      // toujours false — transitoire d'interface sans source
  ultracode: boolean;              // toujours false — idem
  subagents: Subagent[];
  feed: FeedEvent[];               // [] sur la LISTE, rempli sur le détail
  landing: null;                   // toujours null — H-70 pas encore réel côté Pi
  partial: { type: 'texte'|'reflexion'; contenu: string } | null;
}
```

`☠ HONNÊTETÉ DES CHAMPS` — `landing` n'a **aucune source réelle** côté Pi et reste `null`, jamais
fabriqué. Une donnée inventée qui a l'air vraie coûte plus cher qu'un champ vide.

`☠` `state` croise l'état HARNESS (la mission est-elle ouverte ?) et l'état SDK (le lead
travaille-t-il ?). Une mission `en_cours` dont le lead a fini son tour sort en `idle`, pas
`running` : constaté le 23/07, l'écran laissait attendre un résultat qui ne viendrait jamais sans
instruction. `attente_machine` ⇒ `requires_action`, `planifiee` ⇒ `idle`.

`☠` `ctxDetail` existe parce que le pourcentage seul ne permet pas de décider d'un atterrissage :
mesuré le 23/07, sur une mission à 10 %, ~24 K tokens sont du socle incompressible (prompt système,
outils, CLAUDE.md, skills) présent dès le premier token, et ~79 K du travail réel.

### `GET /api/harness/missions/{id}` → `HarnessAPI.getMission(id)`
Une mission avec `subagents`, `feed` complet et `partial`. `404` si l'id est inconnu, y compris PC
absent — le PC éteint ne doit jamais transformer « inconnue » en « peut-être plus tard ».

`☠` **Le bloc en cours de frappe du lead (`partial`)** — même forme que celui d'une conversation
orchestrateur, délibérément : l'écran l'affiche avec le même composant.
- `null` **toujours sur la liste** : le relevé traverse le lien vers la machine, et le faire pour
  chaque carte du parc ferait payer un écran de synthèse par toutes les équipes qui tournent.
- Il n'est renseigné que sur le détail d'UNE mission — celle qui est réellement regardée.
- `☠` **C'est CE GET qui déclare l'observation.** Rien d'autre ne fait tourner le relevé :
  `EtatPartielsMissions.demander()` rend l'état courant tenu en mémoire **tout de suite** et
  déclenche le relevé suivant en tâche de fond. Conséquence assumée : le premier affichage montre
  l'état d'avant, jamais celui de l'instant.
- `☠` Jamais en base, en mémoire seulement — un texte à moitié frappé, relu plus tard, se lit comme
  une pensée finie, et une écriture SQLite par sondage et par écran userait la carte SD.
- `☠` Péremption **10 s** : au-delà, le dernier relevé n'est plus servi. Sans elle, un PC qui se
  tait laisserait à l'écran un bloc figé que l'opérateur lirait comme une équipe au travail. Une
  mission que plus personne ne réclame est oubliée après 60 s.

### `GET /api/harness/missions/{id}/agents/{agentId}` → `HarnessAPI.getAgent(missionId, agentId)`

```ts
type Subagent = {
  id: string; name: string; role: string;
  status: 'actif' | 'termine';     // 'attente' n'est PAS produit : tout non-actif sort 'termine'
  action: string;                  // résumé humain, ou « aucune action lisible relevée »
  feed: FeedEvent[];                // [] dans la liste d'une mission, rempli sur cette route
  feedUnavailable: boolean;         // toujours présent, jamais optionnel
}
```

`name` est la **description du dispatch** (« Paragraphe sur la mer ») quand elle existe, pas un
identifiant hexadécimal : c'est ce que l'opérateur a demandé.

`☠` **H-72.4, mesuré** : le flux temps réel des sous-agents (`forwardSubagentText`) est
**non déterministe** — 0 à 4 lignes reçues sur 5 sous-agents lancés, y compris sur une session
saine, deux fois de suite. Conséquence tenue dans le code :
- La **source de vérité** sur « quels sous-agents existent » vient du transcript du store, **pas**
  du flux SDK seul.
- Un sous-agent connu dont rien n'a été relevé sort avec `feedUnavailable: true` et `feed: []` —
  **jamais omis**. L'écran doit montrer une équipe de cinq même quand il ne sait dire ce que font
  les cinq.

`☠` Route RÉELLE depuis le 23/07. Le client interrogeait jusque-là le jeu de DÉMO (`findAgent` sur
`db`) : cliquer sur un sous-agent réel rendait « Sous-agent introuvable » alors que la mission
l'affichait juste au-dessus.

```ts
type FeedEvent = {
  ts: string;                       // HH:MM:SS
  at: number;                       // le MÊME instant en ms epoch
  type: 'permission' | 'activity' | 'system' | 'instruction';
  nature?: 'reflexion' | 'outil';   // précision sur une 'activity'
  tool?: string;
  text: string;
  result?: string;                  // sortie de l'outil, tronquée à 6 000 caractères à la source
  resultError?: boolean;
  auto?: boolean;
  pending?: boolean;
  resolved?: string;
  path?: string;
}
```

`☠` `at` accompagne toujours `ts`, et le tri se fait dessus : `HH:MM:SS` seul donne un écart négatif
de ~24 h de part et d'autre de minuit — sur une équipe lancée le soir, le fil se lisait à l'envers.

`☠` `result` **absent** ≠ sortie vide : un appel sans sortie est un appel encore en vol, ou un
worker mort entre l'appel et sa réponse. L'interface distingue les deux, elle n'affiche jamais un
vide qui ressemblerait à « pas de sortie ».

`☠` **H-64** : toutes les autorisations (y compris auto-résolues par le lead) doivent apparaître
dans `feed` — c'est la trace d'audit, le volume est voulu. Source technique attendue : hook
`PreToolUse`, pas `canUseTool` seul (qui ne voit que l'étage d'invite et sous-compterait).
**Exigence non tenue à ce jour** : `construireFeed` ne lit que les transitions d'état
(`type: 'system'`) et les activités de la mission (`type: 'activity'`). Aucun producteur n'émet
`permission` ni `instruction` — voir « Écarts constatés ».

`☠` Le fil était rendu VIDE jusqu'au 23/07, par honnêteté, alors que deux sources persistées
existaient : une équipe pouvait travailler des minutes derrière un « 0 évènements ». Un vide qui a
l'air d'un fait est aussi trompeur qu'une donnée inventée, dans l'autre sens.

### `POST /api/harness/missions/{id}/instruction` → `HarnessAPI.sendMissionInstruction(id, text)`
Corps `{ text }`. Met un message en file pour la mission (H-67) — **ne l'interrompt pas**.
`400` sur texte vide, `501` si `envoyerInstruction` n'est pas câblé.
Réponse `{ ok: true, effet }`, où `effet` dit si l'instruction a été **retenue** (mission en pause)
plutôt que transmise. `☠` L'afficher n'est pas cosmétique : sinon l'opérateur attend une réaction
qui ne viendra qu'à la reprise.

### `POST /api/harness/missions/{id}/interrupt` → `HarnessAPI.interruptMission(id)`
`☠` **Coupe le TOUR du lead, jamais l'équipe** : la session reste vivante et garde tout son
contexte. C'est le geste qui manquait entre `pause` (qui retient la session) et `terminate` (qui la
tue) pour reprendre la main sur un lead parti de travers. La capacité existait depuis toujours côté
canal de contrôle et n'était offerte qu'à l'orchestrateur, par `interrompre_equipe`.
`501` si non câblé. Réponse : `{ ok: true, effet: 'tour interrompu — …' }`.

### `POST /api/harness/missions/{id}/pause` / `/resume` / `/terminate`
→ `HarnessAPI.pauseMission / resumeMission / terminateMission(id)`. Réponse `{ ok, effet }` — pas la
mission mise à jour. `501` sur `pause`/`resume` si le pilotage n'est pas câblé ; `terminate` ne
dépend que de `arreter`, toujours présent dans `OrdresVersPc`.
Pause individuelle ≠ pause globale (H-57) : ici la session reste vivante, contexte préservé.

### Inspection (H-68)

`POST /api/harness/missions/{id}/inspect` → `HarnessAPI.runInspection(id)` — déclenche une
inspection hors-palier. `POST /api/harness/missions/{id}/inspect/decision` avec
`{ decision: 'confirme' | 'decline' }` → `HarnessAPI.decideInspection(id, decision)`.
`501` si l'inspection n'est pas câblée, `409` + motif sur une erreur métier (équipe introuvable,
rien à arbitrer, inspection déjà tranchée).

```ts
type InspectionApi = {
  lastVerdict: 'progres' | 'incertain' | 'boucle' | null;
  lastAt: number | null;
  motif: string | null;
  decision: 'en_attente' | 'confirme' | 'decline' | null;
  attendArbitrage: boolean;         // dérivé côté serveur, pour que l'écran ne se trompe pas
  libelle: string | null;           // « boucle — décision attendue », etc.
}
```

`☠` **UNE seule conversion**, partagée par la lecture (`vue-missions.ts`) et par les routes
d'écriture (`ecritures.ts`). Elles avaient chacune la leur : la lecture rendait `lastVerdict`,
l'écriture rendait `verdict` — l'écran affichait « Juge d'inspection : undefined ». Le verdict était
juste, il se perdait entre deux noms.

`☠` Une inspection RÉPOND, elle ne coupe jamais d'elle-même. Un verdict `boucle` ouvre une
décision ; `decline` existe pour que « j'ai vu et je poursuis en connaissance de cause » ne soit pas
indistinguable de « je n'ai jamais regardé ».

`☠` Cette route était une MAQUETTE jusqu'au 31/07 : elle tapait dans `harness-mock-data.js` et
tirait son verdict avec `Math.random()`. Sur une vraie mission, `findMission` rendait `undefined` et
il ne se passait rigoureusement rien — un bouton qui n'a jamais rien inspecté, sans qu'aucune erreur
ne le signale.

---

## Escalades — RETIRÉ le 2026-07-31

Les routes `GET /api/harness/escalades` et `POST /api/harness/escalades/{id}/resolve` **n'existent
plus**, non plus que la vue correspondante.

Motif, mesuré et non supposé : le bus d'escalade était câblé de bout en bout — port distant côté PC,
canal bidirectionnel Pi↔PC, machine à états sur le Pi, outils MCP, routes, UI — et n'a jamais rien
porté. Son unique producteur possible était `canUseTool`, que le SDK **n'appelle jamais** en
`permissionMode: 'auto'` : le classifieur du lead tranche seul (H-40/H-64). Zéro demande depuis le
premier jour, donc une catégorie vide à l'écran qui affirmait une protection inexistante.

Ce qui protège réellement, et qui reste :
- le **plancher de déni** (H-41), inconditionnel, posé en `disallowedTools` à chaque dispatch ;
- l'**accès du mandat** (`lecture` | `ecriture`), qui refuse `Write`, `Edit`, `NotebookEdit` et
  `Bash` à une équipe en lecture seule — voir `harness/shared/acces-mandat.ts`.

Les deux refusent sans passer par aucun arbitre, humain ou non. L'audit `PreToolUse` reste en place :
il observe, il n'arbitre pas.

---

## Machines de travail (migration 22)

### `GET /api/harness/machines` → `HarnessAPI.getMachines()`
```ts
type Machine = { id: string; enLigne: boolean; supersedes: number }
```
`supersedes` = évictions observées sur CETTE machine ; doit rester à 0.
`☠` Aucune machine configurée ⇒ **liste vide**, jamais une machine fabriquée : c'est le cas des
bancs mono-machine, où l'interface doit ne proposer aucun choix plutôt qu'un choix inventé.

C'est aussi cette route qui alimente l'état de lien affiché : `harness-safety.js` la sonde toutes
les 10 s et pose `HarnessAPI._setPcOnline(liste.some(m => m.enLigne))`.

### `GET /api/harness/machines/metriques` → `HarnessAPI.getMachineMetrics()`
```ts
type MetriquesMachine = { id: string; enLigne: boolean; metriques: MetriquesHote | null }
```
`☠` `metriques: null` signifie « pas pu mesurer », **jamais** « tout à zéro ». Une machine éteinte
reste dans la liste avec `enLigne: false` : la retirer ferait disparaître de l'écran une machine sur
laquelle des missions vivent.

`☠` Route **séparée** de `/machines`, et traitée en asynchrone avant le routeur de lecture : ce
relevé fait un aller-retour par machine (jusqu'à Cloudflare pour le VPS), alors que `/machines` sert
le sélecteur de fil et doit rester instantané. Les fondre ferait payer une latence réseau à
l'ouverture d'une conversation.

---

## Comptes & quotas

### `GET /api/harness/accounts` → `HarnessAPI.getAccounts()`

```ts
type Account = {
  id: string; label: string; email: string;
  plan: string;                      // '' tant qu'aucune sonde n'a répondu
  status: string;                    // statut de la fenêtre 5 h, 'allowed' par défaut
  isUsingOverage: boolean;           // H-63.1 : rejected ne coupe pas la session, elle continue sur extra_usage
  five_hour: { util: number; resetLabel: string; resetAt: string | null };
  seven_day: { util: number; resetLabel: string; resetAt: string | null };
}
```

`resetLabel` est un délai relatif (« 3 h 30 », « 12 min », « expirée », « — »). `resetAt` est
l'heure exacte, `null` quand aucun reset n'est connu ou déjà passé — format 12 h, fuseau
`Europe/Paris`, avec le jour pour la fenêtre hebdomadaire (« lundi 28 juil. · 08:00 AM »).
`☠` Les deux servent, à des moments différents : « dans 3 h 30 » dit s'il faut attendre,
« 10:30 PM » dit s'il faut aller dormir.

`☠` Source réelle mesurée (H-54/H-63.1) : `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
pour les `util` (0-100) et `resets_at` ; l'événement poussé `rate_limit_event` (type à part, absent
des canaux `SDKInformationalMessage`/`SDKNotificationMessage`) pour `status`/`isUsingOverage` en
temps réel.

`☠` **UNITÉ DE LA COLONNE `reset_a` : MILLISECONDES epoch**, une seule convention, normalisée au
point d'écriture (`sonde-quotas.ts` convertit ISO ou secondes). La vue attendait des SECONDES
pendant que la sonde écrivait des millisecondes : l'écran a affiché « reset dans 495278229 h »
(constaté le 23/07). Deux unités dans une même colonne ne se rattrapent pas à la lecture.

`☠` `plan` est **mesuré, jamais supposé** : l'interface affichait « Max » en dur sur des comptes
réellement « Claude Pro » (23/07). Vide tant qu'aucune sonde n'a répondu.

`⚠` Les champs `*_dollars` sont `null` sur abonnement — ne jamais les utiliser, raisonner en `util`
(pourcentage) uniquement (H-70). Une jauge bâtie dessus afficherait 0 en permanence et laisserait
saturer le quota sans prévenir.

`☠` **`costWindow` n'est plus servi.** La mise en garde qui l'accompagnait reste valable le jour où
il reviendra : un coût agrégé par fenêtre doit être remis à zéro au franchissement de `resetsAt`,
**jamais** au redémarrage d'un process (H-63) — sinon la jauge ment sur la consommation réelle de
la fenêtre.

---

## Orchestrateur — conversations (fils multi-sessions)

`☠` Le gestionnaire de conversations est **opt-in** (`CCREMOTE_PI_ORCHESTRATEUR=1`). Absent, toutes
les routes `/orchestrator/conversations*` répondent **501** avec un message qui le nomme — jamais
une conversation fabriquée.

### `GET /api/harness/orchestrator/conversations` → `HarnessAPI.getConversations()`

```ts
type Conversation = {
  id: string; titre: string; creeA: number; majA: number;
  active: boolean;
  contextPct: number | null;
  compactions: number;
  model: string | null;              // dernier couple utilisé — ce sur quoi ROUVRIR
  effort: string | null;
  machine: string | null;            // null ⇒ fil antérieur au sélecteur, « non précisée »
  // fenêtre d'autonomie + plafond (voir ci-dessous)
  autonomieDebut: number | null;
  autonomieFin: number | null;
  autonomieObjectif: string | null;
  plafondAutonomie: string;
}
```

`☠` **Les quatre champs d'autonomie** (`autonomieDebut`, `autonomieFin`, `autonomieObjectif`,
`plafondAutonomie`) existaient en base et n'étaient resservis par **aucune** route. L'interface ne
pouvait donc pas savoir si une plage courait, et affirmait « aucune plage » sur une donnée que
personne n'avait lue — une affirmation fausse, et c'est la nuit qu'elle coûte le plus cher, quand
Chris dort en croyant avoir délégué.

`☠` Ces champs vivent dans le **registre**, pas dans le port des conversations. Ils sont lus en UNE
passe (`registre.conversations.lister()`) et joints par identifiant : un `lire()` par fil ferait
autant de requêtes que de conversations sur une route appelée à chaque fin de tour.

`☠` `plafondAutonomie` a **trois** états distincts, jamais deux : un entier en texte, `illimite`, ou
`herite` quand le fil ne règle rien et suit le défaut du parc. Confondre « non réglé » et
« illimité » afficherait un fil neuf comme délibérément affranchi. Même encodage
(`ecrireReglagePlafond`) que `plafondDemande` d'une rallonge — une seule version de la forme écrite.

`☠` `versConversationApi` prend l'autonomie en **paramètre obligatoire**, jamais en défaut
optionnel : un paramètre facultatif ferait servir en silence « aucune plage, plafond hérité » à
chaque appelant qui l'oublie, c'est-à-dire exactement l'affirmation fausse qu'on vient de corriger.

### `GET /api/harness/orchestrator/conversations/{id}` → `HarnessAPI.getConversation(id)`
Le détail d'un fil, tel que l'écran le lit à l'ouverture : tout ce qui précède, plus

```ts
{
  events: EvenementApi[];
  cursor: number;
  generating: boolean;
  fastMode: boolean | null;          // réglage du fil, null sur un fil vierge
  partial: { type: 'texte'|'reflexion'; contenu: string } | null;
}
```

`☠` Sans `model` / `effort` / `fastMode`, l'interface n'a rien pour rouvrir le fil sur son propre
réglage : elle retombait sur le défaut à chaque rafraîchissement (constaté en prod le 23/07, après
un premier correctif incomplet — le chemin de DONNÉES manquait, pas seulement l'affichage). Le
client distingue `null` de `false` (`if (d.fastMode !== null && d.fastMode !== undefined)`) : un
`if (d.fastMode)` perdrait un réglage volontairement coupé.

`☠` Le détail ne rend PAS `machine` (le port `detail()` ne le porte pas) — la liste, si.

### `GET /api/harness/orchestrator/conversations/{id}/events?since=<curseur>` → `HarnessAPI.getConversationEvents(id, since)`
Le streaming se fait par **sondage** de cette route, pas par WebSocket ni SSE.

```ts
{ events: EvenementApi[]; cursor: number; generating: boolean; active: boolean;
  contextPct: number | null; compactions: number;
  partial: { type: 'texte'|'reflexion'; contenu: string } | null }
```

`☠` `partial` est le bloc en cours de frappe — **c'est LUI qui fait le streaming visible**. Sans
lui, l'écran n'aurait que le tour fini. `null` = rien en cours ; ce n'est pas une erreur.

`☠` `/events` ne rend ni `model`/`effort` du fil, ni `fastMode` : ces réglages ne se lisent que sur
le détail. Un écran qui ne fait que sonder `/events` ne peut pas les restituer.

```ts
type EvenementApi = {
  seq: number;
  type: TypeEvenementConversation;   // 'operateur', 'texte', 'reflexion', 'outil'…
  contenu: string;
  at: number;
  model: string | null;              // porté PAR ÉVÈNEMENT
  effort: string | null;
  detail: string | null;             // appels d'outils : ce que l'appel a demandé
  resultat: string | null;           // …et ce qu'il a rendu
  pieces: { nom: string; type: string; taille: number; url: string }[];
}
```

`☠` `model`/`effort` sont portés **par évènement** : un fil où l'opérateur change de modèle en cours
de route doit rester lisible après coup — sans ça, impossible de savoir quelle réponse venait de
quel modèle.

`☠` `resultat: null` veut dire « pas encore revenu », **jamais** « vide ». Un outil présenté comme
ayant répondu du vide est un mensonge plus coûteux que l'absence d'information.

`☠` `pieces[].url` est une **URL servie par le control plane et relayée par pi-web**, jamais un
chemin de fichier — que le navigateur ne pourrait pas ouvrir et qui révélerait l'arborescence du Pi.

### `POST /api/harness/orchestrator/conversations` → `HarnessAPI.createConversation(titre, machine)`
Corps `{ titre?, machine? }`. Réponse `{ ok, effet, conversation }`.
`☠` La machine est **validée contre les machines réellement connues**, jamais prise telle quelle :
elle vient du navigateur, finit en clé de routage et en colonne SQL. Une valeur inconnue ferait un
fil irroutable, refusé seulement au premier mandat — bien trop tard pour être compris. `400` + la
liste des machines disponibles. Côté client, `machine` n'est envoyée que si elle a été réellement
choisie : une chaîne vide serait refusée.

### `POST /api/harness/orchestrator/conversations/{id}/message` → `HarnessAPI.sendConversationMessage(id, text, choix, pieces)`
Corps `{ text, model?, effort?, fastMode?, pieces? }`. Réponse `{ ok, effet }`.

`☠` **NE bloque PAS jusqu'à la réponse** : `envoyer` enfile puis rend la main, la réponse remonte
par le sondage de `/events`. Un POST bloquant jusqu'au `result` immobiliserait le relais et
Cloudflare le couperait. (Le relais `pi-web` accorde tout de même 130 s aux écritures, contre 5 s
aux lectures.)

`☠` `model` et `effort` étaient reçus ici puis **jetés** : l'interface proposait un réglage sans le
moindre effet, et la session tournait sur sa constante (corrigé le 23/07).

`☠` **`fastMode` : même panne, découverte le 07/08.** La case « mode rapide » existait à l'écran,
gérait son état et se grisait sur les modèles qui ne le déclarent pas — et n'était transmise **nulle
part**. Câblée bout en bout (migration 28, `applyFlagSettings`).

`☠` `fastMode` est lu en **booléen STRICT**, jamais par coercition : absent, il reste `undefined`,
c'est-à-dire « le fil garde son réglage ». Devenu `false`, il couperait le mode rapide à chaque
message qui n'en parle pas — y compris ceux que le harness enfile lui-même.

`☠` Le mode rapide n'est déclaré que par la famille Opus récente (`supportsFastMode`) — un seul
modèle du catalogue à ce jour. L'écran grise la case ailleurs.

### Pièces jointes d'un message (migration 24, 04/08)

Le même endpoint accepte `pieces: [{ nom, type, donneesBase64 }]` en plus de `text`. Types
acceptés : `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`,
`text/markdown`, `text/csv`, `application/json`. Plafonds : 6 fichiers, 10 Mo par fichier, 25 Mo par
message.

`☠` **Un `text` vide est valide s'il y a au moins une pièce** — coller une capture sans écrire un
mot est le geste normal du composeur.

`☠` **Aucune validation dans la route** : ni type, ni taille, ni contenu. C'est le domaine
`pieces-jointes` qui refuse, en un seul endroit, avec le message qui nomme les valeurs acceptées.
Dupliquer un bout de règle dans la route créerait deux vérités sur ce qui est accepté.

`☠` Le refus sort en **400 avec le message TEL QUEL** : il nomme les types acceptés et les
plafonds. Le remplacer par « requête invalide » obligerait l'opérateur à deviner ce qui vient d'être
refusé. Le contrôle côté navigateur n'est qu'un miroir, pour ne pas faire monter 20 Mo qui seront
refusés.

`☠` **L'orchestrateur ne reçoit pas l'image, il reçoit un chemin** (mesuré le 04/08 : son outil
`Read` rend le contenu visuel d'un PNG). Le fichier est écrit sous
`<cwd de l'orchestrateur>/pieces-jointes/<conversation>/`, et le message qui part au SDK porte le
chemin + la consigne de lecture. Un fichier sur disque survit à la compaction ; un bloc image dans
un contexte compacté, non.

### `GET /api/harness/orchestrator/conversations/{id}/pieces/{fichier}`
**Seule route non-JSON du control plane** : elle rend les octets avec leur `content-type` et
`cache-control: private, max-age=86400`. Elle est traitée **avant** le routeur JSON côté Bun, et
`pi-web` la déclare **avant** son relais générique — sinon `{chemin:path}` l'avale et un PNG passe
par `reponse.json()`, ce qui fait exploser le relais.
`400` sur toute traversée de chemin — refusée, jamais « nettoyée » ; `404` sur pièce inconnue ;
`501` si aucune racine n'est configurée (`CCREMOTE_PI_PIECES_JOINTES`).

### `POST /api/harness/orchestrator/conversations/{id}/interrompre` → `HarnessAPI.interruptConversation(id)`
Réponse `{ ok, effet, interrupted }`.
`☠` `interrupted: false` **n'est pas une erreur** : couper un fil qui ne génère rien est un
non-geste, pas une panne. L'interface a besoin du motif pour le dire, plutôt que d'afficher un échec
sur une conversation au repos.
`☠` Coupe le TOUR, pas la session ni le fil. Et un message déjà mis en file **n'est pas retiré** :
ce que Chris a écrit pendant la génération sera traité au tour suivant — couper la réponse en cours
ne doit pas le jeter.

### `POST /api/harness/orchestrator/conversations/{id}/compact` → `HarnessAPI.compactConversation(id)`
Réponse `{ ok, effet, compacted }`.
`☠` La compaction est faite **par le harness** (aucune API SDK ne l'expose) : résumé du fil, puis
session neuve amorcée dessus. `compacted: false` n'est pas une erreur — c'est « il n'y avait rien à
compacter », ou un tour en cours. On rend le motif tel quel plutôt qu'un faux succès.

### `POST /api/harness/orchestrator/conversations/{id}/rename` / `/archive`
→ `HarnessAPI.renameConversation(id, titre)` / `archiveConversation(id)`.
`400` sur titre vide, `404` si le fil est inconnu. Réponse `{ ok, effet }`.

### `POST /api/harness/orchestrator/conversations/{id}/machine` → `HarnessAPI.setConversationMachine(id, machine)`
Rattache un fil **après coup** à une machine. Corps `{ machine }`.
`☠` Sans cette route, un fil ouvert quand une seule machine était en ligne (donc sans machine
écrite) devenait irroutable dès que la seconde s'allumait : plus aucun mandat, plus aucune lecture
de projet, et aucun geste pour s'en sortir depuis l'interface (prod, 02/08, conversation
`af847b10`).
`☠` L'arbitrage du 01/08 tient ICI et nulle part ailleurs : rattacher un fil qui n'a pas de machine
est toujours permis ; **déplacer** un fil qui porte une équipe vivante ne l'est jamais — ses ordres
partiraient vers une machine qui n'héberge pas son worker. `400` + le nombre d'équipes vivantes.

### `POST /api/harness/orchestrator/conversations/{id}/autonomie` → `HarnessAPI.setAutonomie(id, start, end, goal)`
Corps `{ start, end, goal }` en ms epoch ; `start`/`end` à `null` = **retrait** de la plage.
`☠` Refus **AVANT écriture**, et message explicite : une fenêtre dont la fin précède le début serait
posée sans jamais s'ouvrir — l'opérateur croirait avoir délégué une plage et retrouverait son parc à
l'arrêt au matin. `400` : « la fin de la fenêtre doit suivre son début — sinon elle ne s'ouvre
jamais ».
`☠` La pose est partielle-ou-rien : si `start` ou `end` manque, les trois colonnes sont remises à
`null` (une plage à moitié posée n'existe pas).

### Rappels d'un fil (migration 16)

`GET /api/harness/orchestrator/conversations/{id}/rappels` → `HarnessAPI.getRappels(id)`
`POST /api/harness/orchestrator/conversations/{id}/rappels/{rappelId}/{pause|resume|delete}` →
`HarnessAPI.actionRappel(id, rappelId, action)`

```ts
type Rappel = {
  id: string; label: string; instruction: string;
  state: 'actif' | 'en_pause' | 'termine';
  nextAt: number | null;             // ms epoch absolu, null si terminé
  everyMinutes: number | null;       // null pour un rappel unique
  fired: number; maxFires: number | null; lastFiredAt: number | null;
  lastError: string | null;
}
```

`☠` Ces deux routes sont placées **avant** le sous-routeur des conversations : celui-ci commence par
`if (deps.conversations === undefined) return null` et rendrait donc 404 sur un déploiement sans
gestionnaire de conversations. Les rappels vivent dans le REGISTRE, pas dans une session — exactement
le piège déjà documenté pour les mandats, reproduit une seconde fois.

`☠` La lecture est **bornée au fil demandé** (`rappels.duFil(id, true)`) : même isolation que côté
MCP, portée par la requête et non par une vérification qu'un futur chemin pourrait contourner.

`☠` `nextAt` est un horodatage **absolu**, jamais un « dans X min » calculé côté serveur : le
serveur et le navigateur n'ont pas la même horloge, et un délai figé à l'instant de la réponse
vieillit dès qu'il s'affiche. Le front calcule le relatif au moment du rendu.

`☠` `instruction` porte la consigne **entière** : c'est ce que l'orchestrateur recevra mot pour mot.
Un libellé seul ne dit rien de ce qui sera réellement injecté.

`☠` La **création** et la **modification** de consigne n'ont volontairement pas de route : c'est
l'orchestrateur qui rédige, avec ses outils. L'écran donne la visibilité et le contrôle, pas la
plume.

`☠` Une action sans effet rend **409**, pas 200 : un « rien n'a changé » rendu comme un succès ferait
croire à Chris qu'il a coupé un rappel qui continue de tirer.

---

## Orchestrateur — mandats et rallonges

### `GET /api/harness/orchestrator/propositions` → `HarnessAPI.getPropositions()`
Mandats en attente d'autorisation humaine (H-61). Liste vide si `deps.mandats` est absent.

```ts
type Proposition = {
  id: string; projet: string; objectif: string;
  critereArret: string | null;
  perimetre: string;
  acces: string;                     // 'lecture' | 'ecriture'
  budgetMaxUsd: number;
  conversationId: string | null;
  statut: string;
  missionId: string | null;
  detail: string | null;
}
```

`☠` `acces` est remonté jusqu'à l'écran : H-61 veut une autorisation **éclairée**.

### `POST /api/harness/orchestrator/propositions/{id}/approve` → `HarnessAPI.approveMandat(id)`
`☠ H-61, non négociable` : **seul ce point crée une mission**, et il doit être déclenché par un clic
opérateur — jamais par l'orchestrateur lui-même, jamais par une récurrence programmée.
Réponse `{ ok, effet, missionId }`. `501` si l'autorisation n'est pas câblée.

`☠` L'approbation **dispatche réellement** : un échec remonte tel quel, jamais maquillé en succès —
l'opérateur croirait son équipe lancée. Quatre refus **métier** sortent en **409 + le motif exact**,
et non en 500 :
- « une équipe est déjà active sur ce projet » (H-56) — remontait en 500 « erreur interne du control
  plane » ; l'opérateur a cliqué trois fois sans jamais savoir pourquoi rien ne partait (prod,
  23/07) ;
- mandat **déjà tranché** entre l'affichage de la carte et le clic (prod, 01/08) — un geste arrivé
  trop tard, pas une panne ; le dire évite de faire douter d'une équipe qui tourne ;
- « ce projet n'est pas sur cette machine » et « cette machine est hors ligne » (prod, 01/08, banc
  multi-machines) — refus produits exprès **avant toute écriture**. Sortis en 500, ils envoyaient
  chercher une panne du control plane là où il n'y avait qu'un mandat mal adressé, et le message
  actionnable restait dans le journal du Pi. Le mécanisme du refus marchait ; sa TRANSMISSION
  n'existait pas.

### `POST /api/harness/orchestrator/propositions/{id}/reject` → `HarnessAPI.rejectMandat(id)`
Aucun effet secondaire. `409` si déjà tranché ou inconnu.

### Rallonges du plafond d'autonomie (migration 27)

### `GET /api/harness/orchestrator/rallonges` → `HarnessAPI.getRallonges()`

```ts
type Rallonge = {
  id: string;
  conversationId: string;
  plafondDemande: string;            // entier en texte, ou 'illimite'
  motif: string;
  statut: string;
  detail: string | null;
  creeA: number;
}
```

### `POST /api/harness/orchestrator/rallonges/{id}/approve` / `/reject`
→ `HarnessAPI.approveRallonge(id)` / `rejectRallonge(id)`. `501` si la décision n'est pas câblée,
`409` si la demande est déjà tranchée ou inconnue.

`☠` **Accorder une rallonge n'est PAS approuver un mandat.** Ça n'ouvre aucun worker : ça applique
au fil demandeur un réglage déjà décrit (`registre.conversations.reglerPlafondAutonomie`). Les deux
circuits restent séparés pour qu'un geste ne soit jamais pris pour l'autre — même mot
(« approuver »), deux conséquences sans rapport.

`☠` Le serveur servait ces trois routes depuis leur écriture et **aucune méthode cliente ne les
appelait** : une demande posée par l'orchestrateur n'était montrée nulle part et restait en attente
indéfiniment, pendant qu'il croyait avoir sollicité une décision. Câblé le 08/08, le jour où l'outil
`demander_rallonge_autonomie` est entré dans son mandat.

`☠` Ces routes sont placées **avant** le filtre `/orchestrator/conversations`, comme les mandats :
placées après, elles ne seraient jamais atteintes (404 « route inconnue »).

---

## Orchestrateur — divers

### `GET /api/harness/modeles` → `HarnessAPI.getModels()`

```ts
type ModelOption = {
  id: string;                        // identifiant canonique passé au CLI
  label: string;
  alias: string | null;              // 'opus', 'sonnet', 'fable', 'haiku'
  enabled: boolean;                  // TOUJOURS true — la disponibilité réelle dépend de l'abonnement
  effort: string[];                  // [] si le modèle refuse le paramètre (cas de Haiku)
  effortDefaut: string | null;
  fastMode: boolean;                 // supportsFastMode
  note: string;
}
```

`☠` Le sélecteur lisait encore la MAQUETTE jusqu'au 31/07 : les modèles proposés à l'écran n'avaient
aucun rapport avec ce que le CLI accepte, et les niveaux de raisonnement étaient les mêmes pour tous
— alors que Haiku n'en accepte AUCUN et que `xhigh` n'existe pas avant Opus 4.7.

`☠ CE CATALOGUE EST UN REPLI, PAS LA SOURCE D'AUTORITÉ.` La route sert `shared/modeles-claude.ts`,
une constante. La vraie liste est `supportedModels()` du SDK (`supportedEffortLevels`,
`supportsFastMode`, `supportsAdaptiveThinking`) pour le compte réellement connecté, et il faut une
session vivante pour l'interroger. Le repli est **aligné sur la mesure du 31/07** (banc
`acceptation/modeles-effort-reel.ts`, SDK 0.3.220 / CLI 2.1.220).

`☠` La liste dépend de la version du CLI **embarquée par le SDK**, pas du compte ni de
l'abonnement : sous le SDK 0.3.217, `supportedModels()` rendait `claude-opus-4-8` et ignorait
`claude-opus-5` — sur les deux comptes, à l'identique. Monter le SDK a fait apparaître Opus 5 et
disparaître Opus 4.8. Toute mise à jour du SDK doit être suivie d'un passage du banc et de la mise à
jour du repli.

`☠` Un modèle absent de `supportedModels()` produit une option qui **échoue au dispatch**, et un
niveau d'effort invalide est ignoré **en silence** par le SDK — jamais rejeté.

`☠` Le client retombe sur `harness-mock-data.js` si le Pi est injoignable, pour ne pas afficher un
sélecteur vide qui empêcherait tout choix. Ce repli sert des identifiants périmés — voir « Écarts ».

### `GET /api/harness/orchestrator/gauges` → `HarnessAPI.getOrchestratorGauges()`
```ts
{ contextPct: number | null; active: boolean }
```
`☠` Le contexte vient de la **vraie sentinelle** de la session orchestrateur. `null` (orchestrateur
inactif ou pas encore de mesure) ⇒ `contextPct: null`, jamais un chiffre inventé — l'ancienne UI
affichait « 23 % » codé en dur, ce qui mentait.

### `POST /api/harness/orchestrator/message` → `HarnessAPI.sendOrchestratorMessage(text, options)`
Session orchestrateur **maître unique**, antérieure aux fils. Corps `{ text }` — le client envoie
aussi `model` et `effort`, que le serveur **ignore**. Réponse `{ ok, effet, reply }`.
`501` si la session maître n'est pas active, et `501` également si aucun lien PC n'est configuré
(garde de `routerEcriture`, en amont).
Aucune vue n'appelle cette route aujourd'hui — voir « Écarts ».

---

## Notifications (migration 14)

### `GET /api/harness/notifications` → `HarnessAPI.getNotifications()`
```ts
{ notifications: NotificationApi[]; unread: number }

type NotificationApi = {
  id: string; type: string; title: string; body: string;
  missionId: string | null;
  conversationId: string | null;     // null ⇒ carte non cliquable
  createdAt: number;
  read: boolean;                     // Chris a lu
  delivered: boolean;                // l'orchestrateur a reçu
  deliveryError: string | null;
}
```

`☠` `read` et `delivered` sont exposés **séparément**, et ce n'est pas de la redondance : « Chris a
lu » et « l'orchestrateur a reçu » sont deux faits indépendants. La nuit, le second arrive sans le
premier ; en session, l'inverse est courant. Les fondre effacerait précisément ce que Chris regarde
pour savoir si son orchestrateur est au courant de ce qu'il vient de lire.

`☠` `unread` est rendu par le serveur : le badge ne doit **pas** se déduire de la longueur de la
liste, plafonnée côté serveur, qui mentirait au-delà.

`☠` `conversationId` est ce qui fait du clic une redirection vers le BON fil. Sans lui, l'interface
n'aurait qu'un texte à afficher et Chris devrait retrouver la conversation lui-même — la moitié de
l'intérêt de la fonctionnalité.

### `POST /api/harness/notifications/{id}/read` et `POST /api/harness/notifications/read-all`
→ `HarnessAPI.markNotificationRead(id)` / `markAllNotificationsRead()`.
`☠` Déjà lue ⇒ **succès**, pas une erreur : deux onglets ouverts sur la même notification
produiraient sinon une alerte pour un non-événement. Réponse `{ ok, effet, marquee }` ou
`{ ok, effet, marquees }`.

`☠` Placées **avant** le filtre `/orchestrator/conversations` : elles ne touchent pas le PC et ne
doivent pas dépendre de son état.

---

## Sûreté (H-57) — jamais par l'orchestrateur

### `POST /api/harness/safety/emergency-stop` → `HarnessAPI.emergencyStop()`
ARRÊT D'URGENCE (G.4). Réponse `{ ok, effet }`. `501` si `arretUrgence` n'est pas câblé ou si aucun
lien PC n'est configuré.

`☠` Cette route ne doit **jamais** transiter par la session de l'orchestrateur maître — chemin
direct UI → control plane → superviseur (H-57 ☠). Si l'orchestrateur déraille, c'est précisément le
moment où elle doit encore fonctionner.

`☠` Si le lien Pi↔PC est coupé, l'ordre **n'atteint pas les workers**. L'UI grise déjà les boutons
dans ce cas (`harness-safety.js`, classe `.link-down`, alimentée par le sondage de `/machines`) :
elle ne doit jamais prétendre qu'un clic a eu un effet qu'il n'a pas eu.

### `POST /api/harness/safety/pause` / `/resume` — N'EXISTENT PAS
Aucune route serveur, et les méthodes clientes `pauseGlobal` / `resumeGlobal` ont été **supprimées
le 01/08**. Elles n'ont jamais rien mis en pause : elles marquaient un champ sur la base de
démonstration. Seule la pause **par mission** (`/missions/{id}/pause`) est réelle, et elle l'a
toujours été.

La mise en garde qui accompagnait la pause globale reste vraie le jour où elle sera écrite : sessions
vivantes, contexte intégralement préservé, reprise instantanée — et elle **ne tue pas** les process
enfants lancés par les agents (serveurs de dev, builds). L'UI devra le dire, pas le laisser croire.

---

## `GET /api/harness/health`
`{ ok: true, pcOnline: boolean }` — **sans enveloppe**, seule route de lecture dans ce cas. Sert à
distinguer « le lien vers le PC est bas » de « le serveur du Pi est mort » : les deux sont distincts
et l'interface doit pouvoir dire lequel manque. Non appelée par les vues aujourd'hui — c'est
`/machines` qui joue ce rôle.

---

## Écarts constatés le 08/08 — servis, appelés, documentés

Relevé par lecture des sources, pas corrigé : ce document décrit, il n'arbitre pas.

### Routes servies que le client n'appelle jamais
- `POST /orchestrator/message` — la méthode `HarnessAPI.sendOrchestratorMessage` existe, **aucune
  vue ne l'appelle**. Vestige de la session maître unique, remplacée par les fils.
- `GET /orchestrator/gauges` — `HarnessAPI.getOrchestratorGauges` existe, aucune vue ne l'appelle.
- `GET /health` — `HarnessAPI.getLinkStatus` existe, aucune vue ne l'appelle ; l'état du lien vient
  du sondage de `/machines` toutes les 10 s.

### Champs et routes documentés qui n'existent plus
- `Account.costWindow` — supprimé de `vue-comptes.ts`. La mise en garde sur sa remise à zéro est
  conservée ci-dessus, explicitement rattachée à un champ **non servi aujourd'hui**.
- `orchestrator/gauges.windowResetLabel` et `.costWindow` — absents ; le client les remplit à `null`
  côté navigateur.
- `Mission.landing` — la forme documentée (`{ active, sinceLabel, … }`) n'est jamais produite : le
  champ vaut `null` en dur.
- `Mission.inspection` — la forme documentée (`{ lastVerdict, lastAt }`) est incomplète : la vraie
  porte aussi `motif`, `decision`, `attendArbitrage`, `libelle`.
- `Mission.account` — documenté `1 | 2`, servi en `string`.
- `ModelOption.ultracode` — n'existe plus dans la réponse de `/modeles`.
- `GET /api/harness/models` — le vrai chemin est `/api/harness/modeles`.
- `POST /orchestrator/compact` — n'existe pas ; la compaction est **par fil**
  (`/orchestrator/conversations/{id}/compact`).
- `POST /orchestrator/propose-mandate`, `/orchestrator/proposals/{id}/approve|reject` — n'existent
  pas ; le vrai chemin est `/orchestrator/propositions/{id}/approve|reject`, et la proposition est
  créée par l'orchestrateur via ses outils, pas par une route HTTP. Les méthodes clientes
  `proposeMandate` / `approveProposal` / `rejectProposal` ont été supprimées le 01/08 avec le
  formulaire de mandat manuel : elles écrivaient dans la base de démonstration.
- `POST /safety/pause` et `/safety/resume` — supprimées des deux côtés le 01/08 (section ci-dessus).

### Divergences entre deux définitions du même concept
- **`FeedEvent.type` déclare `permission` et `instruction` ; aucun producteur ne les émet.**
  `construireFeed` ne lit que `registre.etats.historique()` (⇒ `system`) et
  `registre.missions.activites()` (⇒ `activity`). L'en-tête de `vue-feed.ts` et celui de
  `vue-missions.ts` annoncent pourtant « les demandes de permission du bus » comme seconde source.
  Conséquence : l'exigence H-64 (« toute autorisation, y compris auto-résolue, apparaît dans le
  fil ») **n'est pas tenue à ce jour**, et les champs `auto`/`pending`/`resolved`/`path` du type
  n'ont aucun émetteur.
- **`Subagent.status` déclare `'attente'` ; il n'est jamais produit** — `versSubagentApi` fait
  `a.statut === 'actif' ? 'actif' : 'termine'`.
- **`fastMode` n'est lisible que sur le détail d'un fil.** Ni la liste des conversations ni
  `/events` ne le portent : un écran qui n'appelle que ces deux routes ne peut pas restituer le
  réglage. `model`/`effort`, eux, sont sur la liste **et** sur le détail. `machine`, à l'inverse,
  est sur la liste mais **pas** sur le détail.
- **`ultracode` n'est transmis à aucune route.** Le client tient l'état (`HarnessState.orchModel`,
  case à cocher, texte d'aide « portée session seulement »), mais ni
  `/orchestrator/conversations/{id}/message` ni `/orchestrator/message` ne le lisent. Le champ
  `MissionApi.ultracode` vaut `false` en dur. Le réglage n'a donc **aucun effet** aujourd'hui.
- **`MissionApi.freshlyDispatched`** vaut `false` en dur, comme `ultracode` : transitoires
  d'interface sans source côté serveur.
- **`POST /orchestrator/conversations/{id}/autonomie` ne vérifie pas que le fil existe.**
  `poserFenetreAutonomie` fait un `UPDATE … WHERE id = ?` : sur un identifiant inconnu, zéro ligne
  touchée et la route rend quand même `{ ok: true, effet: 'autonomie déléguée … ' }`. Toutes les
  autres routes de fil rendent `404` dans ce cas.
- **Le catalogue de repli du client est périmé.** `harness-mock-data.js` propose `claude-opus-4-8`
  (absent de `MODELES` depuis le passage au SDK 0.3.220) et `claude-sonnet-4-6`, et
  `harness-state.js` initialise `orchModel.model` à `'claude-opus-4-8'`. Si `/modeles` échoue, le
  sélecteur sert des identifiants qui échoueraient au dispatch.
- **L'en-tête de `harness-api.js` est daté du 22/07 et se contredit lui-même.** Il annonce
  l'orchestrateur (conversation, mandats, jauges) comme « DÉMO » alors que les trois sont réels, et
  affirme que `subagents`, `feed`, `inspection` et `landing` « reviennent vides du serveur réel » —
  seul `landing` l'est encore.
- **`_setPcOnline` / `_isPcOnline` ne sont plus « démo uniquement ».** Ils sont marqués comme tels
  dans le code, mais `harness-safety.js` les alimente depuis le sondage réel de `/machines`, et
  `harness-mission.js` / `harness-mission-sheets.js` / `harness-state.js` s'en servent pour décider
  d'afficher la bannière « PC absent ». Le bouton « Simuler une absence de PC » écrit dans la même
  variable. Seuls `simulateSaturation` / `simulateReset` / `simulateLanding` restent purement
  démonstratifs (appelés par `harness-comptes.js`).

---

## Ce qui reste en données de démonstration

`pi-web/static/harness-mock-data.js` sert encore de repli au sélecteur de modèles et de source aux
trois simulateurs de compte/atterrissage (`simulateSaturation`, `simulateReset`, `simulateLanding`,
panneau Paramètres). Les missions et comptes de démonstration ne sont plus lus par aucune vue :
tout passe par le control plane.

## Ce qui n'est toujours pas couvert

- **Atterrissage H-70** : `Mission.landing` reste `null`, aucune source côté Pi. Le bouton
  « Simuler un atterrissage » par mission contredit H-70 (« la décision appartient au superviseur
  qui voit tout le compte, jamais au lead/à la mission isolément ») — gardé pour la testabilité,
  à retirer si le comportement devient réel.
- **Streaming poussé** : il n'existe pas. Le fil d'une conversation est **sondé**
  (`/events?since=`), celui d'une mission aussi (`GET /missions/{id}`). Aucun WebSocket ni SSE côté
  harness — le serveur Bun est typé `Server<never>` et ne fait aucun upgrade ; le seul lien du Pi
  est celui vers le PC.
- **`pending_user_dialog_requests`** (sibling de `pending_permission_requests`, H-73) : aucune route
  ni aucun champ ne le couvre.
- **Notifications Web Push / PWA** (H-59) : hors périmètre, le canal de notification actuel est
  interne (`GET /notifications`).
- **Ordres de grandeur en tokens par niveau d'effort** : mesurés pour un seul modèle (714/107/141),
  pas pour les autres. Ne pas les généraliser.

---

## ☠ RÈGLE ABSOLUE — mise à jour automatique de l'interface

**Un rafraîchissement automatique ne recharge JAMAIS le DOM complet.** Jamais de
`innerHTML = ...` sur un conteneur entier dans une boucle périodique.

Cette règle n'est pas une préférence de style : réassigner `innerHTML` détruit et
recrée tous les nœuds enfants. Invisible sur un clic, très visible sur une boucle
de quelques secondes. Les conséquences constatées en réel (23/07) :

- **clignotement** de toute la zone à chaque tick ;
- **saisie perdue** — le texte en cours de frappe dans un champ est effacé ;
- **blocs dépliés refermés** (`<details>`, réflexions du lead) ;
- **sélection de texte annulée** — impossible de copier quoi que ce soit ;
- **défilement rejeté en bas** alors que l'opérateur lisait plus haut.

### Ce qu'il faut faire à la place

1. **Comparer avant d'écrire.** Une empreinte des champs qui bougent
   (`hEmpreinteMission`) décide s'il y a lieu de toucher au DOM. Rien n'a changé
   ⇒ rien n'est touché.
2. **Ne remplacer que les enfants qui ont changé.** `hPatcher(cible, html)`
   (`harness-patch.js`) compare enfant par enfant via `data-k`, remplace les seuls
   nœuds dont le rendu diffère et leur retire les classes d'entrée — un contenu
   qui se met à jour n'est pas un contenu qui apparaît. `☠` Le garde
   `if (innerHTML !== html)` ne suffit PAS : il suffit qu'un « il y a 3 min »
   devienne « il y a 4 min » sur UNE carte pour que la page entière clignote.
   `hEcrireSiDifferent` est le nom historique du même appel.
3. **Ajouter, ne pas réécrire** pour les listes qui grossissent : le fil d'une
   mission est rendu par segments ancrés `[data-seg]` porteurs d'une signature
   (`hMajSegments`). Un segment dont la signature n'a pas bougé n'est **pas
   touché** — c'est ce qui lui laisse son état déplié ; seuls les segments
   modifiés sont remplacés (en reprenant leurs ouvertures) et les neufs ajoutés.
   Le passé n'est jamais reconstruit.
4. **Replier proprement quand la séquence change.** Une carte qui apparaît,
   disparaît ou change de section fait basculer `hPatcher` sur un
   `replaceChildren` complet — réordonner en place détacherait des nœuds et
   rejouerait leurs animations, le défaut même qu'on corrige. Ce repli dépose lui
   aussi des nœuds sans classe d'entrée.
5. **Respecter la position de lecture.** Ne rattraper le bas que si l'utilisateur
   y était déjà (marge ~60 px), jamais de force.
6. **Une seule minuterie, liée à la vue visible**, suspendue quand l'onglet est
   masqué (`document.hidden`) et jamais réentrante (garde `hVueEnCours`).

Un rendu complet reste légitime **sur action de l'utilisateur** : changement de
mission, changement de filtre, premier affichage. Jamais en boucle.

`☠` Le **bloc en cours de frappe** (`partial`) est le cas limite de cette règle : il vit hors des
segments `[data-seg]` mais dans le même conteneur, et il doit être traité **après** le retrait du
surplus — placé plus haut, il serait balayé dès que le fil raccourcit. Son mouvement compte dans le
« quelque chose a changé » : sans ça, une réflexion qui s'allonge ne fait pas suivre le défilement
et le texte pousse sous le bord de l'écran pendant qu'on le lit.

Implémentation de référence : `static/harness-patch.js` (`hPatcher`),
`static/harness-parc.js` (boucle + parc, garde `hVueEnCours`),
`static/harness-mission.js` (`hEmpreinteMission`, `hMajSegments`),
`static/harness-mission-feed.js` (`hMajPartielMission`) et
`static/harness-orchestrateur.js` (`hRenderPartiel`).
