# TODO — ccremote
*Dernière mise à jour : 2026-07-22*

## ⚡ Harness d'orchestration — chantier actif

**Contexte complet : `harness/REPRISE.md`, section « SESSION DU 23/07 (journée) » en FIN de fichier.**

### 🎯 EN COURS — priorités à la reprise (23/07 au soir)

- [x] **(B) Faire apparaître les SOUS-AGENTS** — LIVRÉ le 23/07 (`c482742`), lus sur le TRANSCRIT
      (migration 10). Le `agent-<id>.meta.json` du CLI porte `toolUseId` = `parent_tool_use_id` du
      flux : la corrélation flux ⟷ store existe sur disque. 5 sur 5 sur la session de mesure H-72.4.
      Reste le détail par agent, voir (B-suite) ci-dessus.

- [ ] ~~**(B) Faire apparaître les SOUS-AGENTS**~~ — *seul point de la liste du 23/07 encore entier.*
      La vue n'affiche que « Team leader », ce qui laisse croire qu'il n'y en a aucun.
      `forwardSubagentText` et `agentProgressSummaries` sont déjà activés côté workers, et
      `observabilite/` sait construire l'arbre — **rien ne le remonte au Pi**.
      `☠` `subagents: []` est délibérément vide dans `vue-missions.ts` : ne PAS le remplir avant
      d'avoir une vraie source. H-72.4 déjà mesuré : le flux temps réel des sous-agents est **non
      déterministe** (0 à 4 lignes sur 5 sous-agents). La vérité sur « qui existe » vient du
      transcript (`SessionStore.listSubkeys()`), pas du flux ; un sous-agent sans flux se rend avec
      `feedUnavailable: true`, **jamais omis**.
- [ ] **(E-bis) Revoir les AUTRES opt-in de `deploy-harness-pi.sh`** — le script réécrit `.env` en
      entier ; `CCREMOTE_PI_ORCHESTRATEUR` est corrigé (relu sur le Pi), les autres variables n'ont
      PAS été passées en revue. Même défaut possible : un déploiement de routine qui éteint un
      réglage sans un mot.
- [ ] **(B-suite) Le clic sur un sous-agent reste MOCK** — `getAgent` n'est pas câblé. Le fil PAR
      AGENT existe côté PC (`sous-agents-disque.ts` rend les activités) mais seule `derniereAction`
      est persistée au registre. C'est le « même niveau de détail que le lead » de H-72.1.
- [ ] **(B-suite) Rien n'est validé sur une équipe VIVANTE** — la télémétrie ne parcourt que les
      workers vivants ; les 5 sur 5 sont vérifiés sur transcripts d'archives, pas en direct.
- [ ] **(D) Élucider l'écart de ~4 061 tokens** entre `totalTokens` et la somme des postes chargés
      sur une mission réelle — alors qu'elle tombait au token près en mesure locale. À mesurer sur
      deux relevés successifs d'une même session vivante. **Le total reste la référence** en
      attendant ; la ventilation sert à voir *où* ça part, pas à refaire l'addition.
- [ ] **(E) Dettes ouvertes** — `deniedToolPatterns: []` au dispatch (« lecture seule » n'est qu'une
      consigne au modèle, pas un verrou) · index de rotation du master **en mémoire** (repart sur le
      compte A même saturé après un redémarrage) · `harness-orchestrateur.js` ~640 lignes.

### ✅ TERMINÉ — session du 23/07 (journée)

- [x] **(A) Fil de la mission** — rendu VIDE alors que transitions d'état et permissions étaient
      déjà persistées. Puis enrichi : le collecteur ne lisait que les blocs `text` et **jetait**
      `thinking` et `tool_use`. Migrations 7 et 8.
- [x] **(A bis) Équipe terminée introuvable par le master** — `listerEquipes` n'appelait que
      `listerActives()`. Désignation par id / nom / projet / fragment, ambiguïté refusée avec ses
      candidats, identifiant copiable dans la vue Mission.
- [x] **(C) % de contexte suspect** — la ventilation rendue par le SDK était jetée (migration 6).
      *Hypothèse d'origine invalidée par la mesure : le socle ne pèse que ~24 K, pas 100 K.*
- [x] **`rapport_equipe`** — le dernier TEXTE du lead, entier, jamais tronqué.
- [x] **Mort d'un worker en cours de route** — `reconcilier()` ne tournait qu'au démarrage et au
      rattachement ; le balayage télémétrie le déclenche désormais.
- [x] **État d'affichage honnête** — `en_cours` + `etatSdk=idle` s'affichait « running ».
- [x] **Jauges de rate limit réellement mesurées** — `releverQuota()` n'était appelé QUE pour
      marquer une saturation. Sonde côté PC, cache 10 min, unité `reset_a` unifiée en ms,
      heure de reset en AM/PM (+ jour pour la fenêtre hebdomadaire).
- [x] **Fin du « Max · oauth » écrit en dur** dans le HTML — les comptes sont en « Claude Pro ».
- [x] **Rafraîchissement temps réel des vues** — aucune ne se rafraîchissait. Diff ciblé + append,
      sans jamais reconstruire le DOM (règle posée en doc, skill et mémoire).
- [x] **Sidebar scrollable** en vue mobile.

## 🎯 OBJECTIF COURANT (priorités données par Chris, 2026-07-22 au soir)

1. ~~Communication PC↔Pi (H-75)~~ — **livrée et revue** (`6b91242`), 3 défauts corrigés.
2. ~~Câblage de l'interface~~ — **livré en LECTURE** (`9c695d2`, `b8d542f`) : parc, escalades et
   comptes viennent du vrai registre, à travers `pi-web` qui porte l'authentification.
3. ~~Le chemin d'ÉCRITURE~~ — **livré** (`3467ead`). Instruction, pause, reprise, terminaison et
   résolution d'escalade vont de l'écran jusqu'au superviseur. `ControleurPause` a enfin son
   premier appelant réel (6ᵉ occurrence du défaut « écrit, testé, branché sur rien »).
   `⚠` Reste : `arret_urgence` n'a pas de méthode sur `ClientSuperviseurPc` ⇒ la route répond 501.
