# REPRISE — harness d'orchestration ccremote

Point d'entrée unique pour reprendre le chantier à froid, sans le contexte de la conversation d'origine.
*Dernière mise à jour : 2026-07-23 (journée) — voir « SESSION DU 23/07 (journée) » en FIN de fichier : c'est l'état le plus récent. La section « (nuit) » qui la précède est de la même journée mais ANTÉRIEURE.*

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

## État au 2026-07-22 (nuit) — le lien, l'API et l'UI en lecture sont livrés

Le harness s'assemble maintenant des deux côtés et l'interface affiche de vraies données de
registre. `⚠` Ce qui reste faux serait de le croire **éprouvé** : rien n'a encore tourné entre deux
machines réelles — le lien n'a été exercé qu'en boucle locale, et l'interface ne sait qu'observer,
pas piloter (aucune route d'écriture). Détail complet dans « ACTION SUIVANTE ».

## État détaillé — clôture du MVP

**Lots 0 à 5 livrés.** Dernier commit `2d81183`. **698 tests verts, typecheck propre.**
Il reste **M-50** (en vol au moment de la compaction) et **M-53** (qui seule clôt le MVP).

| Mission | Dossier | État |
|---|---|---|
| M-01 squelette worker | `workers/` | livré |
| M-02 générateur d'entrée | `control-plane/orchestrateur/entree/` | livré |
| M-03 registre SQLite | `control-plane/registre/` | livré |
| M-04 harnais de pannes | `test-harness/` | livré — voir `test-harness/README.md` |
| M-10 tunnel WebSocket + ping/pong | `transport/` | livré — voir `transport/DECISION-TRANSPORT.md` |
| M-20 plancher de déni | `plancher-deni/` | livré · **moteur réel vérifié** |
| M-21 machine à états des demandes | `control-plane/bus-permissions/` | livré |
| M-22 audit des permissions | `control-plane/audit-permissions/` | livré · **corrigé par banc réel** |
| M-34 relance et classification | `relance/` | livré · ⚠ **non câblé** |
| M-30 réconciliation | `control-plane/reconciliation/` | livré · ⚠ ports non implémentés |
| M-32 modèle de projets | `projets/` | livré · ⚠ git réel jamais exercé |
| M-33 pause et reprise | `pause/` | livré |
| M-31 adaptateur `SessionStore` | `control-plane/session-store/` | livré · **vérifié sur vrai SDK** |
| M-41 session orchestrateur | `control-plane/orchestrateur/processus/` | livré · A.1/A.3.2/A.4.2 · dette `surFermetureImprevue` (H-60) branchée sur alarme réelle · **corrigé 2026-07-22 sur banc réel** (`acceptation/orchestrateur-reel.ts`) : `demarrerOrchestrateur()` n'attend plus jamais `init` (interblocage structurel, le SDK ne l'émet qu'après un 1er message utilisateur) et ne consomme plus lui-même `query` (double-lecteur) — `poignee.ingererMessage()` délègue ça au vrai lecteur |
| M-13 canal de contrôle + superviseur de workers | `superviseur/` | livré 2026-07-22 · `CanalControle` (D.3, idempotence par `opId` mécanique, jamais par convention) + `SuperviseurWorkers` implémentant réellement `InventairePc`/`ReinitialisateurSession` (M-30) et `RepertoireCibles`/`ArreteurMission`/`RelanceurMission` (A.2) · `deciderRelance()` (dette M-34) câblé dans l'unique lecteur du `Query` d'un worker · `workers/` étendu d'un mode `resume` (`composeWorkerOptions`, `startWorker`) pour la relance · `⚠ HYP à vérifier sur banc réel` : le type public `SDKControlInitializeResponse` ne porte pas `pending_permission_requests` — lecture défensive en attendant confirmation, voir `superviseur/reponse-reinitialize.ts` · 40 tests ajoutés, aucun test existant cassé |
| M-11 fencing par epoch | `superviseur/fencing-epoch.ts` | livré · clé = **le worktree**, égalité d'epoch rejetée explicitement, worker évincé réellement aborté |
| M-40 outils MCP de contrôle | `control-plane/orchestrateur/mcp-controle/` | livré · 12 outils · non-blocage **prouvé** (port mort ⇒ main rendue < 500 ms) · `arret_urgence` **absent** (H-57 > spec) |
| M-42 discipline de contexte | `discipline-contexte/` | livré · n'utilise **pas** `percentage` (échelle non documentée) · seuil pathologique : < 15 min entre 2 auto, ou ≥ 3 en 60 min |
| M-51 budgets | `budgets/` | livré · classification sur les **vraies constantes SDK** · plafond de parc **incapable par le type** de tuer une mission |
| M-52 arrêt d'urgence | `arret-urgence/` + `superviseur/arret-urgence-sequence.ts` | livré · chemin **ne traversant jamais** `control-plane/orchestrateur/` (vérifié par grep des imports) · aucun chemin vers `liberer()` |
| M-50 client temps réel | ? | `⚠` **EN VOL à la compaction — vérifier sur disque** |
| M-53 validation des 5 propriétés | — | **à lancer** · seule mission autorisée à déclarer le harness terminé |
| Maquette UI v2 | `../design-v2/` | **validée par Chris le 2026-07-22** |
| Maquette UI v3 | `../design-v3/` | livrée · H-70/H-71/H-72 · `⚠` **jamais regardée par Chris** |

**Bancs d'essai réels** (`acceptation/`, hors `bun test` volontairement — ils ouvrent de vraies
sessions) : `m02-flux-entree.ts` · `plancher-moteur-reel.ts` · `multi-comptes-reel.ts` ·
`session-store-reel.ts` · `orchestrateur-reel.ts` · `worker-reel.ts` · `worktree-git-reel.ts` ·
`observabilite-sousagents-reel.ts` · `observabilite-5-sousagents-reel.ts`.

**H-69 lève la parcimonie** : un banc réel est le moyen **normal** de lever un doute, pas un luxe.
`☠` **Chacun de ces neuf bancs a trouvé un défaut que les tests unitaires ne voyaient pas** — dont
deux qui rendaient un composant strictement inutilisable (interblocage au démarrage de
l'orchestrateur) et un bug de **perte de données** (suppression de worktree portant du travail non
commité). C'est le principal enseignement de la journée : sur ce projet, le vert des tests unitaires
ne prouve pas grand-chose.

