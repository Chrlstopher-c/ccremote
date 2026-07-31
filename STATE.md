# STATE — ccremote
*Dernière mise à jour : 2026-07-31*

## ⚡ Chantier en cours — harness d'orchestration (depuis le 2026-07-22)

**Point d'entrée pour reprendre : `harness/REPRISE.md`, section « SESSION DU 31/07 (matin) », en FIN
de fichier.** Ne pas repartir de ce STATE pour le harness — REPRISE.md est plus précis et tenu à jour.

**État au 31/07 (fin de journée)** : EN PRODUCTION, commit `05999e4`, **1039 tests / 1039 verts**
(la suite est VERTE — les « 31 rouges préexistants » dépendaient du scratchpad d'une session Claude
Code disparue, corrigé), typecheck propre, SDK épinglé **0.3.220** (CLI embarqué 2.1.220), schéma du
registre en **version 13**. Trois services actifs, `pcOnline: true`.

Deux chantiers structurants livrés dans la journée, au-delà des six correctifs du matin :

1. **Les droits d'une équipe existent réellement.** `creer_equipe` exige `acces` (`lecture` |
   `ecriture`), l'orchestrateur le choisit, Chris le voit sur la carte avant d'autoriser, et le
   harness le POSE en `disallowedTools`. Avant : `deniedToolPatterns: []` — le plancher de déni
   lui-même n'était branché sur aucun chemin de production. Vérifié de bout en bout sur deux mandats
   réels (Vela en `lecture` puis en `ecriture`, accès relu en base).
2. **Autonomie totale.** Le bus d'escalade est RETIRÉ (il était câblé de bout en bout et n'a jamais
   rien porté), les workers tournent en `bypassPermissions`, `AskUserQuestion` leur est refusé.
   Aucune autorisation ne remonte plus jamais à un humain : Chris décide à l'approbation du mandat,
   plus jamais action par action.

`☠` Trois réflexes hérités de cette journée : le déploiement a DEUX moitiés (redémarrer
`ccremote-pc` après toute modification du canal, du SDK ou des options de worker) · un correctif vert
peut cacher une panne intacte (vérifier que la SOURCE d'un calcul est écrite, sur un artefact réel) ·
le system prompt de l'orchestrateur est une SURFACE À DÉPLOYER, pas de la documentation — toute
capacité ajoutée ou retirée à sa surface MCP s'y répercute le même jour.

Upgrade majeure : piloter des projets depuis l'app vers le PC. Un orchestrateur maître (session
Agent SDK sur le Pi) avec qui Chris discute, qui dispatche des missions Claude Code sur le PC,
observables et pilotables à distance depuis mobile.

- **Spécification** : `Upgrade/`, 17 fichiers. `16-decisions-operateur.md` **fait autorité** sur tout
  le reste (décisions de Chris + faits vérifiés contre le SDK).
- **Code** : `harness/`, TypeScript + Bun, SDK `@anthropic-ai/claude-agent-sdk` **épinglé 0.3.217**.
- **Maquette UI v2** : `design-v2/` — maquette de comparaison avec l'app actuelle, pas une refonte.
- **État au 24/07 (nuit)** : **EN PRODUCTION**, exercé sur de vraies équipes. Commit `046ecce`,
  **1017 tests verts** (31 échecs PRÉEXISTANTS sur `control-plane/projets`, vérifiés identiques sur
  HEAD — sans rapport avec les chantiers en cours), typecheck propre, schéma du registre en
  **version 12**. Trois services actifs : `ccremote-harness` + `ccremote-web` (Pi), `ccremote-pc` (PC).
  Compte A (compte-a) saturé à 100 % hebdo jusqu'au dimanche 26 juil. 21h ; tout passe sur B.

**Livré le 23/07 (soirée)** — quotas en temps réel et sous-agents visibles :