4. **Remonter `subagents` / `inspection` du PC vers le Pi** — `feed` est **livré le 23/07** (fil réel :
   transitions, permissions, réflexions, outils, textes). Restent `subagents` (voir « EN COURS » en
   tête de fichier) et `inspection` (verdicts du juge H-68, rendus côté PC, jamais remontés).
4ter. ~~**Vue Orchestrateur entièrement en démo**~~ — **résolu** : la conversation est réelle depuis
   le 23/07 (nuit), et les jauges de quota sont **réellement mesurées** depuis le 23/07 (journée).
   `☠` La leçon reste : un chiffre faux non signalé est pire qu'un chiffre absent. C'est ce qui a
   fait retirer le « Max · oauth » écrit en dur dans le HTML des comptes.
4bis. ~~**Session orchestrateur sur le Pi**~~ — **active en production** (`CCREMOTE_PI_ORCHESTRATEUR=1`),
   avec deux comptes de repli locaux (`CCREMOTE_PI_CONFIG_DIRS_ORCHESTRATEUR`) et rotation vérifiée.
5. ~~Exercer le lien entre deux vraies machines~~ — **fait le 2026-07-22**, 2 défauts trouvés et
   corrigés (`3ff794c`). Restent non éprouvés : le passage par **Cloudflare Tunnel** (banc en LAN
   direct) et un **vrai redémarrage machine** (le `boot_id` n'a jamais changé pendant le banc).
6. `⚠` **Tempête d'évictions à deux clients PC** — découverte au banc, NON corrigée. Deux process
   PC simultanés se chassent en boucle : **1268 évictions** observées. Le `supersede` n'a aucun
   amortissement (ni délai, ni identité de client). **Priorité montée** : le service PC tourne
   désormais sous systemd, où un `restart` qui chevauche l'ancien process suffit à la déclencher.
7. Puis le reste des dettes ci-dessous.

## 🚀 EN PRODUCTION depuis le 2026-07-22

| Machine | Service | État |
|---|---|---|
| Pi | `ccremote-harness` | registre + API web (loopback) + serveur du lien (LAN) |
| Pi | `ccremote-web` | interface sur `ccremote.exemple.com` |
| PC | `ccremote-pc` (`--user`, linger) | client du lien, reconnexion automatique |

Cycle éteindre/rallumer vérifié en prod : `pcOnline` suit, sans intervention.

`⚠` **Ce qui serait encore faux de croire** : que tout est éprouvé. Les vues Mission et Agent
n'ont pas de source réelle (sous-agents et flux vivent sur le PC), la vue conversation attend un
`/login` sur le Pi, et le lien passe par le LAN — le tunnel Cloudflare n'a toujours jamais été
traversé, donc le pilotage hors du réseau local n'est pas prouvé.

## 📋 REGISTRE DES DETTES — état au 2026-07-22

*Classées par gravité réelle. Une dette n'est pas une tâche oubliée : c'est un endroit où le code
passe les tests sans faire le travail. Rien de ce qui suit n'apparaît dans le compte de tests verts.*

### ✅ DETTE N°1 — FERMÉE le 2026-07-22 (était la priorité explicite de Chris)
- [x] ~~Persistance du registre de workers côté PC~~ — le registre survit au redémarrage du
      superviseur (SQLite local, frontière A↔B respectée), chaque worker restauré est revalidé, et
      les concurrents restaurés participent au fencing.
      `☠` **Trois pièges payés pour la fermer, à ne pas réintroduire** :
      (1) le **pid seul ne prouve rien** (recyclage noyau) — c'est le couple `(pid, starttime)` ;
      (2) ce couple **ne survit pas à un redémarrage** (`starttime` compte depuis le boot) — d'où
      `boot_id`, voir **H-75** ; (3) le mécanisme était branché sur un `pid` que `WorkerHandle`
      n'exposait pas : correct, et inerte. Biais non négociable conservé : `indetermine` ne libère
      **jamais** un worktree.

### 🟠 DETTE N°2 — un garde-fou qui pourrait ne pas se déclencher
- [ ] **Fenêtre de grâce de l'arrêt d'urgence non alignée.** `GRACE_ARRET_URGENCE_MS_DEFAUT = 5000`
      a été choisi par défaut raisonnable, **sans vérification** contre `05-arbre-B` (hors périmètre
      de M-52). Trop court : on tue avant la fin d'une écriture. Trop long : le bouton d'urgence
      n'est plus urgent. À trancher sur mesure, pas au jugé.
- [x] ~~**Le drill d'arrêt d'urgence n'est branché sur aucun canari réel.**~~ — **FERMÉE le
      2026-07-22** : `arret-urgence/canari-process.ts` démarre un **vrai process**, le cible **par PID
      exact** (jamais par motif de commande), applique SIGTERM → grâce → SIGKILL, et **constate la mort
      par `/proc`** — jamais en se fiant au code de retour du kill. Un canari survivant fait échouer le
      drill (`sequence_incomplete`), il ne produit pas un faux succès. Isolation structurelle : le
      module n'importe rien de `superviseur/`, et tout `missionId` autre que le canari retourne
      `cible_absente` — un vrai `missionId` ne peut pas être atteint.
      `⚠` **Ce que le canari n'exerce pas** : la vraie séquence de production
      (`ControleurPause`, `interrupt()` SDK, `RegistreWorkers`, `abort()`) exige une session réelle et
      reste couverte par des doublures uniquement. La dette n'est pas fermée de ce côté-là.

### 🟡 DETTE N°3 — hypothèses non vérifiées sur le comportement réel du SDK
- [x] ~~**`pending_permission_requests` absent des types publics** (M-13)~~ — **TRANCHÉE le
      2026-07-22** sur le code du SDK lui-même (`sdk.mjs`), voir **H-73**. Verdict : **l'HYP était
      fausse**. Le SDK **consomme** ces demandes lui-même (`processPendingPermissionRequests`) et les
      **rejoue par le chemin `canUseTool`** — il ne les remonte jamais par la valeur de retour.
      ⇒ **Deux conséquences ouvertes, à traiter** :
- [ ] **`superviseur/reponse-reinitialize.ts` est du code mort à supprimer ou à réorienter.** Il rend
      toujours `[]`, ce qui est pire qu'une erreur : la réconciliation en conclut « rien en attente »
      et se croit à jour.
- [ ] `☠` **Que deviennent les demandes rejouées en `permissionMode: 'auto'` ?** La redélivrance passe
      par `canUseTool`, dont il est **mesuré** (H-64) qu'il n'est **jamais appelé** dans ce mode — celui
      que le harness utilise en production. Tant que ce n'est pas mesuré, la propriété « reprise » de la
      couche 1 reste conditionnelle. **C'est désormais le trou le plus sérieux de la dette n°3.**
- [ ] `⚠` **`pending_user_dialog_requests` totalement ignoré par le projet** — seconde famille de
      demandes en vol, frère documenté de la première.
- [x] ~~**Messages d'usage jamais vus en vrai** (M-51)~~ — **FERMÉE le 2026-07-22** par
      `acceptation/observabilite-5-sousagents-reel.ts`. `☠` Le message réel est un type à part
      entière, **`rate_limit_event`**, absent des types publics : il n'arrive **ni** par
      `SDKInformationalMessage.content` **ni** par `SDKNotificationMessage.text`, les deux canaux sur
      lesquels M-51 avait bâti sa classification. ⇒ **M-51 doit être recâblée sur ce type** :
      aujourd'hui elle ne verrait jamais passer une vraie limite. Forme exacte en H-63.1.
- [ ] **Contexte du parent à cinq sous-agents : non mesuré** (H-72.3). Vérifié sur **un** sous-agent
      (inchangé) ; à cinq, la lecture a échoué à cause du piège `getContextUsage()` dans la boucle.
      À refaire avec un protocole qui lit le contexte **hors** de la boucle.
- [x] ~~**Niveaux d'effort réels d'`opus-4-7` et `sonnet-4-6` inconnus**~~ — **FERMÉE le 2026-07-22**
      par `acceptation/modeles-effort-reel.ts`. `opus-4-8` / `sonnet-5` / `fable-5` déclarent bien les
      cinq niveaux + pensée adaptative ; `opus-4-7` est **absent** de `supportedModels()` et ne doit
      donc pas figurer au sélecteur ; Haiku n'a ni effort ni adaptatif (exclusion H-71 confirmée
      mécaniquement). Le mode « ultra » existe : c'est `ultracode` (Settings). Détail en **H-71.1**.
      `☠` L'identité d'un modèle est `value`/`resolvedModel`, **jamais `model`** — piège rencontré.