**Faits mesurés sur le `SessionStore` réel** : le SDK appelle `append` par lots (~480-530 ms
d'intervalle), la `projectKey` est le **cwd sanitisé** (`-mnt-projects-ccremote-harness`), et sur une
session courte **seul `append` est sollicité** — `load`/`delete`/`listSubkeys` restent non exercés.

**Maquettes** : `design-v2/` **validée par Chris**, DA cream/serif/orange actée — la reprendre, ne
jamais la réinventer. `design-v3/` (2179 l.) étend la v2 avec H-70/H-71/H-72 — **à faire valider par
Chris**, jamais regardée par lui.

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
bun test              # doit afficher 698 pass, 0 fail (ou plus)
git log --oneline -3
```

`⚠` **M-50 tournait au moment de la compaction.** Vérifier sur disque ce qui a abouti avant de
relancer quoi que ce soit — ne pas refaire à l'aveugle. Un plan en mémoire ne prouve pas qu'il n'a
pas déjà été exécuté.

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
*Réécrit le 2026-07-22 au soir. Ce qui précède décrivait la clôture du MVP ; le chantier a changé
d'objectif depuis, sur décision de Chris.*

### Objectif courant, dans cet ordre — priorités données par Chris

1. **Rendre la communication PC↔Pi réellement fonctionnelle** (priorité n°1).
2. **Câbler concrètement l'interface** — elle est fusionnée dans `pi-web/` mais ses données sont
   encore des mocks.
3. Poursuivre le reste des dettes.

### État au 2026-07-22, nuit — les trois chantiers coupés par le quota sont FAITS

Les trois agents coupés en plein vol ont été repris **à la main**, un par un. Aucune casse à
réparer : la vérification faite juste après la coupure (904 tests verts, `git stash` vide, app
debout) tenait.

| Chantier | État |
|---|---|
| Lien PC↔Pi (H-75) | **revu, 3 défauts corrigés** — commit `6b91242` |
| API web du control plane | **livrée** — `control-plane/api-web/`, commit `9c695d2` |
| Branchement de l'UI | **livré en lecture** — commit `b8d542f` |

**923 tests verts, typecheck propre.**

#### Les 3 défauts trouvés en revoyant le lien (aucun n'était visible en test unitaire)

1. **Le secret transitait en `?secret=…`.** Nos logs étaient propres, mais Cloudflare Tunnel
   journalise les URLs : le secret partagé finissait en clair dans les access logs d'un tiers.
   Passé en en-tête `Authorization: Bearer` (support Bun **mesuré** avant d'écrire).
2. **La connexion PC n'était jamais oubliée à sa fermeture.** Chaque reconnexion légitime du matin
   était comptée comme un supersede « deux PC connectés ». Une alarme qui crie tous les matins ne
   garde plus rien le jour où elle est vraie. Banc d'assemblage ajouté sur le cycle
   extinction/rallumage, **vérifié rouge sans le correctif**.
3. **Le refus terminal 4401 était neutralisé par systemd.** Le transport traite un secret refusé
   comme terminal — précisément pour ne pas marteler le Pi — mais l'unité relançait le process
   toutes les 10 s. Même forme que les cinq garde-fous branchés sur rien : le garde-fou existait,
   l'assemblage l'annulait. `RestartSec=60` + code de sortie `78` (`EX_CONFIG`) distinct d'un
   plantage.

Les points 1 (epoch), 2 (gigue) et 5 (rien de mutant au rattachement) de la revue prévue ont été
**vérifiés conformes sur le code**, pas sur un rapport.

#### Ce que sert l'API web, et ce qu'elle refuse de servir

`control-plane/api-web/` → missions, escalades, comptes, depuis le **vrai registre**. Derrière
`pi-web`, qui porte l'authentification ; le serveur **refuse de démarrer sur `0.0.0.0`** (il n'a
aucune authentification propre).

`☠` Trois issues distinctes, jamais confondues — c'est le cœur du module :

| Réponse | Sens |
|---|---|
| `200` + `pcOnline:true` | données fraîches |
| `200` + `pcOnline:false` | **PC éteint — régime nominal, pas une erreur** |
| `502 harness_injoignable` | le control plane est mort sur le Pi |

Écraser la troisième en deuxième ferait chercher une panne sur le PC pendant que le serveur est
mort sur le Pi.

**Honnêteté des champs** : `subagents`, `feed`, `inspection` et `landing` sortent **vides**. Ils
vivent sur le PC et ne sont pas encore remontés. Une donnée fabriquée qui a l'air vraie se propage
dans les décisions avant qu'on découvre qu'elle ment. Les libellés d'ancienneté
(`pausedAgo`, `doneAgo`…), eux, sont **dérivés de la vraie date de transition**.

Vérifié **en réel**, pas déclaré : registre semé sur disque, les trois cas exercés bout en bout par
`curl` à travers `pi-web` (200 avec données, 303 sans session, 502 harness éteint).


### Ce que le banc à deux machines a trouvé (2026-07-22)

Premier essai du lien hors boucle locale. Il a trouvé **deux défauts en quelques minutes**, que 923
tests unitaires ne pouvaient pas voir — ils ne vivent que face à un vrai `WebSocket`.

**1. Le backoff ne montait jamais.** `new WebSocket(url)` ne rejette **jamais** : le constructeur
rend la main avant que la connexion aboutisse. Un connecteur `Promise.resolve(new WebSocket(...))`
réussissait donc toujours, serveur éteint compris — et un succès remet le compteur de tentatives à
zéro. Mesuré, Pi éteint : **~2 tentatives par seconde indéfiniment**, au lieu d'une toutes les 10 s.
Corollaire plus grave que le martèlement : `etat()` passait par `'ouvert'` à chaque essai raté, et
`etat()` est la source de `pcOnline` — **l'interface aurait affirmé « PC en ligne » par
intermittence toute la nuit**.

**2. Le correctif du n°1 a cassé le refus d'authentification.** Le serveur ferme en 4401 dans son
propre handler `open` : côté client, le `close` peut donc précéder l'`open`. N'attendre que `open`
faisait disparaître la taxonomie terminale — secret refusé = coupure transitoire retentée sans fin,
sans jamais nommer sa cause. Puis, en corrigeant ça, `error` **et** `close` planifiaient chacun une
reconnexion : **211 tentatives en 60 s au lieu de 9**.

`☠` **L'enseignement, plus transférable que les deux correctifs** : une correction peut aggraver le
défaut qu'elle vise, et le vert ne le dira pas. Chaque étape a été remesurée sur les vraies machines
— c'est la seule chose qui l'a montré.

**Les cinq cas, code final, un seul client :**

| Cas | Résultat |
|---|---|
| Connexion nominale | `ouvert`, 0 supersede |
| Pi éteint | **9 tentatives / 60 s** (contre ~120 avant) |
| Pi revenu | reconnexion seule, aucune intervention |
| PC éteint | le Pi le voit en **< 5 s**, `pcOnline` = `false` |
| Mauvais secret | sortie **78**, **0** reconnexion |

`⚠` **Découvert au passage, non corrigé** : deux clients PC simultanés produisent une **tempête
d'évictions** — chacun chasse l'autre en boucle (**1268 supersedes** observés). La v1 suppose un
seul PC, mais un process resté vivant après un redémarrage de service suffirait à la déclencher.
Le `supersede` n'a aucun amortissement. À traiter avant tout déploiement durable.

### EN PRODUCTION depuis le 2026-07-22 (nuit)

| Machine | Service | Rôle |
|---|---|---|
| Pi | `ccremote-harness` | registre + API web (`127.0.0.1:8722`) + serveur du lien (`0.0.0.0:8721`) |
| Pi | `ccremote-web` | interface, `ccremote.exemple.com` |
| PC | `ccremote-pc` (`systemd --user`, linger) | client du lien, reconnexion automatique |

Secret du lien : `~/.ccremote-lien-secret` sur le PC (600), `/home/pi/ccremote-harness/.env` sur le
Pi. **Le même des deux côtés** — en régénérer un couperait le PC en silence.

Déploiement : `./deploy-harness-pi.sh` (control plane, exige `CCREMOTE_LIEN_SECRET`) puis
`./deploy-web-pi.sh` (interface).

`☠` **La session orchestrateur est OPT-IN** (`CCREMOTE_PI_ORCHESTRATEUR=1`). Elle consomme du quota
en continu et exige des credentials Claude valides sur le Pi — ceux présents datent du 2 juillet et
les refresh tokens tournent, donc un `/login` humain est nécessaire. Tout le reste (parc, escalades,
pilotage) fonctionne sans elle : les coupler ferait tomber le produit entier sur un login expiré.

`☠` **Le lien passe par le LAN**, pas par Cloudflare : les deux machines sont sur le même réseau,
ce qui évite un aller-retour par un service externe. Conséquence à connaître — **le pilotage hors du
réseau local n'est pas prouvé**, la voie tunnel n'a jamais été exercée.

### ☠ CE QUI EST ENCORE DE LA DÉMONSTRATION À L'ÉCRAN (2026-07-23)

Question posée par Chris, réponse mesurée dans `pi-web/static/harness-api.js` :

| Écran | Réel ou démo |
|---|---|
| Parc, escalades, comptes/quotas | **RÉEL** (registre du control plane) |
| Écritures : instruction, pause, reprise, fin, verdict d'escalade | **RÉEL** (jusqu'au superviseur) |
| **Conversation orchestrateur** (message + réponse) | **DÉMO** |
| **Jauges de l'orchestrateur** : « contexte 23 % », « fin de fenêtre 17:00 », « 13,25 $ » | **DÉMO** |
| Vues Mission / Agent : `subagents`, `feed`, `inspection` | **DÉMO** (vivent sur le PC) |
| `getModels` (liste des modèles et niveaux d'effort) | **DÉMO** |

La réponse « Reçu (claude-sonnet-5 · medium). Si ça implique de dispatcher une équipe… » est une
**chaîne codée en dur** dans `sendOrchestratorMessage`. Le fil disparaît au rafraîchissement parce
qu'il ne vit qu'en mémoire du navigateur : ce n'est pas un bug à corriger, c'est la démo qui se
comporte comme une démo.

`⚠` **Les chiffres de quota affichés dans la vue Orchestrateur sont donc faux.** Les VRAIS quotas
sont ceux de la vue Comptes, servis par le registre — à 0 % tant qu'aucune session ne les a
mesurés (l'API d'usage du SDK exige une session vivante).

### ☠ ÉTAT AU 2026-07-23 (nuit) — ce qui marche, ce qui reste

**EN PRODUCTION, RÉEL et vérifié :**
- Lien Pi↔PC de bout en bout (2 bugs transport corrigés : émission avant branchement `97481a4`, compteur de réception persistant `a455900`).
- Parc, escalades, comptes/quotas : servis par le vrai registre.
- Écritures : instruction, pause, reprise, terminaison, verdict d'escalade (`3467ead`).
- **Conversation orchestrateur RÉELLE** (`23f91aa`) : message → vraie session Claude sur le Pi → réponse. Testé « dis OK » → « OK ».
- Jauge de contexte : vraie sentinelle (`contextPct` mesuré, `null` → « — » si pas encore échantillonné).
- Comptes garantis au boot du service (`CCREMOTE_PI_COMPTES`, idempotent, plus de course WAL) : `compte-a`, `compte-b` survivent à tout déploiement.

**⚠ SOUCIS / MOCK RESTANTS sur la page Orchestrateur et ailleurs :**
1. **Jauges « Fin de fenêtre » et « $ consommés » = non mesurées.** Elles affichent « non mesuré ». Dépendent de la CHAÎNE DE QUOTAS qui n'existe pas (voir point 2). C'est LE prochain chantier, demandé par Chris.
2. **Chaîne des quotas 5h/7j INEXISTANTE.** `releverQuota` appelée par aucun code de prod, `ObservateurUsage` jamais fourni (7ᵉ « branché sur rien »). Les jauges de compte resteront à 0 % — alors que compte A est réellement >70 % sur 7j. PLAN validé, mesure commencée puis interrompue : un releveur périodique (toutes les qq minutes) qui lit l'usage au message `init` d'une session SDK courte, l'INTERROMPT aussitôt (coût quasi nul, pas de génération), et pousse au registre. L'usage EST disponible à `init` (vérifié dans `acceptation/multi-comptes-reel.ts`). Script de mesure : `scratchpad/mesure-usage.ts`.
3. **`compactOrchestratorContext` non câblé** : le bouton « Compacter » affiche « non disponible ». À câbler sur une vraie compaction de session.
4. **Encore MOCK dans `harness-api.js`** : `getModels`, `getAgent`, `proposeMandate`/`approveProposal`/`rejectProposal` (dispatch de mission), `runInspection`, `simulate*`. Les vues Mission/Agent restent en démo (sous-agents/feed vivent sur le PC, pas remontés).
5. **Dispatch de mission depuis l'orchestrateur** : `proposeMandate`/`approveProposal` sont mock — l'orchestrateur RÉPOND mais ne peut pas encore réellement créer une équipe via l'UI.

**Ce qui n'a jamais été éprouvé :** le tunnel Cloudflare (lien en LAN direct), un vrai redémarrage machine (boot_id jamais changé), la tempête d'évictions à 2 clients PC (1268 observées, non corrigée).

### ✅ LIVRÉ 2026-07-23 (suite) — orchestrateur MULTI-CONVERSATIONS + STREAMING + persistance

Refonte demandée par Chris : streaming réel, balises `think` affichées, commentaires d'outils
pendant la génération, persistance qui survit au **hard-reload**, et **plusieurs conversations**.
Décision de Chris (AskUserQuestion) : **sessions indépendantes, type ChatGPT** — chaque fil = sa
propre session Agent SDK, contexte isolé, `session_id` persisté pour reprise. Commit `f590056`.

**Architecture (le store serveur sert 3 besoins à la fois : persistance, substrat de streaming, historique par fil) :**
- Migration 2 : tables `conversation` + `conversation_evenement` (`seq` AUTOINCREMENT = curseur de streaming ET point de reprise après rechargement dur).
- `registre/conversations.ts` — `DepotConversations` (CRUD + journal, écrire un événement bouge `maj_a` dans la même transaction).
- `orchestrateur/collecteur-conversation.ts` — éclate chaque message SDK en événements typés : `reflexion` (thinking), `outil` (tool_use), `texte`, `resultat`, `erreur`. Ne lève jamais.
- `orchestrateur/gestionnaire-conversations.ts` — N sessions **LAZY** (aucune au boot, une par fil au 1er message ; le quota ne brûle que quand on écrit). Une boucle de lecture UNIQUE par session → sentinelle + collecteur. Reprise via `session_id` après fermeture/redémarrage.
- API : `GET/POST /orchestrator/conversations{,/{id}{,/events?since=,/message,/rename,/archive}}`. `POST message` NON bloquant (enfile puis rend la main ; la réponse remonte par sondage `/events`).
- Frontend : barre de conversations (chips + « Nouveau »), rendu **streaming incrémental** (polling 600 ms), blocs de réflexion **repliables** (`<details>`), puces d'outil, curseur ; `localStorage` retient le fil ouvert.

**Vérifié EN PROD, réel :** create → list → detail → events sérialisés (test loopback Pi) ; puis
**Chris lui-même sur la page live** : « test » → session SDK démarrée → « Je te reçois, Chris. Parc
opérationnel… » streamé de retour. Chaîne complète navigateur → Cloudflare → pi-web → proxy POST →
API → gestionnaire → vraie session SDK → polling. **965 tests verts, typecheck propre.**

**Ce qui reste sur cette page (ordre de priorité) :**
1. **`contextPct` revient `null`** sur les sessions courtes (la sentinelle n'a pas encore de mesure). Lié à la chaîne de quotas encore inexistante (voir ci-dessus, point 2). Affiché « — » honnêtement.
2. **Streaming au niveau BLOC**, pas token-par-token. Chaque bloc (réflexion/texte/outil) apparaît entier. Le token-par-token exigerait `includePartialMessages: true` + coalescence serveur. Suffisant et robuste sur le transport multi-sauts ; raffinement possible.
3. **Rendu réflexion/outil non vu avec une vraie réponse à raisonnement** (les prompts de test « OK »/« test » n'en produisent pas). Logique d'extraction **couverte par tests unitaires** fidèles aux formes de bloc SDK. Chris le verra sur une vraie tâche d'orchestration.
4. **Dispatch de mission** (`proposeMandate`/`approveProposal`) toujours mock + DOM-only (ne persiste pas par fil).

### ✅ RÉSOLU — le lien de contrôle Pi↔PC fonctionne de bout en bout (2026-07-23)

Deux bugs de transport trouvés par sonde entre les vraies machines, corrigés et vérifiés en prod :

1. `97481a4` — le Pi émettait ses requêtes AVANT d'avoir branché sa socket
   (`surConnexionAcceptee` appelé trop tôt) ; `#envoyer` abandonnait la trame en silence. Corrigé :
   rattachement signalé après ouverture réelle + `#envoyer` journalise tout abandon.
2. `a455900` — `CanalDonnees.#seqAttendu` persistait sur le Pi entre les reconnexions, alors que
   chaque PC neuf redémarre sa séquence à 0 ⇒ toute trame post-premier-échange jetée comme doublon
   (`seq 0 < seqAttendu`). Corrigé : `reinitialiserReceptionSiPairNeuf()` au rattachement, en
   `perte_silencieuse` seulement (le canal D.1 strict garde son rejeu).

Vérifié : réconciliation exécutée, zéro `ErreurDelaiCorrelateur`, sur deux cycles de reconnexion.

`☠ ENSEIGNEMENT` — le modèle client/serveur de H-75 (pair reconnecté = instance neuve) casse
l'hypothèse de connexion continue du transport symétrique hérité de D.1. Tout état de séquence
côté serveur doit se réinitialiser à chaque rattachement.

### ACTION SUIVANTE

1. **Le chemin d'ÉCRITURE** — instruction, pause/reprise, arrêt d'urgence, résolution d'escalade.
   C'est ce qui manque pour que l'interface pilote au lieu d'observer. `☠` Ces ordres traversent le
   lien vers le PC : une route à moitié câblée est **pire qu'absente**, l'interface croirait l'ordre
   passé. Chacune veut son banc d'assemblage avant d'être exposée.
2. **Remonter `subagents` / `feed` / `inspection` du PC vers le Pi** — c'est ce qui rendrait les
   vues Mission et Agent réelles ; elles sont encore en démo.
3. ~~Exercer le lien pour de vrai~~ — **FAIT le 2026-07-22** entre ce PC et le vrai Raspberry Pi
   (`acceptation/lien-deux-machines-{pi,pc}.ts`). Deux défauts trouvés et corrigés, cinq cas
   vérifiés. Voir la section « Ce que le banc à deux machines a trouvé » plus bas.
   `⚠` Reste non éprouvé : le passage par **Cloudflare Tunnel** (le banc était en LAN direct) et un
   vrai **redémarrage machine** (les process ont été tués, la machine n'a pas rebooté — donc le
   `boot_id` n'a jamais changé pendant le banc).
4. Dettes restantes : voir `../TODO.md` (fenêtre de grâce n°2a, `reponse-reinitialize.ts` code mort,
   M-51 à recâbler sur `rate_limit_event`).

### L'architecture est tranchée : lire H-75 avant de toucher au transport

`Upgrade/16-decisions-operateur.md`, **H-75**. En résumé : **le Pi héberge, le PC est client**, un
seul lien, `server/server.py` en `127.0.0.1` appelé localement par le harness. Objectif
d'exploitation, mot de Chris : *« j'éteins le PC, je vais me coucher, je le relance le lendemain :
tout doit se reconnecter parfaitement tout seul. »*

`☠` **Le piège qui casse ce scénario** est corrigé mais mérite d'être connu : `(pid, starttime)` ne
survit pas à un redémarrage (`starttime` compte depuis le boot). Sans `boot_id`, le harness croirait
un worker mort encore vivant — worktree bloqué chaque nuit — ou signalerait un process étranger.

### État de l'interface

Les vues du harness sont **réellement intégrées** à `pi-web/` (routeur, modules, template servis par
la vraie app FastAPI) — ce n'est pas une maquette posée à côté. Les **lectures** (parc, escalades,
comptes) viennent maintenant du vrai registre ; les **écritures** et les vues Mission/Agent restent
en démo, et le mélange est explicité en tête de `harness-api.js`. Le contrat des 27 endpoints :
**`pi-web/CONTRAT-API-HARNESS.md`**, et il fait foi des deux côtés. Tout accès passe par
`pi-web/static/harness-api.js` — point unique de branchement.

`⚠` Ce qui reste réel et fonctionnel dans l'app : statut PC, réveil, extinction, sessions tmux,
agent conversationnel, login. **Ne pas toucher à la logique du bouton d'extinction** — irréversible,
et déjà noté comme non re-testé en réel.

### Ce qui ne s'assemble pas encore

Le harness **n'est pas exécutable de bout en bout** en déploiement Pi/PC séparé ; le mode colocalisé,
lui, s'assemble. Détail dans `harness/ARCHITECTURE.md` et `TODO.md`.

### Puis : les dettes restantes
Voir `../TODO.md`, registre en tête de fichier.

---

## Historique — clôture du MVP (2026-07-22, journée)

*Écrit le 2026-07-22, juste avant une compaction de conversation.*

### 1. VÉRIFIER D'ABORD : un agent tournait au moment de la compaction

**M-50 (client temps réel) était EN VOL.** Avant toute chose :

```bash
cd /mnt/projects/ccremote/harness
git status --short          # M-50 écrit-il ? (dossier neuf sous harness/)
bun run typecheck && bun test
git log --oneline -3
```

Base de référence au moment de la compaction : **698 tests verts**, dernier commit `2d81183`.
`☠` **Ne rien refaire à l'aveugle** — vérifier sur disque ce qui a abouti. Un plan en mémoire ne
prouve pas qu'il n'a pas déjà été exécuté.

Si M-50 a livré : relire son code (pas son rapport) sur **deux points qui décident de sa qualité** —
(1) la divergence flux/store est-elle réellement **visible**, jamais lissée ? (2) le high-water mark
évite-t-il le rejeu complet ?

### 2. PUIS : lancer M-53, qui clôt le MVP

**M-53 est la seule mission autorisée à déclarer le harness terminé.** Périmètre : les cinq
propriétés de `03-couche-1.md` — non-blocage, isolation, reprise, modularité, bornage. Un test par
propriété.

`⚠` Lui passer **le registre des dettes** (`../TODO.md`) : une propriété « isolation » validée sur un
`RegistreWorkers` **en mémoire** ne vaut que tant que le superviseur PC ne redémarre pas. Ça doit
figurer dans sa validation, pas être découvert après.

### 3. ENSUITE : la dette n°1, priorité explicite de Chris

**Persistance du registre de workers côté PC.** Voir `../TODO.md`, section « REGISTRE DES DETTES ».
C'est la seule dette restante capable de **détruire du travail en silence**.

### 4. APRÈS le MVP : H-70, H-71, H-72 (décidées, spécifiées, non implémentées)
Atterrissage avant saturation de quota · choix modèle/raisonnement dans le fil · jauges 5 h/7 j par
compte et navigation par sous-agent. Spécification complète dans `../Upgrade/16-decisions-operateur.md`.
Maquette correspondante déjà produite : `../design-v3/index.html` (à faire valider par Chris).

---

## Brief type pour un subagent — celui qui a fonctionné toute la journée

- socle imposé : `01`, `02`, `03`, **`16`** (fait autorité) + **un seul** fichier de branche
  + `15-grille-revue.md` + `rules/code-standards.md`
- ☠ **jamais le paquet complet** — c'est ce qui évite l'explosion de contexte et le hors-périmètre
- interdiction explicite de lancer un test E2E ou une session Claude Code réelle — **le subagent
  produit, le parent valide** (les bancs `acceptation/` sont le travail du parent)
- « une `⚠ HYP` constatée fausse ⇒ remonter, ne pas improviser »
- « tout `☠ CASSE` de ta branche a un test associé »
- rappel du compte de tests à ne pas casser
- `☠` **en parallélisme, interdire `git stash` / `git checkout` / `git reset`** : ces commandes
  retirent aux autres agents leurs fichiers sous les pieds. Pour vérifier si un échec préexiste,
  lire la version commitée via `git show HEAD:<chemin>`, sans toucher au disque.
- `☠` **prévenir qu'un typecheck rouge peut venir d'un autre agent** : vérifier le chemin du fichier
  fautif avant de conclure sur son propre travail
- `☠` **aucun interrupteur de simulation de panne dans un module de production** — un interrupteur
  capable de produire la panne est lui-même la panne
- **lancer en `model="sonnet"`** (demande de Chris, coût)
- **côté parent** : commit **sélectif** tant qu'un agent tourne (`git add <chemins>`), jamais
  `git add -A` — sinon on emporte son travail en vol dans un commit qui n'en parle pas

Correspondance mission → fichier de branche : tableau de `../Upgrade/12-graphe-dependances.md`.

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
| Un interrupteur de simulation de panne dans un module de production | **l'interrupteur est la panne.** Vécu le 2026-07-22 : M-30 avait ajouté `simulerPanneOrphelinIgnore` pour tester la panne #11 — retiré. Un invariant se teste sur le **seul chemin qui existe**, pas en codant un chemin qui le viole |
| `git add -A` **côté parent** pendant qu'un agent écrit | emporte son travail en vol dans un commit qui n'en parle pas, sans relecture. Vécu le 2026-07-22 (commit `01617ea`, code cohérent a posteriori mais message trompeur). ⇒ **commit sélectif tant qu'un agent tourne** — la règle vaut aussi pour le parent |
| `git stash` dans un subagent pendant que d'autres agents écrivent | **retire leurs fichiers sous leurs pieds** : l'écriture suivante part d'un état incohérent, ou le travail disparaît. Vécu le 2026-07-22 (rattrapé de justesse, stash bien restauré). ⇒ **interdire explicitement `git stash`/`checkout`/`reset` dans tout brief lancé en parallèle** ; pour isoler un doute, lire le fichier commité via `git show HEAD:<chemin>` |
| Attribuer à sa propre mission un typecheck rouge en parallélisme | les erreurs viennent souvent du dossier d'un **autre** agent en vol. Vérifier le chemin du fichier fautif avant de conclure |
| Un « pire cas sûr » posé dans un `catch`, sur un exécuteur qui **ne lève pas** | **le catch est du code mort.** Vécu le 2026-07-22 : `executer()` avalait l'échec de `git` et rendait `stdout: ''` ; `aTravailNonCommite` lisait ça comme « rien à sauver » et **envoyait le worktree à la suppression**. Seul `git worktree remove` (qui refuse un `.git` manquant) a évité la perte. ⇒ vérifier le **code de sortie**, pas seulement l'exception. Banc : `acceptation/worktree-git-reel.ts` |
| Un niveau d'`effort` invalide passé au SDK | **silencieusement ignoré, jamais rejeté.** Mesuré le 2026-07-22 : `effort: 'ultra'` (inexistant) rend `is_error: false`, `terminal_reason: 'completed'` — le tour se déroule comme si de rien n'était, au niveau par défaut. ⇒ valider contre `supportedModels()[].supportedEffortLevels` **avant** l'appel : le SDK ne le fera pas. Niveaux réels : `low \| medium \| high \| xhigh \| max`, **`max` est le maximum** |
| Attendre le message `init` avant d'avoir envoyé quoi que ce soit | **mesuré le 2026-07-22 : le SDK n'émet `init` qu'APRÈS le premier message utilisateur.** Un démarrage qui bloque sur `init` avec un flux d'entrée silencieux ne démarre **jamais** (constaté sur `demarrerOrchestrateur`, 60 s de timeout). `startWorker` y échappe parce qu'il passe un prompt initial. Sonde : `scratchpad/sonde-init.ts` |
| Attendre un `SDKPermissionDeniedMessage` pour tracer un refus | **mesuré le 2026-07-22 : il n'est JAMAIS émis** sur un refus par `disallowedTools` en `auto`. Le seul signal réel est le **`tool_result` avec `is_error: true`** portant le texte du refus, dans un message `user`. Un audit qui n'écoute que le message `system` compte 0 refus alors qu'il y en a eu |
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

`☠` **Isoler le compte isole AUSSI toute la config.** Constaté le 2026-07-22 : un dossier de compte
fraîchement authentifié n'a ni `CLAUDE.md`, ni `settings.json`, ni `skills/`, ni serveurs MCP. Un
worker lancé dessus perdait donc les standards de code **et** Playwright/CodeIndex — alors que H-52
exige qu'un lead fasse ses tests E2E avec les MCP. Le pré-vol de M-01 l'a détecté et a refusé de
spawner (`machine_claude_md_missing`) : le garde-fou B.1.2 a fonctionné.

⇒ Correctif appliqué : **liens symboliques** de `~/.claude/{CLAUDE.md,settings.json,rules,skills,
commands,plugins}` vers chaque `~/.claude-comptes/<compte>/`. On isole ce qui est propre au compte
(credentials, sessions, transcripts), on partage ce qui est commun (config, outils). À refaire pour
tout nouveau compte ajouté.

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

**Quotas et identité — vérifiés en réel le 2026-07-22**, deux comptes en parallèle
(`acceptation/multi-comptes-reel.ts`, banc rejouable) :

- `accountInfo()` → `{ email, organization, subscriptionType, apiProvider }`. **L'e-mail identifie le
  compte de façon fiable** : `compte-a` = `compte-a@exemple.fr`, `compte-b` = `compte-b@exemple.fr`.
  C'est la source d'identité pour la rotation — ne pas se fier au nom du dossier.
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` → `utilization` **bien présent**
  (0-100) par fenêtre `five_hour` / `seven_day`, plus `resets_at`. ⚠ ALPHA → isoler derrière une
  couche d'adaptation.
- ☠ **Ces méthodes doivent être appelées PENDANT que la session vit.** Après le message `result`, le
  transport est fermé et tout appel échoue en `ProcessTransport is not ready for writing`. Piège
  réellement payé.
- ☠ **Les fenêtres 5 h ne sont PAS synchronisées entre comptes** (mesuré : reset 15:00 vs 13:29). Un
  compte saturé n'implique donc rien sur l'autre — c'est ce qui rend la rotation utile. Corollaire
  pour H-63 : la jauge doit être **par compte**, avec son propre `resets_at`.
- `limit_dollars` / `used_dollars` / `remaining_dollars` sont **`null`** sur abonnement : la seule
  mesure exploitable est le **pourcentage**, jamais un montant. Confirme H-58/H-68.

`⚠` **`extra_usage` est ACTIF sur les deux comptes** : au-delà du quota d'abonnement, la
consommation bascule sur des crédits payants en euros (mesuré : 11,83 € et 10,63 € sur 70 €/mois).
Un parc autonome peut donc dépenser de l'argent réel **sans passer par l'API**. À arbitrer par Chris
— voir `TODO.md`.

Ne **pas** s'appuyer sur le message `init` : ses champs de quota sont revenus `null` en test.


---

## ▶ SESSION DU 23/07 (nuit) — état réel à la reprise

**Tout est déployé et commité.** Trois services actifs : `ccremote-harness` +
`ccremote-web` (Pi), `ccremote-pc` (PC, `systemd --user`). 972 tests verts.

`☠` **Redémarrer LES DEUX daemons après tout changement de protocole.**
`deploy-harness-pi.sh` redémarre le Pi ; le PC ne l'est JAMAIS automatiquement
(`systemctl --user restart ccremote-pc`). Un PC resté sur l'ancien protocole
échoue côté distant, en silence — vécu deux fois cette nuit.

### Livré et VÉRIFIÉ EN PROD

| Sujet | Preuve |
|---|---|
| Streaming token par token de l'orchestrateur | texte 33→128→208→784 car. observé en cours de génération |
| Multi-conversations (sessions SDK indépendantes) | fils créés/repris/archivés, persistance au hard-reload |
| Compaction (`/compact`, bouton, outil MCP) | résumé dense produit, session neuve répond juste sur les contraintes d'avant |
| Rendu Markdown des réponses | réutilise `renderMarkdown` (marked+DOMPurify) de chat.js |
| Validation des mandats (H-61) | proposition persistée → carte → refus effectif |
| Dispatch réel d'une équipe | worker observé (PID, cwd, budget) sur `/mnt/projects/vela` |
| Modèle + effort du lead | ligne de commande : `--model claude-opus-4-8` + `effortLevel:"high"` ; imposé : `claude-sonnet-5`/`medium` |
| Télémétrie PC→Pi | **contexte 6 % et modèle résolu observés à l'écran** |
| Rotation de compte (master) | « spend limit » détecté → bascule loguée → contexte reporté |
| `explorer_projets` | 69 projets listés, échappement de racine refusé |

### ▶ PROCHAIN FIX — demandé par Chris le 23/07 (dans cet ordre)

**A. Remonter le FIL DE LA MISSION** (« 0 évènements » alors que l'équipe
travaille). Le PC lit déjà tout le flux et `CollecteurTelemetrie.derniereActivite`
capte le dernier texte — mais rien n'expose la suite des événements. Il faut un
journal borné par mission côté PC (outils appelés, textes, autorisations),
transporté par l'opération `telemetrie` et servi à la vue Mission.
`☠` H-45 : jamais le flux BRUT dans le contexte de l'orchestrateur — c'est une
vue pour l'humain, pas une entrée de modèle.

**A bis. Le master ne retrouve PAS une équipe terminée** (signalé 23/07 — cause
vérifiée dans le code, pas supposée) :
- `listerEquipes` appelle `registre.missions.listerActives()` : dès qu'une équipe
  se termine, elle SORT de la vue de l'orchestrateur. Il répond alors « aucune
  équipe » sur un travail qui vient de s'achever.
- `etatEquipe(missionId)` n'accepte QUE l'identifiant. Donner un nom ou un projet
  ne mène à rien, et l'identifiant n'est affiché nulle part de façon copiable.

Correctifs à faire ensemble, sinon le trou reste :
1. `lister_equipes` doit inclure les terminées récentes (`listerRecentes`), avec
   leur état — une équipe finie reste consultable.
2. Permettre de désigner une équipe par NOM ou PROJET, pas seulement par id
   (soit `etat_equipe` tolérant, soit un outil `trouver_equipe`).
3. Vue Mission : afficher l'ID COMPLET avec un bouton copier (aujourd'hui il
   n'apparaît qu'en en-tête, tronqué et non copiable) — c'est ce que Chris doit
   pouvoir coller à l'orchestrateur.

**B. Faire apparaître les SOUS-AGENTS.** La vue ne montre que « Team leader », ce
qui laisse croire qu'il n'y en a aucun. `forwardSubagentText` et
`agentProgressSummaries` sont déjà activés pour les workers ; `observabilite/`
sait construire l'arbre. Rien ne le remonte au Pi.

**C. Vérifier le % de contexte, jugé suspect par Chris** (10 % affichés très tôt).
Piste la plus probable, à mesurer avant de corriger : `getContextUsage()` rend un
`totalTokens` qui INCLUT le prompt système, les définitions d'outils, CLAUDE.md
et les skills — 100 K de socle sur une fenêtre 1 M donnent bien 10 % sans qu'un
seul tour n'ait eu lieu. Si c'est confirmé, ce n'est pas un bug mais un affichage
trompeur : montrer le socle à part, ou compter à partir de la conversation.
`☠` Ne PAS se rabattre sur le champ `percentage` du SDK — son échelle n'est pas
documentée, décision déjà prise (M-42).
`⚠` Vérifier aussi `maxTokens` vs `rawMaxTokens` : le collecteur retient
`maxTokens`, et l'écart entre les deux n'a jamais été mesuré.

### ⚠ NON RÉSOLU / NON PROUVÉ — à reprendre ici

1. **Fil de la mission VIDE** (« 0 évènements »). La télémétrie remonte l'état,
   le modèle et le contexte, mais PAS le flux d'activité. `derniereActivite` est
   collecté côté PC et jamais exposé. C'est ce qui donne l'impression que rien ne
   bouge. **Prochain chantier évident.**
2. **Coût toujours à 0,00 $** — écrit seulement au message `result` ; jamais
   observé non nul. Non prouvé.
3. **L'index de rotation du master est EN MÉMOIRE** : au redémarrage du service
   il repart sur le compte A, saturé. À persister (les comptes du parc, eux, sont
   marqués `rejected` en base).
4. **Les deux comptes du Pi semblent au plafond mensuel** (`monthly spend limit`,
   pas une fenêtre 5 h → ne se réinitialise pas seul).
5. **Plancher de déni VIDE au dispatch** (`deniedToolPatterns: []`) : « lecture
   seule » n'est qu'une consigne au modèle, pas un verrou mécanique.
6. `harness-orchestrateur.js` dépasse 500 lignes (~640) — à découper.

### Pièges payés cette nuit (ne pas les repayer)

- `getSessionInfo` **n'est pas un test d'existence** (rend `undefined` aussi pour
  une session sans résumé) et son `dir` est le répertoire de PROJET, pas le
  `CLAUDE_CONFIG_DIR`. Vérifier le fichier de transcript à la place.
- **Une session appartient au compte qui l'a créée** : après rotation, la
  reprendre échoue (`No conversation found`). Oublier l'identité SDK.
- `rsync --delete --exclude '*.db'` **ne couvre pas `registre.db-wal`** — en WAL
  tout le contenu récent y vit. Perte de données réelle.
- Le conteneur d'une vue porte `data-view` : lui attacher un `click` re-rendait
  la vue à chaque clic (clignotement + sélection cassée).
- `includePartialMessages` était déjà actif : le streaming se lit dans les
  `stream_event`, pas dans les messages `assistant` complets.
- La limite de compte arrive en **texte assistant**, pas en message système.
- `epoch` codé en dur ⇒ `collision_meme_epoch` au 2ᵉ dispatch sur un projet.
- Un `WorkerSpec` **ne traverse pas le réseau** (ports d'audit/permissions) : le
  PC réassemble à partir de `ParametresSpecTransportables`.

---

## ▶▶ SESSION DU 23/07 (journée) — A, A bis et C livrés · jauges de quota branchées

*Tout ce qui suit est déployé en production et vérifié sur données réelles, pas sur des doublures.*
**1007 tests verts, typecheck propre. Dernier commit : `d96ecd4`.**

### Ce qui est FAIT (et qui ne l'était pas ce matin)

| Chantier | Ce qui bloquait réellement | Vérification |
|---|---|---|
| **A. Fil de la mission** | Le fil était rendu VIDE « par honnêteté », alors que deux sources persistées existaient déjà | 4 évènements réels sur une mission Vela terminée |
| **A. Fil enrichi** | Le collecteur ne lisait que les blocs `text` d'un message assistant et JETAIT `thinking` et `tool_use` | réflexions, outils et textes distingués à l'écran |
| **A bis. Équipe terminée introuvable** | `listerEquipes` n'appelait que `listerActives()` : une équipe SORT de la vue à la seconde où elle finit | désignation par id / nom / projet / fragment, ambiguïté refusée avec ses candidats |
| **C. % de contexte** | La ventilation rendue par le SDK était jetée ; seul `totalTokens` était gardé | mesuré sur `claude-sonnet-5`, détail dépliable en prod |
| **Mort d'un worker** | `reconcilier()` ne tourne QUE au démarrage et au rattachement — un worker mort en cours de route n'était vu par personne | mission passée en `terminee` au 1er passage du balayage |
| **État affiché** | `en_cours` + `etatSdk=idle` s'affichait « running » : rien ne tournait, l'écran disait l'inverse | `etatAffiche()` croise les deux autorités |
| **Rapport de l'équipe** | Aucun moyen de lire ce qu'une équipe avait PRODUIT | `rapport_equipe` rend le dernier TEXTE, entier |
| **Jauges de rate limit** | `releverQuota()` n'était appelé QUE pour marquer une saturation — l'usage courant n'était JAMAIS mesuré | sonde réelle : comptes à 100 % / 93 %, plan « Claude Pro » |
| **Auto-update de l'UI** | Aucune vue du parc ne se rafraîchissait ; il fallait recharger la page | diff ciblé + append, sans reconstruire le DOM |

### Migrations ajoutées (schéma en **version 8** en production)

| Version | Objet | Pourquoi |
|---|---|---|
| 6 | `mission.contexte_ventilation` (JSON) | distinguer le socle incompressible du travail réel |
| 7 | table `activite_mission` | ce que l'équipe PRODUIT, pas seulement ce qu'elle devient |
| 8 | `activite_mission.type` + `.outil` | réflexion / outil / texte ne se lisent pas pareil |

### FAITS MESURÉS (ne pas re-supposer — ça a coûté du temps)

**Contexte, relevé réel sur `claude-sonnet-5` :** `totalTokens` 34 718 = prompt système 263 +
outils 6 190 + CLAUDE.md 11 596 + skills 6 343 + messages 10 326. Le socle pèse donc **~24 K
avant le moindre échange**. Les postes **différés** (`isDeferred`, ~36 K d'outils MCP et système)
ne comptent **PAS** dans le total — les additionner ferait dépasser le réel de plus du double.

`☠` **`maxTokens` n'est pas comparable d'un modèle à l'autre** : 967 000 sur Sonnet, 1 000 000 sur
Opus. L'écart fait exactement 33 000 — le *buffer d'autocompact*, déduit dans un cas et pas dans
l'autre. **Deux jauges à « 10 % » ne désignent donc pas la même marge restante.**

`⚠` **Écart non expliqué** : sur une mission réelle, la somme des postes chargés (75 008) dépasse
le `totalTokens` annoncé (70 947) de ~4 061, alors qu'elle tombait au token près sur la mesure
locale. Hypothèse non prouvée : le CLI calcule le total en direct et les catégories depuis un état
légèrement antérieur. **Le total reste la référence** ; la ventilation sert à comprendre *où* ça
part, jamais à refaire l'addition.

**Quotas, relevés réels le 23/07 :** les deux comptes sont en **Claude Pro** (l'interface affichait
« Max » **écrit en dur dans le HTML**), compte A à 100 % / 93 %, compte B à 100 % / 46 %.

`☠` **`reset_a` est en MILLISECONDES epoch**, une seule convention, normalisée au point d'écriture
(`sonde-quotas.ts`). Elle a porté deux unités pendant quelques heures ⇒ « reset dans 495278229 h ».
Un test verrouille les deux sens : une erreur d'unité doit rester **visible** (« expirée »), jamais
produire un délai plausible.

### Décisions prises cette session (avec leur raison)

1. **H-45 dédoublé.** La règle protège le contexte de l'ORCHESTRATEUR, pas le droit de l'opérateur à
   lire son équipe : aperçu 240 car pour le master, **texte entier** pour le fil humain. *Décision de
   Chris, explicite.*
2. **`rapport_equipe` rend le dernier TEXTE, pas le dernier événement.** Le dernier événement d'une
   équipe est souvent un `Grep` — ça aurait donné « pattern=TODO » comme rapport final.
3. **Les entrées d'outils sont RÉSUMÉES** aux champs parlants (`command`, `file_path`, `pattern`,
   `query`, `url`). Dumper l'entrée complète mettrait un fichier entier dans le fil à chaque `Write`.
4. **Une fenêtre à 100 % marque le compte `rejected`** — sinon le prochain dispatch part droit dans
   un compte saturé (H-53). Effet de bord voulu : la rotation fonctionne enfin pour de bon.
5. **Une sonde de quota EN ÉCHEC n'écrit RIEN.** Un zéro écrit là ferait croire à un compte libre.
6. **Ventilation stockée en JSON** : donnée d'affichage, jamais critère de requête — une table
   dédiée coûterait une jointure pour rien.
7. **`activites()` prend les DERNIÈRES, pas les premières.** Sur une mission bavarde, la borne
   masquait exactement la synthèse de fin.

### `☠` RÈGLE POSÉE — mise à jour automatique de l'interface

**Un rafraîchissement automatique ne recharge JAMAIS le DOM complet.** Réassigner `innerHTML`
détruit et recrée tous les nœuds : clignotement, **saisie en cours effacée**, `<details>` refermés,
sélection annulée, défilement rejeté en bas. Forme correcte : empreinte → écriture ciblée par
`data-maj` → **append** des seuls éléments neufs → une seule minuterie liée à la vue visible,
suspendue sur `document.hidden`, non réentrante.

Écrit à trois endroits, exprès : `pi-web/CONTRAT-API-HARNESS.md` (section « RÈGLE ABSOLUE »),
`~/.claude/skills/code/SKILL.md`, et la mémoire `ui-auto-update-never-full-dom`.

### ▶ PROCHAIN CHANTIER — dans cet ordre

**B. Faire apparaître les SOUS-AGENTS** *(seul point de la liste du 23/07 qui reste entier)*.
La vue n'affiche que « Team leader », ce qui laisse croire qu'il n'y en a aucun.
`forwardSubagentText` et `agentProgressSummaries` sont déjà activés pour les workers, et
`observabilite/` sait construire l'arbre — **rien ne le remonte au Pi**. `subagents: []` est
délibérément vide dans `vue-missions.ts` : ne PAS le remplir avant d'avoir une vraie source.
`☠` H-72.4, déjà mesuré : le flux temps réel des sous-agents est **non déterministe** (0 à 4 lignes
sur 5 sous-agents lancés). La vérité sur « qui existe » doit venir du transcript
(`SessionStore.listSubkeys()`), pas du flux ; un sous-agent sans flux se rend avec
`feedUnavailable: true`, **jamais omis**.

**D. Élucider l'écart de 4 061 tokens** entre `totalTokens` et la somme des postes (voir plus haut).
Mesure à faire sur deux relevés successifs d'une même session vivante.

**E. Dettes connues, non urgentes :**
- `deniedToolPatterns: []` au dispatch — « lecture seule » n'est qu'une consigne au modèle, pas un
  verrou mécanique.
- L'index de rotation du master vit **en mémoire** : au redémarrage, il repart sur le compte A même
  s'il est saturé.
- `harness-orchestrateur.js` (~640 lignes) et `harness-mission.js` (330) — le premier dépasse la
  limite de 500.
- La sonde de quota ouvre une session CLI par compte toutes les 10 min. Coût mesuré négligeable,
  mais c'est un compromis à revoir si les comptes sont durablement saturés.

### Pièges payés cette journée (ne pas les repayer)

- **`getContextUsage()` ferme le transport au `result`** : l'appeler après ⇒ « ProcessTransport is
  not ready for writing ». Mesurer **pendant** que la session vit.
- **Un flux silencieux n'émet jamais `init`** : la sonde de quota DOIT envoyer un prompt non vide,
  sinon l'attente est un interblocage.
- **`env` REMPLACE l'environnement**, il ne le complète pas : sans `...process.env`, le PATH est
  perdu et le CLI est introuvable.
- **`mission.projet` est sous contrainte d'unicité** — un projet n'a qu'une équipe à la fois, ce qui
  rend la désignation par projet quasi toujours non ambiguë.
- **Un `flex flex-col` comprime ses enfants au lieu de scroller** : `overflow-y: auto` seul ne suffit
  pas, il faut `flex-shrink: 0` sur les enfants directs.
- **Le test qui encode l'ancienne convention** doit être RETOURNÉ, pas supprimé : celui de `reset_a`
  vérifie maintenant qu'une erreur d'unité reste visible.

---

# SESSION DU 23-24/07 (SOIRÉE → NUIT) — reprendre ICI

**État : EN PROD, commit `046ecce` + checkpoint `c84a9c3`, 1017 tests verts (31 échecs
PRÉEXISTANTS sur `control-plane/projets`, vérifiés identiques sur HEAD, sans rapport), schéma
registre `v12`.** Services actifs : `ccremote-harness` + `ccremote-web` (Pi), `ccremote-pc` (PC).

## ⭐ PROCHAINE PRIORITÉ — (F) l'orchestrateur ne peut pas LIRE les fichiers d'un projet

L'orchestrateur tourne sur le Pi ; le FS du PC ne lui est PAS monté. `explorer_projets` ne rend que
l'ARBORESCENCE — il voit que `src-tauri/` existe, il ne peut lire aucune ligne. Toute synthèse
« d'après le code » est donc AVEUGLE (l'orchestrateur l'a diagnostiqué lui-même, correctement, en
prod). **À faire** : un outil MCP de lecture de fichier via le lien Pi↔PC, mêmes bornes que
l'exploration (racine `/mnt/projects`, lecture seule, taille plafonnée). **Chemin de câblage déjà
tracé** — copier celui d'`explorer_projets`, désormais branché de bout en bout :
`superviseur-workers.ts::explorerProjets` → `canal-controle.ts` (op `explorer_projets`) →
`client-superviseur-pc.ts` → `serveur-api.ts`. Ajouter une op `lire_fichier` symétrique.

## Ce qui a été LIVRÉ cette session (11 correctifs, tous en prod)

1. **Quotas temps réel sans token ni PC** (`b6aa6fc`, migration 9). Sonde OAuth
   `GET https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) côté
   Pi, toutes les 20 s (`composition/pi/balayage-quotas.ts`). Le PC ne fournit plus que le jeton
   (`superviseur/jetons-comptes.ts`), persisté au registre → jauges vivent PC éteint ~8 h. `☠` La
   réponse OAuth est PLATE, pas enveloppée dans `rate_limits` (`superviseur/sonde-quotas-http.ts`
   ré-enveloppe). Aucun refresh hors du CLI (refresh tokens tournants).
