# TODO — ccremote
*Dernière mise à jour : 2026-07-22*

## ⚡ Harness d'orchestration — chantier actif

**Contexte complet : `harness/REPRISE.md`.**

### En cours (lancés le 2026-07-22, à vérifier sur disque avant de relancer)
- [ ] **M-04** — tests unitaires + `README.md` des interfaces dans `harness/test-harness/`
      (contrats et doublures déjà écrits ; il manque les tests, or le critère d'acceptation est
      « chaque panne est déclenchable de façon reproductible »)
- [ ] **`design-v2/COMPARAISON.md`** — le livrable décisionnel attendu par Chris
      (la maquette `index.html` est déjà livrée)

### Point de synchronisation vague 1 — à valider par le parent, pas par un subagent
- [ ] **Test d'acceptation réel de M-02** : session ouverte, **10 minutes réelles** de silence, puis
      action nécessitant une permission ⇒ `canUseTool` appelé, aucun `Error: Stream closed`.
      Protocole détaillé dans `harness/REPRISE.md`. `☠` Ne pas être en `bypassPermissions`, sinon le
      test est vert pour la mauvaise raison.

### Vague 2 (dépend du Lot 0)
- [ ] **M-10** tunnel Pi↔PC — chemin critique. Décision déléguée : SSH / WebSocket / TCP, à mesurer
      et documenter. Piste : WebSocket, pour réutiliser l'infra ccremote existante (`server.py:8765`)
- [ ] **M-20** plancher de déni — garde-fou minimal, **avant toute exécution non surveillée**
- [ ] M-21 machine à états des demandes de permission
- [ ] M-22 arbitrage délégué + trace d'audit (c'est cette trace qui valide ou invalide H-40)
- [ ] M-31 adaptateur `SessionStore`
- [ ] M-34 relance et classification des `TerminalReason`

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51** (plancher de déni + budgets).

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