- [ ] `⚠` **AGGRAVÉ le 2026-07-22 — le flux de sous-agents est non déterministe** (H-72.4). Deux
      exécutions supplémentaires du banc à cinq sous-agents, session parfaitement saine, ont donné
      **0 ligne** là où trois exécutions antérieures en donnaient 3 à 4. `forwardSubagentText` n'offre
      **aucun plancher garanti** : la divergence flux/store que M-50 chiffre n'est pas un cas limite,
      c'est le cas **nominal**, et elle peut valoir 100 %. Le contexte du parent à cinq sous-agents
      reste, lui, non mesuré — `getContextUsage()` n'est pas lisible après `result`.

### 🟢 DETTE N°4 — qualité de code et arbitrages
- [x] ~~`superviseur/superviseur-workers.ts` dépasse 500 lignes~~ — **FERMÉE** : extractions
      successives (`budgets-workers.ts`, `fencing-restauration.ts`, `fencing-arbitrage-workers.ts`,
      `anti-boucle-workers.ts`, `superviseur-workers-types.ts`), fichier revenu sous la limite.
      `⚠` `superviseur/superviseur-workers.test.ts` dépasse toujours 500 lignes (fichier de test).
- [x] ~~Trois arbitrages M-32~~ — **TRANCHÉS le 2026-07-22**, détail plus bas. Dont un plafond qui
      **marchait à l'envers** : il rejetait les configurations *plus* restrictives.
- [ ] **Arbitrages maquette v3 restants** : Sonnet 4.6 grisé ou masqué ; jauge dans la vue
      Orchestrateur. `☠` **Le déclencheur d'atterrissage par mission contredit H-70** — la décision
      appartient au **superviseur**, jamais au lead seul, parce que la fenêtre de quota est partagée
      par compte : trois leads qui atterrissent ensemble la saturent pendant l'atterrissage. Conservé
      pour l'instant afin de rendre la maquette testable, **à retirer quand le comportement devient
      réel**.

### ✅ Dettes fermées le 2026-07-22 (suite)
**Cinq garde-fous étaient branchés sur rien** — tous corrigés, motif consigné en **H-74** : plafond
de parc jamais appelé · `canUseTool` jamais fourni (cassait la reprise) · juge anti-boucle H-68
jamais câblé · identité de process jamais capturée · hooks d'audit M-22 raccordés à aucun worker.
`☠` Sixième forme du même défaut, trouvée par un test rouge : la `WorkerSpec` est persistée en JSON,
donc **ses ports disparaissent au redémarrage** — une spec restaurée relancerait un worker sans audit
ni arbitrage. Le type le dit désormais (`WorkerSpecPersistee`).

Ports `InventairePc`/`ReinitialisateurSession` implémentés (M-13) · `deciderRelance()` câblé (M-13) ·
git réel exercé sur un vrai dépôt + **bug critique de perte de données corrigé** (banc worktree) ·
fencing par epoch arbitré (M-11) · config multi-comptes réparée par liens symboliques (banc worker).