2. **Sous-agents à l'écran** (`c482742`, migration 10). Lus sur le TRANSCRIT
   (`superviseur/sous-agents-disque.ts`), jamais le flux (non déterministe, H-72.4). `☠` Le CLI écrit
   `<configDir>/projects/<cwd→->/<sessionId>/subagents/agent-<id>.meta.json` porteur de
   `{agentType, description, toolUseId, spawnDepth}` — ce `toolUseId` EST le `parent_tool_use_id` du
   flux. `☠` `mtime` ne prime jamais sur l'horodatage du dernier message (sinon un fichier touché
   passe « actif »).
3. **Déploiement n'éteint plus l'orchestrateur** (`8a102d2`). `deploy-harness-pi.sh` réécrit `.env`
   en entier ; un opt-in absent de l'env de l'appelant retombait à sa valeur d'usine. Le script relit
   maintenant la valeur en place sur le Pi. `⚠` Les AUTRES opt-in du `.env` ne sont PAS revus (E-bis).
4. **`explorer_projets` câblé** (`bd3a0e7`). 7ᵉ « écrit, testé, branché sur rien ». Test d'ASSEMBLAGE.
5. **Clic sur un sous-agent → vrai fil** (`bd3a0e7`, migration 11). Route
   `GET /missions/{id}/agents/{agentId}`, doublure de démo supprimée.
