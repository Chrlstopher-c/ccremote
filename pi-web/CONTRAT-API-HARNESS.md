# Contrat API — harness (orchestrateur + équipes)

Ce document est la spécification que le back-end du harness doit honorer pour remplacer
`pi-web/static/harness-mock-data.js` et `pi-web/static/harness-api.js` sans qu'aucune vue
n'ait à changer. Toutes les vues du harness passent par `HarnessAPI` — jamais par `fetch`
directement (voir `harness-api.js`, en tête de fichier).

Convention proposée : les endpoints réels vivraient sous `pi-web/app.py`, préfixés
`/api/harness/...`, relayés en interne vers le harness (Bun) comme le fait déjà
`ws_cmd()` vers `server.py` pour le PC. Chaque fonction ci-dessous correspond à un endpoint.

## Principe transversal — H-75 : le PC (donc le harness) peut être absent, ce n'est pas une erreur

Toute réponse doit distinguer trois états, jamais une simple erreur HTTP :

```json
{ "pcOnline": true,  "stale": false, "data": {...} }
{ "pcOnline": false, "stale": true,  "data": null, "message": "PC absent — dernières données connues, pas d'erreur." }
```

- `pcOnline: false` n'est **jamais** un code 4xx/5xx. C'est un état affichable normalement
  (H-75 : « le PC peut être absent des heures, c'est normal »).
- Quand `pcOnline` est `false`, l'UI doit recevoir soit `data: null` (rien de connu), soit les
  **dernières données connues** avec `stale: true` — au choix de l'implémentation, mais le champ
  `stale` doit toujours refléter la réalité.
- Une vraie panne (le harness lui-même plante, pas le PC absent) reste une erreur HTTP normale —
  à ne pas confondre avec l'absence du PC.

---

## Missions

### `GET /api/harness/missions` → `HarnessAPI.getMissions()`
Retourne la liste complète des missions du parc (tous projets, tous états).

```ts
type Mission = {
  id: string;                    // identifiant stable, ex. "m1"
  title: string;
  project: string;                // nom du projet (dossier /mnt/projects/<project>)
  worktree: string;                // chemin relatif du worktree
  branch: string;
  account: 1 | 2;                  // compte Claude Code utilisé (registre E.1.3)
  state: 'requires_action' | 'running' | 'idle' | 'paused' | 'echec' | 'terminee';
  ctx: number;                     // % contexte utilisé — getContextUsage(), mesuré jamais estimé
  cost: number;                    // $ consommés — total_cost_usd, une ESTIMATION client (H-68)
  inspection: { lastVerdict: 'progres'|'incertain'|'boucle'|null; lastAt: string|null };
  team: string;                    // libellé court, ex. "lead + 2 sous-agents"
  model: string;                   // modèle réellement résolu (pas demandé)
  epoch: number;                   // fencing D.2.3/M-11
  retries: string;                 // ex. "1 / 3"
  sessionId: string;
  blockedSince?: string;           // si requires_action
  pausedAgo?: string;               // si paused
  idleAgo?: string;                 // si idle
  doneAgo?: string;                 // si terminee
  landing: { active: boolean; sinceLabel: string; account: number; resetLabel: string; step: 0|1 } | null;
  mandate: { but: string; critere: string };
  subagents: Subagent[];
  feed: FeedEvent[];
}
```

### `GET /api/harness/missions/{id}` → `HarnessAPI.getMission(id)`
Une mission avec `subagents` et `feed` complets. `data: null` si id inconnu (et `pcOnline: true`).

### `GET /api/harness/missions/{id}/agents/{agentId}` → `HarnessAPI.getAgent(missionId, agentId)`

```ts
type Subagent = {
  id: string; name: string; role: string;
  status: 'actif' | 'attente' | 'termine';
  action: string;                  // résumé humain de ce qu'il fait, jamais son contexte brut
  feed: FeedEvent[];                // best-effort — voir H-72.4 ci-dessous
  feedUnavailable?: boolean;        // true si le flux temps réel n'a rien livré pour cet agent
}
```

`☠` **H-72.4, mesuré** : le flux temps réel des sous-agents (`forwardSubagentText`) est
**non déterministe** — 0 à 4 lignes reçues sur 5 sous-agents lancés, y compris sur une session
saine, deux fois de suite. Conséquence ferme pour cette route :
- La **source de vérité** sur « quels sous-agents existent » doit venir du transcript du store
  (`SessionStore.listSubkeys()`, H-72.3), **pas** du flux SDK seul.
- Un sous-agent connu mais dont le flux n'a rien livré doit être renvoyé avec
  `feedUnavailable: true` et `feed: []` — **jamais omis**. L'UI l'affiche sans détail plutôt que
  de l'oublier (voir `harness-agent.js`).

```ts
type FeedEvent = {
  ts: string;                       // HH:MM:SS
  type: 'permission' | 'activity' | 'system' | 'instruction';
  tool?: string;
  text: string;
  auto?: boolean;                    // permission résolue seule par le lead (H-64)
  pending?: boolean;                 // permission en attente d'arbitrage opérateur
  resolved?: string;                 // 'autorisée (opérateur)' | 'refusée (opérateur)'
  path?: string;                     // chemin concerné, pour les permissions sensibles
}
```

`☠` **H-64** : toutes les autorisations (y compris auto-résolues par le lead) doivent apparaître
dans `feed`, pas seulement les demandes remontées. C'est la trace d'audit — le volume est voulu.
Source technique attendue côté harness : hook `PreToolUse`, pas `canUseTool` seul (qui ne voit que
l'étage d'invite et sous-compterait — H-64).

### `POST /api/harness/missions/{id}/instruction` → `HarnessAPI.sendMissionInstruction(id, text)`
Met un message en file pour la mission (H-67) — **ne l'interrompt pas**. Distinct de `interrupt()`.
Réponse : `{ queued: true }`. Si `pcOnline: false`, le message doit être mis en file **côté Pi**
(persisté) et livré à la reconnexion, jamais silencieusement perdu.

### `POST /api/harness/missions/{id}/pause` / `/resume` / `/terminate`
→ `HarnessAPI.pauseMission/resumeMission/terminateMission(id)`. Retourne la mission mise à jour.
Pause individuelle ≠ pause globale (H-57) : ici la session reste vivante, contexte préservé.

### `POST /api/harness/missions/{id}/inspect` → `HarnessAPI.runInspection(id)`
Déclenche une inspection Haiku hors-palier (H-68). Retourne la mission avec `inspection` à jour.
Verdict `boucle` ⇒ `state` bascule à `echec`, worktree conservé. `incertain` ne coupe jamais.

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

## Comptes & quotas

### `GET /api/harness/accounts` → `HarnessAPI.getAccounts()`

```ts
type Account = {
  id: 1 | 2; label: string; email: string;
  status: 'allowed' | 'rejected';
  isUsingOverage: boolean;            // H-63.1 : rejected ne coupe pas la session, elle continue sur extra_usage
  five_hour: { util: number; resetLabel: string };   // 0-100, fenêtre active (H-63)
  seven_day: { util: number; resetLabel: string };
  costWindow: number;                  // $ agrégés, par COMPTE, depuis le début de la fenêtre 5h (H-63)
}
```

`☠` Source réelle mesurée (H-54/H-63.1) : `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
pour les `util` (0-100) et `resets_at` ; l'événement poussé `rate_limit_event` (type à part, absent
des canaux `SDKInformationalMessage`/`SDKNotificationMessage`) pour `status`/`isUsingOverage` en
temps réel. `resetsAt`/`overageResetsAt` sont des **secondes Unix**.

`☠` `costWindow` doit être remis à zéro au franchissement de `resetsAt`, **jamais** au redémarrage
d'un process (H-63) — sinon la jauge ment sur la consommation réelle de la fenêtre.

`⚠` Les champs `*_dollars` sont `null` sur abonnement — ne jamais les utiliser, raisonner en `util`
(pourcentage) uniquement (H-70).

---

## Orchestrateur

### `GET /api/harness/orchestrator/gauges` → `HarnessAPI.getOrchestratorGauges()`
```ts
{ contextPct: number; windowResetLabel: string; costWindow: number }
```
`contextPct` vient de `getContextUsage()` — **mesuré, jamais estimé** (H-63).

### `POST /api/harness/orchestrator/compact` → `HarnessAPI.compactOrchestratorContext()`
Compaction manuelle (disponible mais jamais nécessaire — l'orchestrateur doit s'autogérer, H-62).

### `GET /api/harness/models` → `HarnessAPI.getModels()`
`☠` **Doit venir de `supportedModels()[].supportedEffortLevels` en temps réel — jamais une
constante figée côté serveur non plus.** Identité par `value` (+ `resolvedModel`), jamais par
`model` (H-71.1, piège mesuré : lire par `model` rend un tableau de `undefined` sans lever).

```ts
type ModelOption = {
  id: string; label: string;
  effort: string[];        // [] si le modèle ne supporte aucun raisonnement réglable (ex. Haiku)
  enabled: boolean;         // false = affiché griséé pour transparence (ex. sonnet-4-6), jamais masqué
  fastMode: boolean;        // supportsFastMode — vrai uniquement pour opus-4-8 à ce jour (mesuré)
  ultracode: boolean;       // capable de xhigh ⇒ éligible à ultracode (Settings), PAS un 6e niveau d'effort
}
```
`☠` Haiku exclu du rôle d'orchestrateur (H-71/H-71.1, mesuré : ni `supportsEffort` ni
`supportsAdaptiveThinking`). `☠` Un modèle qui répond mais est **absent** de `supportedModels()`
(ex. `claude-opus-4-7` au moment de la mesure) doit être **retiré de la liste**, jamais grisé — un
niveau d'effort qui lui serait prêté serait silencieusement ignoré par le SDK (H-71.1).

### `POST /api/harness/orchestrator/message` → `HarnessAPI.sendOrchestratorMessage(text, options)`
`options: { model, effort, fastMode, ultracode }`. Réponse : `{ reply: string }` (texte seul pour
la démo — en réel, streaming SSE probable, sur le même modèle que `/api/agent/chat` existant).
`☠` `ultracode` a une portée **session uniquement** — jamais persisté, à réinitialiser à chaque
rechargement/reconnexion (H-71.1).

### `POST /api/harness/orchestrator/propose-mandate` → `HarnessAPI.proposeMandate(fields)`
`☠ H-61, non négociable` : cet endpoint **ne crée jamais d'équipe**. Il retourne
`{ id, ...fields, status: 'pending' }` — une proposition, `effet: 'differe'` au sens de A.2.2.
La création réelle passe uniquement par :

### `POST /api/harness/orchestrator/proposals/{id}/approve` → `HarnessAPI.approveProposal(id)`
Seul ce point crée une mission. Doit être **explicitement déclenché par un clic opérateur** —
jamais par l'orchestrateur lui-même, jamais par une récurrence programmée (H-61 : hors périmètre
actuel, à ne pas concevoir maintenant mais à ne pas non plus verrouiller pour plus tard).

### `POST /api/harness/orchestrator/proposals/{id}/reject` → `HarnessAPI.rejectProposal(id)`
Aucun effet secondaire. `status: 'refused'`.

---

## Sûreté (H-57) — jamais par l'orchestrateur

### `POST /api/harness/safety/pause` / `/resume` → `HarnessAPI.pauseGlobal()` / `resumeGlobal()`
PAUSE GLOBALE. Sessions **vivantes**, contexte **intégralement préservé**. Reprise instantanée.
Ne tue **pas** les processus enfants lancés par les agents (serveurs de dev, builds) — l'UI doit
le dire, pas le laisser croire (H-57).

### `POST /api/harness/safety/emergency-stop` → `HarnessAPI.emergencyStop()`
ARRÊT D'URGENCE. Pause globale puis fermeture propre des sessions. Contexte préservé **sur disque**
mais à recharger (`resume` ou redispatch) — pas instantané. Retourne `{ stopped: number }`.

`☠` Ces deux routes ne doivent **jamais** transiter par la session de l'orchestrateur maître —
chemin direct UI → control plane → superviseur (H-57 ☠). Si l'orchestrateur déraille, c'est
précisément le moment où elles doivent encore fonctionner. Idempotentes, rejouables sans effet
double.

`☠` Si le lien Pi↔PC est coupé, **aucune des deux routes n'atteint les workers** — l'UI grise déjà
les boutons dans ce cas (`harness-safety.js`, classe `.link-down`), elle ne doit jamais prétendre
qu'un clic a eu un effet qu'il n'a pas eu.

---

## Ce qui reste en données de démonstration (à remplacer)

Tout `pi-web/static/harness-mock-data.js` : missions, comptes et modèles sont fictifs,
en mémoire, réinitialisés à chaque rechargement de page. `pi-web/static/harness-api.js` simule une
latence réseau et un état PC absent activable depuis Paramètres (bouton « Simuler une absence de
PC ») — ce bouton et les fonctions `_setPcOnline`/`_isPcOnline`/`simulate*` sont marqués `☠ démo
uniquement` dans le code et n'ont pas vocation à survivre à l'intégration réelle.

## Ce qui n'a pas pu être intégré, et pourquoi

- **Aucun test réel contre un harness vivant** : le back-end n'existe pas (rappel de la mission).
  Ce contrat est donc écrit contre les mesures de `16-decisions-operateur.md`, pas contre un banc.
- **Streaming temps réel du fil de mission** : la démo simule un fil figé (chargé une fois par
  `getMission`), pas un flux poussé. En réel, le canal attendu est un WebSocket/SSE par mission
  (analogue à `/api/agent/chat` existant), avec reconstruction de l'arbre via `parent_tool_use_id`
  / `parent_agent_id` (H-72.1/H-72.3) — non modélisé ici par souci de rester dans le périmètre
  strict de `pi-web` (pas de nouveau protocole inventé côté client sans le harness en face).
- **`pending_user_dialog_requests`** (sibling de `pending_permission_requests`, H-73) : aucune
  route ni aucun champ ne le couvre ici — à spécifier quand le harness l'implémentera.
- **Notifications Web Push / PWA** (H-59) : hors périmètre de cette mission (zone `pi-web`
  existante, pas touchée) — le contrat n'en parle pas.

## Ce qui, dans la maquette reprise (design-v3), affirmait une capacité non prouvée

Repris tel quel dans le report de la mission — aucun changement de plus par rapport à ce que
`design-v3/CHANGEMENTS.md` documentait déjà :
- Les listes d'`effort` de Fable 5 sont mesurées (H-71.1) mais les **ordres de grandeur en
  tokens** ne le sont que pour Sonnet 5 (714/107/141) — Opus 4.8 et Fable 5 n'ont pas de mesure
  équivalente.
- `ultracode` simulé active un `workflowsEnabled` interne alors qu'aucune UI de « workflows »
  n'existe ailleurs dans la maquette — à concevoir séparément si retenu.
- Le bouton « Simuler un atterrissage » par mission (dans le détail de mission) contredit
  légèrement H-70 (« la décision appartient au superviseur qui voit tout le compte, jamais au
  lead/à la mission isolément ») — gardé pour la testabilité de la démo, à retirer si ce
  comportement devient réel (déjà signalé dans `design-v3/CHANGEMENTS.md`, non résolu ici).

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
2. **Cibler les champs.** Chaque valeur volatile porte une ancre `data-maj="..."`
   et n'est réécrite que si elle diffère (`hMajChamp`).
3. **Ajouter, ne pas réécrire** pour les listes qui grossissent : le fil d'une
   mission fait un `insertAdjacentHTML('beforeend', ...)` sur les seuls éléments
   neufs (`hMajFil`). Le passé n'est jamais reconstruit.
4. **Écrire sous condition** quand un rendu de bloc reste nécessaire :
   `hEcrireSiDifferent(el, html)` — jamais un `innerHTML` nu.
5. **Respecter la position de lecture.** Ne rattraper le bas que si l'utilisateur
   y était déjà (marge ~60 px), jamais de force.
6. **Une seule minuterie, liée à la vue visible**, suspendue quand l'onglet est
   masqué (`document.hidden`) et jamais réentrante (garde `hVueEnCours`).

Un rendu complet reste légitime **sur action de l'utilisateur** : changement de
mission, changement de filtre, premier affichage. Jamais en boucle.

Implémentation de référence : `static/harness-parc.js` (boucle + parc) et
`static/harness-mission.js` (`hMajMissionDetail`, `hMajFil`).