### Lot 0 — TERMINÉ (180 tests verts, typecheck propre)
- [x] **M-01** squelette worker · **M-02** générateur d'entrée · **M-03** registre SQLite
- [x] **M-04** harnais de pannes — 87 tests, README avec table de couverture, défaut de fencing
      corrigé (le rejet ne portait que sur les epochs strictement inférieurs : deux workers de même
      epoch coexistaient sans trace, soit la panne #2 **avec** le fencing activé)
- [x] **`design-v2/`** — maquette + `COMPARAISON.md`

### Point de synchronisation vague 1 — ✅ PASSÉ le 2026-07-22 (par le parent)
- [x] **Test d'acceptation réel de M-02** — 10 min de silence réel, flux survivant, aucun
      `Stream closed`. Script rejouable : `harness/acceptation/m02-flux-entree.ts`.
      **Découverte** : en `permissionMode: 'auto'`, `canUseTool` n'est jamais appelé (le classifieur
      tranche seul, même sur `rm -rf`). Le critère d'origine était donc inatteignable en production.
      ⇒ **l'audit doit passer par `PreToolUse`** — à répercuter sur M-22.

### Vague 2 (dépend du Lot 0)
- [x] **M-10** tunnel Pi↔PC — livré 2026-07-22, `harness/transport/`. **WebSocket retenu** (natif à
      Bun, zéro dépendance ; framing et codes de fermeture 4000-4999 gratuits pour la taxonomie
      D.2.1 ; la reprise devant de toute façon être écrite à la main quel que soit le support).
      Raisonnement complet : `harness/transport/DECISION-TRANSPORT.md`.
- [ ] **M-10 — reste à faire, signalé par l'agent lui-même** : pas de ping/pong applicatif, donc une
      coupure **silencieuse** (ni `close` ni `error`) n'est pas détectée. Le lien paraît vivant et ne
      transporte plus rien. `☠` À couvrir avant toute exécution non surveillée.
- [ ] **M-10 — à mesurer en réel par le parent** : aucune latence de reconnexion réelle n'a pu être
      mesurée (interdiction de réseau réel en subagent). Le critère (a) — coupure de 30 s, zéro octet
      perdu ou dupliqué — est prouvé sur doublures, pas sur socket.
- [x] **M-20** plancher de déni — livré 2026-07-22, `harness/plancher-deni/`. 16 motifs scopés
      (plafond porté de 15 à 16 pour loger `pkill -f`, incident réel du 2026-07-08 sur le Pi).
- [x] **M-20 — moteur réel vérifié** (2026-07-22, `harness/acceptation/plancher-moteur-reel.ts`).
      Les 3 formes de wildcard du plancher (`préfixe*`, `*encadrant*`, `médian* -f*`) refusent bien
      sur le vrai binaire, et le déni n'est **pas** global : les 2 témoins s'exécutent, dont celui
      qui prouve l'absence de faux positif sur `-f` sans espace. `simulerArbitrage` est donc un
      modèle **fidèle**. `☠` Testé par **motifs sondes** sur des `echo` inoffensifs — jamais en
      demandant au modèle une action dangereuse.
      `⚠` Piège de détection payé : chercher « refus »/« denied » dans le JSON entier des messages
      fait passer les témoins pour refusés (le résumé final du modèle cite tous les verdicts). Le
      verdict se lit sur les blocs `tool_result` appariés à leur `tool_use`.
- [x] **M-21** machine à états des demandes — livré 2026-07-22,
      `harness/control-plane/bus-permissions/`. 5 invariants testés. Ne suppose **aucune source
      unique** : conséquence directe de `canUseTool` jamais appelé en `auto`. Deux entrées
      symétriques — `resoudreAuto()` (le lead tranche seul) et `escalader()` (humain).
- [x] **Ping/pong transport** — dette de M-10 comblée, `harness/transport/lien-websocket.ts`.
      Le `PONG` est généré par la **couche transport**, jamais par le processus Claude Code : c'est
      ce qui rend « agent lent » et « tunnel mort » structurellement discernables. Seuil 3 tics de
      silence total (~45 s), reprise par le même chemin que les coupures signalées.
- [x] **M-22** arbitrage délégué + trace d'audit — livré 2026-07-22,
      `harness/control-plane/audit-permissions/`. Audit branché sur `PreToolUse` (exhaustivité
      vérifiée : 100 % des tentatives vues en `auto`), **jamais** sur `canUseTool`.
- [x] **M-22 — validé et corrigé par banc réel** (`harness/acceptation/audit-permissions-reel.ts`).
      Le banc a infirmé une hypothèse : `SDKPermissionDeniedMessage` **n'est jamais émis** sur un
      refus par règle scopée en `auto`, et le hook `PermissionDenied` ne se déclenche pas non plus.
      Le collecteur comptait alors `refusees: 0` alors qu'un refus avait eu lieu. Corrigé : le
      signal réel est le **`tool_result` avec `is_error: true`**, apparié par `tool_use_id`.
      Après correctif : `{tentativesVues:3, autorisees:2, refusees:1, nonResolues:0}`.