6. **`result` ne tue plus la session** (`1dc52f2`). `☠` `result` = fin d'un TOUR, pas de la session
   (streaming input). Critère : `background_tasks_changed.tasks[]` — signal de NIVEAU, REPLACE, jamais
   d'appariement début/fin ; ensemble remis à VIDE à chaque `init`. `marquerMort` post-boucle gardé
   par l'identité du HANDLE (une relance réutilise le sessionId).
7. **Modèle/effort réels + attribués + mémorisés** (`56bf2aa`, migration 12). `☠` Le sélecteur ne
   pilotait RIEN : client n'envoyait pas les champs, route sœur les jetait, session sur sa constante.
   `setModel()` + `applyFlagSettings({effortLevel})`. Attribution PAR ÉVÈNEMENT, réglage mémorisé par
   conversation, restauré à l'ouverture (`detail()` DOIT rendre modele/effort — sinon UI aveugle).
8. **Cache-busting des assets** (`7a6fc05`). `pi-web/app.py::_version_statique()` = mtime max de
   `static/`, injecté `?v={{ v }}`. Règle remontée en global (`~/.claude/rules/`).
9. **Retour arrière sur une sur-correction** (`ad2795a`). J'avais gardé la session ouverte sur TOUTE
   fin normale (récit, pas mesure) → équipe `en_cours` à vie après synthèse rendue. La garde (6) suffit.