- **Quotas mesurés sans consommer un token, et sans le PC** (`b6aa6fc`). La mesure passait par une
  session Claude Code par compte : coûteuse, donc cachée 10 min, donc un écran toujours en retard —
  et morte dès l'extinction du PC. Le Pi interroge maintenant lui-même l'endpoint OAuth d'usage
  toutes les 20 s (~200 ms, zéro token, zéro process). Le PC n'est plus que la SOURCE du jeton,
  persisté au registre (migration 9) : les jauges vivent PC éteint jusqu'à expiration (~8 h),
  **vérifié en réel, service PC arrêté**. Aucun refresh hors du CLI — les refresh tokens sont
  tournants. `☠` La réponse OAuth est PLATE, pas enveloppée dans `rate_limits` comme celle du SDK :
  la première version rendait zéro jauge sur un HTTP 200, en silence.
- **Les sous-agents existent enfin à l'écran** (`c482742`). La vue n'affichait que « Team leader ».
  La liste vient du TRANSCRIT (migration 10), jamais du flux — mesuré non déterministe (H-72.4).
  `☠` Le CLI écrit un `agent-<id>.meta.json` porteur de `{agentType, description, toolUseId,
  spawnDepth}` : ce `toolUseId` EST le `parent_tool_use_id` du flux, donc la corrélation
  flux ⟷ store existe sur disque. Validé sur la session à 5 sous-agents de H-72.4 : **5 sur 5**.
- **Une équipe ne meurt plus à chaque fin de tour** (`1dc52f2`, `7a6fc05`). `☠` LE défaut central :
  `#surveillerResultats` marquait le worker MORT au PREMIER `result` et cessait de lire. Banc réel
  (SDK 0.3.217, streaming input) : après `result` n°1 le flux émet `background_tasks_changed`,
  `task_notification`, un nouvel `init`, puis le lead REPART SEUL avec le résultat de son sous-agent
  jusqu'à un `result` n°2 — et le flux ne se termine jamais. Le comportement natif de Claude Code
  n'avait rien à reconstruire : il fallait arrêter de raccrocher. En prod, trois runs sur quatre
  mouraient au même endroit. Le critère : `background_tasks_changed` (signal de NIVEAU, sémantique
  REPLACE imposée par le SDK). Tâches de fond vivantes ⇒ on écoute ; ensemble vide + fin normale ⇒
  la mission est FINIE. `☠ J'AI SUR-CORRIGÉ` (`ad2795a`, retour arrière) : un temps gardé la session
  ouverte sur TOUTE fin normale, en me fondant sur le récit de l'orchestrateur (« le lead croit
  attendre ») plutôt que sur la mesure — résultat, une équipe qui avait rendu sa synthèse restait
  `en_cours` à vie. Les logs (mission a122e20c : garde à 18:40, synthèse à 18:43) ont tranché contre
  moi. La garde SUFFIT, la sur-correction est partie. Répare aussi `envoyer_a_equipe`.
