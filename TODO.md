# TODO — ccremote
*Dernière mise à jour : 2026-07-22*

## ⚡ Harness d'orchestration — chantier actif

**Contexte complet : `harness/REPRISE.md`.**

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