10. **Rotation de compte** (`d56634b`). `☠` « weekly limit » n'était détecté par aucun motif → règle
    extraite dans `shared/saturation-compte.ts` (source unique, était dupliquée). `☠` Index de
    rotation repartait à 0 au reboot → compte de départ choisi sur quota MESURÉ
    (`composition/pi/choix-compte-orchestrateur.ts`, lien config-dir⟷compte par l'EMAIL, inconnu ≠ saturé).
11. **Réconciliation ne ressuscite plus une équipe arrêtée** (`046ecce`). `☠ LE PIRE DÉFAUT` :
    arrêt à 18:53, réadoption à 18:55 (`orphelin_adopte`). Une transition terminale
    (`annulee`/`terminee`/`echec_definitif`) est une DÉCISION, pas une croyance périmée ; « le PC
    gagne » n'arbitre qu'une divergence d'OBSERVATION. Worker survivant sur mission terminale = RÉSIDU,
    tué. Branche d'adoption retirée (non-active ≡ terminale, donc code mort). H-56 en 409 (`ErreurProjetOccupe`)
    au lieu de 500.

## En suspens / à confirmer à la reprise

- **Mission Vela restée `en_cours`** — résidu du bug de résurrection (corrigé). La réannuler depuis
  l'orchestrateur devrait TENIR maintenant. À vérifier en premier.
- **Comptes** : A (compte-a) saturé 100 % hebdo jusqu'au **dimanche 26 juil. 21h**, tout passe
  sur B (compte-b, ~51 %).
- **Dette E** partiellement soldée : l'index de rotation n'est plus le problème (choix sur quota
  mesuré), mais `deniedToolPatterns: []` au dispatch reste vide (lecture seule = consigne, pas verrou)
  et `harness-orchestrateur.js` reste > 500 lignes.
- **(D)** écart ~4 061 tokens : toujours pas élucidé.

## Pièges payés cette session (ne pas les repayer)

- **La réponse OAuth d'usage est PLATE** (`{five_hour, seven_day, extra_usage}`), pas `{rate_limits:{…}}`
  comme le SDK. Passer la réponse brute à `extraireFenetres` ⇒ zéro jauge sur un HTTP 200, EN SILENCE.
- **`result` n'est PAS la fin de session** en streaming input — voir livrable 6. La croyance inverse
  était même écrite dans l'en-tête de `superviseur-workers.ts` (mesure d'un prompt unique, pas d'un
  générateur d'entrée).
- **Une règle métier dupliquée diverge en silence** : `MOTIFS_SATURATION` vivait dans 2 fichiers,
  tous deux périmés en même temps → rotation morte. Sources uniques dans `shared/`.
- **Une transition terminale ne se défait pas toute seule** : la réconciliation « PC gagne » arbitre
  une divergence d'observation, jamais un ordre. Sinon elle ressuscite ce que l'opérateur a arrêté.
- **`SQLITE_CONSTRAINT_UNIQUE` ne doit jamais atteindre l'opérateur** : une règle métier connue (H-56)
  se refuse en clair (409 + le geste à faire), pas en 500 « erreur interne ».
- **Un cache-busting manquant fait re-débugger du code déjà corrigé** : symptôme « déployé + testé +
  API juste, mais l'écran ne change pas » ⇒ grep `?v=` AVANT toute ré-investigation.
- **Mesurer avant de corriger une machine à états** : j'ai sur-corrigé deux fois sur du récit. Établir
  le fait sur un artefact réel (log/banc/row), avant ET après.