- **La rotation de compte se déclenche enfin** (`d56634b`). `☠` DEUX défauts, l'un masquant l'autre :
  (1) « weekly limit » — la forme réelle du CLI — n'était détectée par AUCUN motif (`spend/usage/rate
  limit`, `quota exceeded`), donc la saturation n'était jamais vue et la bascule jamais tentée ; la
  règle vivait DUPLIQUÉE dans deux fichiers, tous deux périmés → extraite dans
  `shared/saturation-compte.ts`, source unique. (2) L'index de rotation repartait à 0 à chaque
  redémarrage du Pi (dette E), renvoyant l'orchestrateur sur le compte à 100 % → compte de départ
  choisi sur le quota MESURÉ (`choix-compte-orchestrateur.ts`), lien config-dir ⟷ compte par l'EMAIL
  (`oauthAccount.emailAddress`), inconnu ≠ saturé. Vérifié en prod.
- **La réconciliation ne ressuscite plus une équipe qu'on vient d'arrêter** (`046ecce`). `☠ LE PIRE
  DÉFAUT de la série` : l'opérateur arrête une équipe (`en_cours → annulee`, 18:53:29), la
  réconciliation la ROUVRE 90 s plus tard (`annulee → en_cours — orphelin_adopte`). La branche
  « orphelin avec historique » adoptait toute mission non-active — or les états sont exactement
  actifs ∪ terminaux, donc « non-active » ≡ TERMINALE. « Le PC gagne » (E.1.4) arbitre une divergence
  d'OBSERVATION, JAMAIS un ordre. Un worker survivant sur une mission terminale est un RÉSIDU : tué,
  jamais réadopté. Branche d'adoption retirée (code mort). Corrige au passage H-56 qui remontait en
  500 « erreur interne du control plane » → `ErreurProjetOccupe` en 409 lisible.
- **Modèle et raisonnement réellement appliqués** (`56bf2aa`, `7a6fc05`) — le sélecteur ne pilotait
  RIEN : le client n'envoyait pas les champs, la route sœur les jetait, la session tournait sur sa
  constante. Appliqués via `setModel()`/`applyFlagSettings()`, attribués PAR ÉVÈNEMENT (migration 12),
  mémorisés par conversation.
- **`☠` Aucun cache-busting sur les assets** (`7a6fc05`) — un déploiement front pouvait rester
  invisible derrière le cache du navigateur, rechargement compris. On a cherché des bugs DÉJÀ
  CORRIGÉS à cause de ça. Empreinte = mtime le plus récent de `static/`. Règle remontée en global
  (`~/.claude/rules/code-standards.md` + réflexe de debug dans `session-awareness.md`).
- **Un déploiement de routine n'éteint plus l'orchestrateur** (`8a102d2`) — `deploy-harness-pi.sh`
  réécrit `.env` EN ENTIER : tout opt-in absent de l'environnement de l'appelant retombait à sa
  valeur d'usine. Trois déploiements ont ainsi éteint l'orchestrateur (`route inconnue :
  /orchestrator/conversations`). Le défaut d'un réglage est désormais SA PROPRE VALEUR, relue sur
  le Pi. `⚠` Revue des AUTRES opt-in du `.env` pas encore faite — même défaut possible ailleurs.
- **`explorer_projets` enfin câblé** — 7ᵉ occurrence de « écrit, testé, branché sur rien » :
  `SuperviseurWorkers` importait `explorerProjets` et gardait `#racineProjets`, sans jamais exposer
  la méthode que `canal-controle.ts` interroge. L'orchestrateur répondait « exploration non câblée
  sur ce superviseur » et partait sur le chemin donné **à l'aveugle** (constaté au premier vrai
  dispatch, 23/07). Aucun test ne couvrait ce chemin : il en existe un d'ASSEMBLAGE maintenant —
  seul type de test capable d'attraper ce motif.

### `☠` Garde-fous du dispatch — ce que le harness N'IMPOSE PAS

À savoir avant tout test du système agentique (établi 23/07) :

1. **`creer_equipe` ne crée rien** — c'est une PROPOSITION (H-61). Chris autorise dans l'UI. C'est
   le SEUL point de décision humaine qui subsiste, et il est délibéré.
2. **Le modèle des SOUS-AGENTS ne peut pas être imposé.** `creer_equipe` n'accepte `modele`/`effort`
   que pour le LEAD ; le modèle de chaque sous-agent est choisi par le lead à l'appel de l'outil
   `Agent`. « Sous-agents en Haiku » est une instruction de CONDUITE dans le mandat, pas un verrou.
3. **CE QUI EST un verrou, depuis le 31/07** (`ef2524f`, `b60b371`) : le plancher de déni (H-41),
   inconditionnel sur tout dispatch · l'accès du mandat — `lecture` retire Write/Edit/NotebookEdit
   de la liste d'outils du worker · `AskUserQuestion`, refusé à toute équipe. Mesuré sur un worker
   réel, pas déduit : `acceptation/bypass-denis-reel.ts`.