`⚠` **Limite de ce que H-40 peut garantir**, à retenir avant de s'appuyer dessus : sur le chemin
réel (refus par règle scopée), la trace affirme **quoi** a été refusé et **avec quel texte**, mais
**pas par quel mécanisme** (`auteur: 'inconnu'`). Les autorisations, elles, ne sont jamais affirmées
par le SDK — seulement inférées (`classifieur_probable`). Une tentative sans `PostToolUse` ni
`tool_result` de refus reste `indetermine` et n'est **jamais** requalifiée en refus.
- [x] **M-31** adaptateur `SessionStore` — livré 2026-07-22, `harness/control-plane/session-store/`.
      Miroir best-effort, mais la divergence est **détectable** : table `session_defaillance`
      indépendante du flux SDK (un consommateur qui n'écoute pas `mirror_error` le raterait sinon)
      + `etatMiroir().divergent`. Colonne `emetteur` posée pour H-66 sans être peuplée.
- [x] **M-31 — validé sur le vrai SDK** (`harness/acceptation/session-store-reel.ts`) : le SDK
      sollicite réellement l'adaptateur (`append` ×2, cadence ~480-530 ms), la `projectKey` est le
      **cwd sanitisé** (`-mnt-projects-ccremote-harness`), 10 entrées relues, `divergent: false`,
      aucun `mirror_error`. `⚠` Seul `append` a été observé sur une session courte : `load`,
      `delete`, `listSubkeys` restent non exercés par le SDK réel (à revoir sur une reprise).
- [x] **M-34** relance et classification — livré 2026-07-22, `harness/relance/`. Mapping pris dans
      `05-arbre-B § B.3.2` (pas dans `01`, qui n'en donne qu'une énumération partielle) et croisé
      avec `sdk.d.ts`. Seul le groupe `transitoire` est relançable ; structurel ⇒ `echec_definitif`
      **immédiat, sans consommer de tentative** ; `budget_exhausted` jamais relancé.
      `⚠` **Trouvaille : la table de la spec ne couvre que 16 des 19 `TerminalReason` du SDK.**
      `image_error`, `tool_deferred`, `tool_deferred_unavailable` sont classées `non_couverte` —
      journalisées telles quelles, jamais relancées, toujours remontées. Aucun groupe inventé.
- [ ] **M-34 — pas encore branché** : `deciderRelance()` est écrit et testé en isolation, mais
      n'est câblé sur aucun `SDKResultMessage.terminal_reason` réel. La relance ne fonctionne donc
      **pas** de bout en bout — le câblage revient à M-30 (réconciliation / cycle de vie).

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51** (plancher de déni + budgets).

### H-69 — `extra_usage` laissé actif (tranché par Chris, 2026-07-22)
`extra_usage.is_enabled = true` sur les deux comptes. **Décision : on le laisse actif** — les crédits
sont offerts sur le compte, donc utilisables librement pour le développement et les tests réels.

`⇒` La contrainte de parcimonie sur les **tests réels** est levée : un banc d'essai en vraie session
est désormais le moyen normal de lever un doute, pas un luxe à rationner. C'est cohérent avec tout ce
qui précède : chaque fois qu'on a testé en réel (M-02, moteur de règles, multi-comptes), on a trouvé
quelque chose que le raisonnement seul avait manqué.

- [ ] Afficher quand même les crédits consommés dans la jauge H-63 (visibilité, **pas** blocage).
      Des crédits offerts restent finis, et un parc autonome les consomme sans le dire.

`☠` Ceci reste distinct de H-68 : une dépense n'est **pas** un détecteur de boucle. Ne pas
ressusciter le plafond en dollars sous prétexte que le budget existe.
`☠` Ceci n'autorise **pas** l'exécution non surveillée : les garde-fous (M-20, M-51, ping/pong) sont
une question de sûreté, pas de budget.

### Action de Chris requise — rotation multi-comptes à moitié en place
Conception retenue : **un `CLAUDE_CONFIG_DIR` persistant par compte** sous `~/.claude-comptes/`,
authentifié une fois et laissé se rafraîchir. Ne jamais recopier un snapshot au moment de la bascule
(les refresh tokens tournent : un snapshot copié se périme seul et en silence — constaté le 22/07 sur
les deux anciens `.credentials_account*.json`).

- [x] `compte-a` (`compte-a@exemple.fr`) et `compte-b` (`compte-b@exemple.fr`) en place,
      **vérifiés en parallèle le 2026-07-22** : deux sessions simultanées, identités distinctes lues
      via `accountInfo()`, quotas lus par compte, aucun fichier d'identifiants écrasé par l'autre.
      Banc rejouable : `harness/acceptation/multi-comptes-reel.ts`.
- [ ] À confirmer à la première bascule réelle : que le rafraîchissement du jeton s'écrit bien
      **dans** le dossier isolé (non forçable, ne s'observe qu'à l'expiration).
- [ ] Purger les deux snapshots périmés `~/.claude/.credentials_account{1,2}.json` — ils ne servent
      plus qu'à induire en erreur (garder jusqu'à la première bascule réussie, par prudence).

### Lot 3 — livré 2026-07-22 (461 tests verts)
- [x] **M-30** réconciliation — `harness/control-plane/reconciliation/`. « Le PC gagne » garanti
      **mécaniquement** : l'état ne suit que le booléen `vivant` rapporté par le PC, aucun chemin ne
      laisse survivre une conviction du Pi qui le contredit. `reinitialize()` appelé sur toute
      mission confirmée vivante (`demarrage`/`reconnexion`, jamais `periodique`).
      `⚠` Correction du parent : un flag `simulerPanneOrphelinIgnore` avait été introduit dans le
      module de production pour tester la panne #11. Retiré — **un interrupteur capable de produire
      la panne est la panne**. L'invariant se teste sur le seul chemin qui existe.
- [x] **M-32** modèle de projets — `harness/projets/`. Déclaration = un fichier JSON déposé, aucun
      cache, donc F.4.1 vrai mécaniquement. `☠` Point (d) : `supprimer()` a **un seul site d'appel**,
      dans la branche `!sale`, et un échec de la vérification git suppose le **pire cas sûr** (sale,
      donc pas de suppression) — « un faux positif retarde une libération, un faux négatif détruit
      du travail ».
- [x] **M-33** pause et reprise — `harness/pause/`. La garantie « ni perdue ni dupliquée » ne dépend
      **d'aucune information tirée du reçu** : elle tient à ce que le contrôleur ne touche jamais aux
      messages déjà transmis et ne retransmette jamais les siens. Le mode dégradé est traité comme
      **chemin nominal** (`capabilities` revient vide en réel), et une capacité annoncée mais dont
      `interrupt()` résout `undefined` bascule aussi en dégradé — on ne fait pas confiance à un
      drapeau qui ment.

### ✅ Arbitrages M-32 — TRANCHÉS le 2026-07-22 (choix d'implémentation, rendus par le parent)
- [x] **« commits en attente » (F.2.3) = non intégrés dans la branche parente** — **confirmé**.
      La lecture « non poussés vers un remote » est écartée : le harness travaille en worktrees
      locaux, un remote peut ne pas exister, et le coût d'erreur est asymétrique — se tromper ici
      revient à supprimer un worktree portant du travail. C'est exactement le bug de perte de
      données déjà payé sur ce module. La lecture la plus conservatrice est la bonne.
- [x] **Plafond de 8 motifs supplémentaires : supprimé, remplacé par un seuil d'alerte** aligné sur
      `MAX_MOTIFS_PLANCHER`. Le chiffre était inventé, et surtout **à l'envers** : des motifs
      supplémentaires **renforcent** le plancher de déni. Rejeter au-delà d'un seuil faisait échouer
      le chargement d'un projet parce qu'il était **trop prudent**. Le rejet reste réservé aux
      configs qui affaiblissent le plancher ou se contredisent, jamais à celles qui sur-restreignent.
- [x] **Projet non-git fixant `brancheDefaut` : rejet maintenu** — une configuration qui se
      contredit doit être refusée, pas silencieusement ignorée. Même principe que **H-74** : une
      extinction silencieuse est toujours pire qu'un échec visible.

### Bancs réels passés par le parent — 2026-07-22
- [x] **`acceptation/worker-reel.ts`** — `startWorker` (M-01) exercé contre le vrai SDK pour la
      première fois : worker démarré, mandat mené à terme (`RESULTAT.md` = `TERMINE`), **plancher de
      déni réellement appliqué** (sonde refusée), capacités lues depuis `init`, `SessionStore`
      alimenté. Valide M-01 + M-20 + M-31 ensemble, en conditions réelles.
      `☠` **Découverte** : isoler le compte via `CLAUDE_CONFIG_DIR` isole **aussi toute la config** —
      pas de `CLAUDE.md`, pas de `settings.json`, pas de `skills/`, **pas de serveurs MCP**. Le
      worker perdait Playwright/CodeIndex, que H-52 lui demande d'utiliser pour ses tests E2E.
      Le pré-vol de M-01 l'a détecté et a refusé de spawner — le garde-fou a joué son rôle.
      Corrigé par liens symboliques (voir `harness/REPRISE.md`, section multi-comptes).
      `⚠` **À refaire pour tout nouveau compte ajouté** — sinon ses workers repartiront nus.

### M-11 fencing par epoch — LIVRÉ 2026-07-22 (dernière panne muette connue, fermée)
- [x] `superviseur/fencing-epoch.ts` (arbitre pur) + câblage dans `superviseur-workers.ts`,
      + garde complémentaire dans `projets/cycle-vie-worktree.ts` (`EpochNonCroissantError`).
      **Clé = le worktree**, pas le `missionId` : ce qu'on protège est le répertoire où deux process
      pourraient écrire. `☠` **Égalité d'epoch traitée explicitement** — une reprise légitime porte
      toujours un epoch strictement supérieur (le Pi l'incrémente à chaque rattachement), donc une
      égalité est forcément une collision. Le **candidat entrant** perd (règle symétrique = non
      déterministe). Un worker évincé **meurt réellement** : `abortController.signal.aborted`
      vérifié en test, sur l'AbortController propre au worker.
- [ ] `⚠` **Limite signalée, hors périmètre M-11** : si **le superviseur PC** redémarre (et pas
      seulement le Pi), il perd son `RegistreWorkers` en mémoire et ne sait plus quels workers
      vivent — aucun fencing ne peut y remédier. Axe distinct : **persistance du registre côté PC**.

### Dettes ouvertes du lot 3
- [ ] **Ports non implémentés** : `InventairePc` et `ReinitialisateurSession` (M-30) sont des
      contrats sans implémentation réelle — la réconciliation ne tourne donc **pas** de bout en bout.
- [x] **`InterrogateurGitReel` / `GestionnaireWorktreeGitReel` exercés sur un vrai dépôt** —
      `harness/acceptation/worktree-git-reel.ts`, 4/4 sur des dépôts jetables créés par le banc.
      `☠` **Bug critique trouvé et corrigé** : `executer()` n'ayant jamais levé (il avale l'échec de
      `git` et rend `stdout: ''`), le « pire cas sûr » posé dans le `catch` de `aTravailNonCommite`
      était **du code mort**. Un git en échec devenait indiscernable d'un worktree propre ⇒
      suppression. Seul `git worktree remove` (qui refuse un `.git` manquant) a évité la perte de
      données. Corrigé : le **code de sortie** est vérifié, pas seulement l'exception.
- [ ] **`deciderRelance()` toujours non câblé** : M-30 a argumenté (à raison) que la réconciliation
      n'observe jamais de `terminal_reason`. Le point de câblage est le gestionnaire du flux live,
      côté superviseur de workers — pas encore construit.

### Design v2 — arbitrages à trancher par Chris (source : `design-v2/COMPARAISON.md`)
- [ ] **Parler à une mission en cours** — trou le plus concret. Chris avait posé l'exigence
      explicitement (« on pourra en discussion en même temps »), et l'outil `envoyer_a_equipe` existe
      bien en A.2.2 — mais **la maquette ne l'expose nulle part**. Corriger un lead qui dérive sans
      arrêter la mission n'a donc aucun chemin dans l'UI. Trou de maquette, pas de spec.
- [ ] **Composer un mandat** — le bouton « Nouvelle mission » n'ouvre rien. Or le mandat (but /
      critère d'arrêt testable / périmètre + obligations H-52) est la pièce centrale du système.
      Rien dans l'UI ne le compose ni ne l'affiche.
- [ ] **Barre de sûreté absente de la vue Orchestrateur et de Paramètres** (présente sur 4 vues / 6)
      — or H-57 exige que le bouton reste joignable partout. Coût : hauteur du composer sur mobile.
- [ ] **Wake-on-LAN retiré sans remplaçant** — la v2 sait afficher « lien coupé » mais n'offre plus
      le geste qui corrige. Trois options : réveil dans la carte lien · réveil auto au dispatch · PC
      allumé en permanence (choix implicite actuel de la maquette).
- [ ] **Métriques machine supprimées** — alors que H-57 acte que les processus enfants survivent à la
      pause et s'accumulent. La v2 retire le seul endroit où ça se serait vu. Compromis proposé : une
      ligne de charge dans la carte lien.
- [ ] Règles de notification C.4.4 (groupement, seuil de rappel, silence sur ce que le lead a résolu
      seul) ni réglables ni visibles — le filet Discord est un simple interrupteur.

### H-70 / H-71 / H-72 — actées le 2026-07-22, à faire APRÈS le MVP
*Décision de Chris : « dès qu'on a le MVP, on s'attaquera directement à l'ajout de tout ça ».*
*Spécification complète dans `Upgrade/16-decisions-operateur.md`.*

- [ ] **H-70 — atterrissage propre avant saturation de quota.** Au seuil (80-85 %, à caler sur une
      mesure du coût réel d'un atterrissage), le lead consigne son état en doc + mémoire sémantique
      et clôture ; la mission est relancée après réinitialisation de la fenêtre.
      `☠` Décision prise par le **superviseur**, jamais par le lead isolément : la fenêtre est
      partagée par compte, et trois leads qui atterrissent ensemble saturent le quota pendant
      l'atterrissage.
- [ ] **H-71 — choix du modèle et du raisonnement dans le fil de l'orchestrateur.**
      Modèles éligibles : `claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-7`
      (tous vérifiés accessibles). `claude-sonnet-4-6` accessible mais jugé insuffisant pour ce rôle.
      `☠` **Haiku exclu** — il ne supporte ni `effort` ni `thinking` adaptatif, fait technique
      concordant avec la décision.
      `⚠` Les niveaux d'effort proposés viennent de `supportedModels()[].supportedEffortLevels`,
      jamais d'une constante en dur. `setModel()` permet le changement **à chaud**.
- [ ] **H-72 — jauges de quota + navigation par agent.** Fenêtre 5 h **et** 7 jours, en pourcentage,
      avec `resets_at`, **par compte**. Une discussion par équipe (lead, messages, actions), et les
      sous-agents **cliquables** pour voir leur travail en temps réel.
      `☠` Le flux détaillé va de la source **directement à l'UI** — jamais par le contexte de
      l'orchestrateur (H-45, panne #17). Chaînage par `parent_tool_use_id` / `parent_agent_id`.
- [ ] **H-72.1 — cloisonnement à TROIS niveaux** (précision de Chris, 2026-07-22). Un sous-agent ne
      transmet **pas son contexte** à son lead : il lui rend un **compte-rendu**. L'UI est un
      **observateur externe** en lecture seule — de l'observabilité, pas de la transmission.
      Besoin concret : quand 5 sous-agents travaillent, le feed du lead est **vide** ; l'opérateur est
      aveugle au pic d'activité. D'où le clic vers la ligne de travail de chaque sous-agent.
      `⚠` **À MESURER avant de concevoir M-50** : `forwardSubagentText` / `agentProgressSummaries`
      alimentent-elles seulement le **flux lu par le programme**, ou aussi le **contexte du modèle
      parent** ? Si c'est le flux seul ⇒ c'est l'outil idéal pour l'UI. Si c'est le contexte ⇒ elles
      violent la règle, et il faut lire les transcripts à la source (JSONL / `SessionStore`).
      Ne pas trancher au raisonnement : banc réel.

### Features actées, à implémenter — MAIS PAS PRIORITAIRES
*Décision explicite de Chris (2026-07-22) : « il va évidemment falloir les mettre en place, mais pour
l'instant ce n'est pas le plus important. C'est ultra important de les garder en doc et en mémoire. »*
*⇒ Consignées, pas planifiées. Ne pas les laisser s'insérer dans la vague 2.*

- [ ] **H-61 — autorisation humaine au dispatch.** `creer_equipe` ne crée rien : retourne
      `effet: 'differe'` + une proposition de mandat que l'opérateur autorise d'un clic. C'est le
      dernier garde-fou humain du système (H-40 + H-41 délèguent tout le reste au lead).
- [ ] **H-66 — attribution de l'émetteur.** Préfixe structurel `orchestrateur` / `operateur` sur tout
      message entrant dans une session d'équipe, + champ au registre et au transcript. `☠` Un lead ne
      doit **jamais** attribuer à Chris une instruction venue de l'orchestrateur.
- [ ] **H-52 complété** — le system prompt du lead doit lui apprendre : il est une équipe parmi
      d'autres · ses instructions viennent normalement de l'orchestrateur · l'opérateur peut lui
      parler directement, et c'est identifié.
- [ ] **H-67 — sidebar arborescente** (chat principal + sessions d'équipes en sous-niveau) et
      **messages en file** façon Claude Code : écrire à une équipe occupée ne l'interrompt pas.
- [ ] **H-63 — jauge dollars par fenêtre de rate limit**, agrégée **par compte** (la fenêtre est
      partagée par toutes les missions d'un même compte). `☠` Remise à zéro sur `resetsAt`
      uniquement, jamais au redémarrage d'un process.
- [ ] **H-62 — orchestrateur maître** : autocompaction autonome + bouton de compaction manuelle
      disponible sans être nécessaire.
- [ ] **H-64 — permissions dans le fil** de la mission (avec filtre), pas dans une vue dédiée. La
      vue escalade ne garde que ce que le classifieur a refusé.

### À répercuter
- [ ] **M-41** doit brancher `surFermetureImprevue` du générateur d'entrée sur une **alarme réelle**
      (H-60). Sans ça, l'instrumentation existe mais ne sert à rien.
- [ ] Manifeste PWA + service worker pour Web Push (H-59) — absents de la SPA actuelle. Chris devra
      ajouter l'app à son écran d'accueil iOS une fois.

---

## App v1 (production) — à faire (priorité)
- [ ] Confirmer depuis l'app que le bouton extinction PC fonctionne réellement (fix polkit déployé,
      non re-testé en réel — irréversible, à valider par Chris)
- [ ] Confirmer que les quotas repassent bien à zéro après une fenêtre pleine sans nouvel appel
      (fix déployé, heuristique non observée sur un vrai cycle prod)

## Backlog
- [ ] **Démarrer le PC depuis la conversation avec l'orchestrateur master** (demandé par Chris,
      2026-07-22). L'agent doit en être **capable**, mais **toujours demander et faire confirmer par
      l'utilisateur** — jamais de réveil automatique.
      Le moyen existe déjà : Wake-on-LAN, `PC_MAC` dans `client/config.py`, utilisé par
      `client/ccremote.py`. Il s'agit donc d'exposer un outil de contrôle à l'orchestrateur, pas
      d'inventer un mécanisme.
      `☠` Trois points à ne pas rater à l'implémentation : (1) la confirmation humaine est un
      **arbitrage**, il passe par le bus de permissions (M-21) et son escalade (H-61), jamais par une
      question posée dans le fil ; (2) réveiller le PC est une action **sortante et physique** — elle
      relève du seuil de confirmation obligatoire, au même titre qu'une extinction ; (3) le réveil
      n'a de sens qu'articulé avec la reconnexion automatique (le PC réveillé doit se rattacher
      seul) — donc à faire **après** que la reprise automatique soit prouvée, pas avant.
- [ ] Reasoning par round de tool-calling en streaming (actuellement fusionné en un seul bloc
      pour tout l'échange, simplification assumée)
- [ ] Décider si `zai-glm-4.7`/`gpt-oss-120b`/`gemma-4-31b` ont vraiment les tailles de contexte
      posées dans `MODEL_CONTEXT_TOKENS` (estimations faute de doc publique Cerebras)

## Terminé (session du 2026-07-06, soir)
- [x] Fix bouton extinction PC : ajout règle polkit `/etc/polkit-1/rules.d/49-ccremote-poweroff.rules`
      (le service `ccremote-server`, hors session logind, n'était pas couvert par le `CanPowerOff` de
      session) — vérifié via `pkcheck`, non testé en réel (irréversible)
- [x] Fix quotas pas "temps réel" : `agent/usage.py::_effective_quotas()` resynthétise `remaining =
      limit` quand la fenêtre (minute/heure/jour) est dépassée depuis le dernier appel réel, au lieu
      de garder le snapshot figé — déployé sur le Pi

## Terminé (session du 2026-07-06)
- [x] Quotas combinés (somme des clés configurées) affichés en priorité dans Paramètres, avec
      détail par clé toujours visible en dessous — le fallback étant réel, le total combiné
      est honnête, pas cosmétique
- [x] Fix : le snapshot de quotas se videait à chaque restart serveur (trompeur — le vrai quota
      Cerebras n'est jamais affecté) — warm-up au démarrage (`lifespan` FastAPI) qui repeuple le
      snapshot avant toute requête utilisateur
- [x] Rotation automatique vers une 2e clé Cerebras (`CEREBRAS_API_KEY_2`) sur 429 — quotas suivis
      séparément par clé, toast + historique quand la bascule a lieu
- [x] Retrait du sous-titre "Agent local" sous le logo ccremote (sidebar)
- [x] Déployé en prod via `~/.ssh/id_ed25519_ccremote` (accès direct au Pi, `pi@pi.exemple`) —
      confirmé fonctionnel : sidebar corrigée, pill de contexte visible, zéro erreur console
- [x] Suivi d'usage API Cerebras : quotas requêtes/tokens par minute/heure/jour (headers `x-ratelimit-*`
      réels capturés à chaque appel), + contexte de la conversation active (tokens utilisés/limite du
      modèle) — visible en pill dans le header agent et en détail dans Paramètres
- [x] Fix `deploy-web-pi.sh` : ne synchronisait que app.py/config.py/requirements.txt/index.html,
      jamais `agent/`, `static/`, `pc_client.py` (bug pré-existant, découvert en voulant déployer)
- [x] `gemma-4-31b` confirmé utilisé et fonctionnel par Chris — commentaire de doute retiré
- [x] Conformité standards projet : `README.md`, `ARCHITECTURE.md`, `start.sh`/`stop.sh`/`restart.sh`,
      `.env.example` racine
- [x] Fix responsive carte "PC distant" dans Paramètres (grid-cols-2 illisible sur mobile → stack vertical)
- [x] Fix hauteur mobile Safari (`100vh` → `100dvh`) sur index.html et login.html
- [x] Fix header mobile dupliqué (topbar + header de vue → un seul header, hamburger intégré)
- [x] Fix bug stopPropagation empêchant l'ouverture de la sidebar mobile
- [x] Streaming SSE des réponses de l'agent IA
- [x] Rendu markdown stylisé (marked + DOMPurify)
- [x] Conversations persistantes et reprenables (sidebar)
- [x] Compactage automatique du contexte selon le modèle actif
- [x] Fix crash prod : `send_keys` (texte + Enter séparés, délai) — bracketed-paste de Claude Code
- [x] Timeout sur `ws.recv()` + interception propre des erreurs Cerebras dans le stream
- [x] Switch de compte Claude Code (UI Paramètres + tool agent) avec restart tmux automatique
- [x] Bouton extinction PC (`poweroff` sans sudo, confirmé autorisé par polkit)
- [x] STATE.md / TODO.md / ARBORESCENCE.md créés pour le projet (n'existaient pas avant)