4. **CE QUI N'EST TOUJOURS PAS un verrou** : le champ `perimetre`, qui reste une description en
   clair adressée au lead. « Pas de refactor », « ne touche qu'à src/ », « commits isolés » tiennent
   à son obéissance. Ne jamais les présenter à Chris comme une contrainte appliquée.
   `Bash` reste ouvert même en `lecture` (décision Chris) : la restriction porte sur l'écriture de
   FICHIERS, pas sur l'exécution de commandes — écrire via `sed -i` reste possible, mais jamais
   accidentel.

Conséquence : un test d'équipe mesure la conformité du modèle aux consignes de CONDUITE (périmètre,
sous-agents), et une contrainte réellement appliquée pour les DROITS (accès, plancher).

**Livré le 23/07 (journée)** — le harness ne se contente plus de piloter, il *rend compte* : fil de mission
réel (réflexions, outils, textes du lead), équipes terminées consultables et désignables par nom,
contexte ventilé par poste, jauges de rate limit réellement mesurées, rafraîchissement temps réel
de l'interface sans reconstruire le DOM.

**Reste à faire, dans l'ordre** : (B) faire apparaître les sous-agents — seul point de la liste du
23/07 encore entier ; (D) élucider un écart de ~4 K tokens entre `totalTokens` et la somme des
postes ; (E) dettes connues listées dans REPRISE.md.

Décisions structurantes à connaître : v1 = **une seule mission active par projet** (H-56) · **deux**
boutons de sûreté distincts, pause globale ≠ arrêt d'urgence (H-57) · plafond en dollars désactivé,
le vrai bornage est le rate limit du compte (H-58) · notifications Web Push PWA + Discord en filet
(H-59) · **multi-comptes Claude Code par `CLAUDE_CONFIG_DIR`, vérifié en exécution réelle** (H-53).

L'app v1 décrite ci-dessous **reste en production et fonctionne** — le harness est un ajout, pas un
remplacement.

---

## Résumé de l'état actuel (app v1, en production)

ccremote est un panneau de contrôle personnel : un serveur websocket tourne sur le PC principal
(TrinityArch, `pc.exemple:8765`) et expose tmux (sessions Claude Code) + métriques système ;
une app FastAPI (`pi-web`) tourne sur un Raspberry Pi et sert une SPA exposée publiquement via
Cloudflare Tunnel (`ccremote.exemple.com`). Un agent IA (Cerebras, tool-calling) pilote
le tout en langage naturel : statut PC, sessions tmux, métriques, comptes Claude Code, extinction.

Design "Anthropic-style" (cream/serif/orange) repris d'un mockup fourni par Chris, entièrement
re-câblé sur le vrai backend (aucune donnée fictive). Mobile-first, streaming SSE, markdown stylisé,
conversations persistantes en localStorage. Déployé et vérifié fonctionnel en prod.

## Ce qui a été fait — session du 2026-07-31 (harness)

Seize commits. Six correctifs le matin (voir `harness/REPRISE.md`), puis deux chantiers de fond.

**Les droits d'une équipe deviennent réels** (`ef2524f`, `a34cfef`) — `shared/acces-mandat.ts`
devient la source unique : `acces` s'énumère (`lecture` | `ecriture`), se valide, et se traduit en
refus d'outils POSÉS sur le worker. Migration 13. Deux défauts distincts fermés du même coup : le
plancher de déni n'était branché sur aucun chemin de production (`?? []` rendait un tableau vide,
donc rien n'interdisait d'écraser `~/.ssh` ou les identifiants OAuth du poste — 9ᵉ « écrit, testé,
branché sur rien »), et `perimetre` était un texte libre qui ne partait que dans le prompt du lead.
Le system prompt de l'orchestrateur apprend ce droit et comment choisir.

**Autonomie totale** (`df0e351`, `b60b371`) — le bus d'escalade est retiré : câblé de bout en bout
(port distant, canal bidirectionnel, machine à états, outils MCP, routes, UI) et structurellement
mort, son unique producteur `canUseTool` n'étant jamais appelé en `permissionMode: 'auto'`. Les
workers passent en `bypassPermissions` (renversement assumé de H-40/H-42, dont le test garde-fou est
réécrit avec son motif), `AskUserQuestion` leur est refusé, et le prompt initial dit au lead qu'il
décide seul et que ses questions vont dans son rapport final.

**La suite de tests redevient un signal** (`0383baa`) — les 31 rouges « préexistants » ne l'étaient
pas : ils codaient en dur le scratchpad d'une session Claude Code disparue et validaient des
répertoires créés à la main dedans. `test-harness/racine-temporaire.ts` : un test crée ce qu'il
valide, sous `os.tmpdir()`. **1039 tests, 0 échec.**

**Vérifié en production, sur artefact** — deux mandats réels sur Vela, `acces=lecture` puis
`acces=ecriture` relus en base ; l'orchestrateur choisit de lui-même, l'annonce, et adapte objectif
et critère d'arrêt au changement de droits.

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| `acces` obligatoire dans `creer_equipe`, deux valeurs | Un droit s'énumère et se valide ; la sortie d'un LLM passée à un exécutable est une entrée utilisateur | 2026-07-31 |
| `Bash` reste ouvert en accès `lecture` | Décision Chris : « lecture seule » borne l'écriture de FICHIERS, pas l'exécution de commandes. Un agent d'exploration travaille au shell — l'en priver le rend infirme, pas sûr. Écrire via `sed -i` reste possible mais jamais ACCIDENTEL, et le plancher couvre le catastrophique | 2026-07-31 |
| Retrait complet du bus d'escalade | Câblé de bout en bout, zéro demande depuis le premier jour (`canUseTool` jamais appelé en mode `auto`). Une catégorie vide affirme une protection inexistante | 2026-07-31 |
| Workers en `bypassPermissions` | Renversement de H-40/H-42. Le mode `auto` était un client silencieux du bus supprimé : un refus du classifieur ne menait plus nulle part et l'équipe aurait attendu un verdict que personne ne peut rendre | 2026-07-31 |
| `AskUserQuestion` refusé à toute équipe | Exception C.1.2 atteignant `canUseTool` même sous une règle d'allow. Personne ne lit le flux d'une équipe qui travaille — le lead y perdait un tour | 2026-07-31 |
| Cerebras (pas Groq) comme provider IA | Choix explicite de Chris | avant 2026-07-06 |
| Modèle par défaut `gpt-oss-120b` | Seul modèle avec tool-calling vérifié fonctionnel parmi les 3 dispo sur la clé | avant 2026-07-06 |
| Contexte des modèles estimé, pas documenté par l'API | `/v1/models` Cerebras ne renvoie pas la taille de contexte ; valeurs conservatrices posées en dur dans `client.py` | 2026-07-06 |
| localStorage pour conversations/prefs (pas de DB) | Cohérent avec l'architecture stateless existante, pas de comptes utilisateurs | 2026-07-06 |
| Switch de compte : snapshot + restart tmux, pas de hot-reload | Claude Code garde son token en mémoire process ; seul un restart du process charge la nouvelle identité | 2026-07-06 |
| `poweroff` nu (pas `systemctl poweroff`) | Préférence explicite de Chris, habitude déjà validée sans sudo | 2026-07-06 |
| Rotation round-robin réactive (sur 429), pas proactive | Simplicité — bascule seulement quand la clé active est réellement épuisée, pas d'alternance systématique qui compliquerait le suivi de quota par clé | 2026-07-06 |
| Quotas affichés en combiné (somme des clés) + détail par clé | Chris a fait remarquer que le fallback étant réel et automatique, un total combiné n'est pas trompeur — seulement l'était le fait de ne montrer que la clé active | 2026-07-06 |
| Reset quota simulé par seuil (pas d'interpolation progressive) | Chris a explicitement décrit l'attente comme un reset complet après une fenêtre pleine ("la minute d'après ça doit revenir à zéro"), pas une régénération graduelle — plus simple et fidèle à la demande | 2026-07-06 |
| Règle polkit dédiée plutôt que modifier le service pour tourner en session utilisateur | Le service `ccremote-server` doit rester un service système auto-démarré au boot, indépendant d'une session graphique ouverte | 2026-07-06 |

## Contexte non-évident

### `☠` Mise à jour automatique d'une interface — jamais le DOM complet (23/07)

Toute vue qui se rafraîchit seule ne réécrit **jamais** `innerHTML` sur un conteneur entier :
les nœuds sont détruits et recréés, ce qui efface la saisie en cours, referme les `<details>`,
annule la sélection de texte et rejette le défilement en bas. Forme correcte : empreinte des champs
volatils → écriture ciblée par `data-maj` → **append** des seuls éléments neufs → une seule
minuterie liée à la vue visible, suspendue sur `document.hidden`, non réentrante. Un rendu complet
n'est légitime que **sur action de l'utilisateur**. Détail : `pi-web/CONTRAT-API-HARNESS.md`,
section « RÈGLE ABSOLUE ».

### Faits mesurés sur le contexte et les quotas (23/07)

- Le **socle** d'une session pèse ~24 K tokens avant le moindre échange (prompt système, outils,
  CLAUDE.md, skills). Un « 10 % » précoce n'est donc pas forcément anormal.
- Les postes **différés** (`isDeferred`) ne comptent PAS dans `totalTokens`.
- **`maxTokens` n'est pas comparable d'un modèle à l'autre** : 967 000 (Sonnet) vs 1 000 000
  (Opus), soit exactement les 33 000 du buffer d'autocompact. Deux jauges à « 10 % » ne désignent
  pas la même marge.
- **`reset_a` est en millisecondes epoch**, normalisé au point d'écriture. Une seule convention.


- **`~/.claude/.credentials_account1.json` / `_account2.json`** existaient déjà avant cette
  session (créés manuellement par Chris) — ccremote ne fait que les orchestrer. Les tokens sont
  opaques (`sk-ant-oat01-...`), pas de JWT décodable : impossible de déterminer par le code quel
  compte est actif sans le fichier de métadonnées `.ccremote-accounts.json` que cette session a
  introduit comme source de vérité côté serveur.
- **Cloudflare Tunnel** expose l'app publiquement — le footer de login a été corrigé pour ne plus
  prétendre "réseau local uniquement" (faux depuis la mise en place du tunnel).
- **`WS_TIMEOUT` (connexion) vs `RECV_TIMEOUT` (réponse)** dans `pc_client.py` : deux timeouts
  distincts nécessaires — l'ancien code n'avait qu'un `open_timeout`, la réponse pouvait hang
  indéfiniment si le serveur ne répondait jamais (c'était plausiblement la cause du "crash" rapporté).
- **`X-Accel-Buffering: no`** ajouté sur la réponse SSE pour éviter tout buffering par un reverse
  proxy intermédiaire (Cloudflare Tunnel) qui casserait le streaming en prod.
- **`poweroff` (symlink vers `systemctl`) passe toujours par polkit**, même lancé depuis un service
  systemd tournant sous un utilisateur non-root — polkit distingue "session active" de "process de
  cet uid", et une règle basée sur `CanPowerOff` de session ne couvre pas le second cas. Toute
  action privilégiée déclenchée par `ccremote-server` (pas seulement poweroff) devra passer par une
  règle polkit explicite sur l'uid, jamais s'appuyer sur un test fait en session interactive.
- **Coût réel par appel bien plus élevé que le message tapé** : `TOOL_SCHEMAS` (tous les tools
  disponibles) est envoyé à chaque appel Cerebras, même sans tool call. Vérifié en prod (test session
  du 2026-07-06) : un message de 8 mots sans tool a consommé ~16 650 tokens sur le quota "tokens/minute"
  (limite 30 000) — la marge réelle avant un 429 est donc bien plus faible que ce que la longueur de
  la conversation seule suggérerait. C'est justement ce que le nouveau suivi de quotas rend visible.

## Ce qui a été fait — session du 2026-07-23 (harness)

*Détail complet, faits mesurés et pièges : `harness/REPRISE.md`, section « SESSION DU 23/07
(journée) ». Ce résumé ne le remplace pas.*

- **Fil de la mission** — il était rendu VIDE « par honnêteté » alors que deux sources persistées
  existaient déjà (transitions d'état, permissions). Enrichi ensuite des activités du lead :
  le collecteur ne lisait que les blocs `text` d'un message assistant et **jetait** `thinking` et
  `tool_use`. Migrations 7 et 8.
- **Équipes terminées retrouvables** — `listerEquipes` n'appelait que `listerActives()` : une équipe
  sortait de la vue de l'orchestrateur à la seconde où elle finissait. Désignation par id, nom,
  projet ou fragment ; ambiguïté refusée avec ses candidats ; identifiant copiable dans l'UI.
- **Contexte ventilé par poste** (migration 6) — le SDK rendait une ventilation qu'on jetait.
- **Mort d'un worker détectée** — `reconcilier()` ne tourne qu'au démarrage et au rattachement ;
  un worker mort en cours de route n'était vu par personne. Le balayage télémétrie le déclenche.
- **État d'affichage honnête** — `en_cours` + `etatSdk=idle` s'affichait « running ».
- **`rapport_equipe`** — rend le dernier TEXTE du lead, entier, jamais tronqué.
- **Jauges de rate limit** — `releverQuota()` n'était appelé QUE pour marquer une saturation ;
  l'usage courant n'était jamais mesuré. Sonde réelle côté PC, cache 10 min.
- **Rafraîchissement temps réel de l'UI** — aucune vue du parc ne se rafraîchissait. Diff ciblé +
  append, sans jamais reconstruire le DOM (règle posée, voir ci-dessous).
- **Sidebar scrollable** en vue mobile.

## Prochaines étapes

**Liste tenue à jour dans `TODO.md`** (section « EN COURS »), plus précise que celle-ci.

1. **Chris envoie ses notes d'idées** prises il y a quelques jours — cas d'usage et améliorations à
   tester. C'est le point de reprise convenu en fin de session du 31/07.
2. **Exercer le mode rapide et ultracode** — `fastMode` est exposé par `/modeles` (seul Opus 5 le
   déclare), les cases existent à l'écran, leur effet réel n'a jamais été vérifié.
3. **(D) Élucider l'écart de ~4 K tokens** entre `totalTokens` et la somme des postes chargés.
4. **(E-bis) Revoir les autres opt-in de `deploy-harness-pi.sh`** — le script réécrit `.env` en
   entier ; un seul opt-in a été vérifié.
5. **Dettes** : `superviseur-workers.ts` à 710 lignes · index de rotation du master en mémoire ·
   `harness-orchestrateur.js` au-delà de 500 lignes · `BUDGET_MANDAT_DEFAUT_USD` codé en dur à 12 $,
   non réglable depuis l'orchestrateur ni l'interface.

## Points en suspens

- **Deux surfaces mortes repérées le 31/07, non traitées** (signalées à Chris, hors scope du jour) :
  l'audit `PreToolUse` est branché sur un `CollecteurAuditPermissions` créé neuf à chaque worker,
  jeté à la fin, que personne ne lit — même famille de défaut que le bus d'escalade · le formulaire
  manuel de mandat dans l'UI est un mock (`proposeMandate` empile une proposition locale et ne
  dispatche rien), il ne porte donc pas l'accès.
- **L'étage « lead → orchestrateur » n'existe pas.** L'organisation voulue est « sous-agents → lead
  → orchestrateur → humain ». Les deux premiers étages sont natifs du SDK, le troisième est absent —
  et ce n'est PAS du bus de permissions : c'est un canal de conversation remontante (le lead a une
  QUESTION et attend). Aujourd'hui l'orchestrateur peut lire une équipe et lui pousser un message,
  l'inverse n'existe pas.
- **`STATE.md` dépasse encore la limite de 300 lignes** (335) : il couvre deux produits, l'app v1 et
  le harness. À scinder si la limite devient gênante.
- **Quotas** : compte A à 27 % / 3 %, compte B à 12 % / 76 % (mesuré le 31/07 au matin). La sonde
  tourne à 60 s par compte en rotation, le 429 chronique est résorbé.
- **Écart de ~4 061 tokens** entre `totalTokens` et la somme des postes chargés, sur une mission
  réelle, alors que la somme tombait au token près en mesure locale. Hypothèse non prouvée : total
  calculé en direct, catégories issues d'un état antérieur. **Le total reste la référence.**
- **Bouton extinction non re-testé en réel** après le fix polkit (le test aurait réellement éteint
  la machine) — vérification faite uniquement via `pkcheck` (résultat `yes`). À confirmer par Chris
  depuis l'app à sa prochaine utilisation.
- **Heuristique de reset des quotas non vérifiée en conditions réelles prolongées** — la logique
  "reset complet après une fenêtre pleine sans appel" est un best-effort cohérent avec une fenêtre
  glissante, mais n'a pas été observée sur un vrai cycle minute/heure/jour en prod. À surveiller si
  Chris rapporte encore un écart.
- **Les deux clés Cerebras sont sur le tier gratuit** (5 req/min, 30k tokens/min chacune, confirmé
  par les vraies limites remontées dans l'UI) — la rotation double la marge mais ne résout pas le
  problème structurel. Si les 429 reviennent fréquemment malgré les 2 clés, la vraie solution est
  un tier payant côté Cerebras (décision business de Chris, pas un fix côté code).
- **Reasoning en un seul bloc par échange** (pas par round de tool-calling) : simplification
  assumée pour le streaming — acceptable visuellement mais perd la granularité "un think block
  par round" qu'avait l'ancienne version non-streamée.
- **Tailles de contexte des modèles Cerebras** (`MODEL_CONTEXT_TOKENS`) restent des estimations
  faute de documentation publique — `gemma-4-31b` est confirmé utilisé par Chris, mais sa vraie
  fenêtre de contexte n'est pas vérifiée (32k posé par prudence).

## Historique

### Sessions du 2026-07-06 (app v1) — archivé le 31/07
Deux sessions consacrées à l'app v1 (chat Cerebras + pilotage du PC), avant l'existence du harness.
Livré : agent IA avec tool-calling, refonte frontend d'après mockup, page de login, passe
mobile-first, bascule multi-comptes Claude Code par snapshots de `.credentials.json`, bouton
d'extinction du PC, fix `100dvh` pour Safari iOS, conformité aux standards projet (README,
ARCHITECTURE, start/stop/restart, `.env.example`). L'app v1 reste en production et fonctionne —
le harness est un ajout, pas un remplacement. Détail complet dans l'historique git (juillet 2026).

### Sessions précédentes (avant 2026-07-06)
- Mise en place initiale : repo GitHub privé, checkpoint stable
- Agent IA ajouté (tool-calling Cerebras) avec vérification live des modèles disponibles sur la clé
- Mot de passe UI déplacé en `.env`, changé sur demande
- Refonte complète du frontend à partir d'un mockup fourni (design "Anthropic-style"), 100% du
  JS fictif du mockup remplacé par du vrai câblage backend
- Page de login refaite deux fois (mockup corrigé par Chris), remember-me retiré
- Passe mobile-first complète + panneau droit redimensionnable en drag
