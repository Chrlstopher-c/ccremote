# STATE — ccremote
*Dernière mise à jour : 2026-09-03*

## 2026-09-03 — Optimisation quotas + qualité : chantier LIVRÉ et DÉPLOYÉ sur les 4 machines

Branche `optim-quotas` fusionnée sur `master` (fast-forward, `master`=`57cad88`), **2080 tests / 0 fail**,
tsc propre, déployée en production sur **Pi + PC + VPS + portable** (les quatre rattachées, vérifié via
`bun pilotage/pilote.ts machines`). Base : `AUDIT-ORCHESTRATION.md`, `AUDIT-QUOTAS-QUALITE.md`,
`PLAN-OPTIMISATION-QUOTAS.md`, `PLAN-AXE-B.md`. Détail SDK/déploiement : mémoire sémantique `ccremote`.

**Ce qui a changé (grief « bouffe les quotas / rate-limit / qualité moindre ») :**
- **Verrous DURS de modèles (A1)** : lead = `claude-opus-4-8` high non-overridable ; sous-agents exécuteurs
  = `claude-sonnet-5` imposé par un hook `PreToolUse` (fin du facteur ×10, 6,40 $→0,67 $) ; master
  orchestrateur configurable via `CCREMOTE_MODELE_ORCHESTRATEUR`.
- **Autocompact orchestrateur (A2)** à 85 % de contexte (fin de l'historique rejoué sans borne, cause 1).
- **Budget par défaut 50 $/ACTIVATION** (le vrai frein ; `PLAFOND_EQUIPE_USD` 250 $ reste le garde-fou
  catastrophe dérivé de l'échelle anti-boucle, intact — ne pas y toucher).
- **Watchdog borné (C1)** + **échec propre sur compte en overage (C2)**.
- **Teams persistantes (axe B, complet)** : tables `team`/`feature_queue`, worktree `en_veille` réutilisé au
  réveil sans re-exploration, file de features dépilée sous fenêtre d'autonomie, TTL 7 j + `dissoudre_team`,
  résumé de reprise via le `compact_summary` NATIF du CLI (zéro coût LLM).
- **Rapport d'équipe structuré (D1)** — 4 marqueurs imposés au lead, extraction regex, zéro coût LLM.
- **HORS SCOPE ferme (Chris)** : rotation/délégation de comptes — la cause 2 du rate-limit reste en place.

**Trois bugs trouvés EN VALIDATION (pas sur récit d'agent) :** le verrou Sonnet était mort (il ciblait
l'outil `Task`, mais le SDK 0.3.220 émet le sous-agent sous `Agent`) ; worktree jamais conservé sur un worker
déjà mort ; `team.worktree` jamais peuplé. Tous corrigés et re-prouvés en réel. Fait SDK clé :
`claude-opus-4-8` est dispatchable malgré son absence de `supportedModels()` (mesuré par dispatch réel).

**Reste (à observer / traiter) :**
- **Validation E2E réelle de la CONSO pas encore faite** : à observer sur les premières missions (exécuteurs
  Sonnet effectifs, teams qui survivent/réveillent, budget qui coupe à 50 $). C'est la vraie preuve du gain.
- **`D3`** (validation du domaine d'équipe) câblée mais INERTE tant qu'un projet n'est pas déclaré côté Pi
  (frontière A↔B : le Pi n'a pas la `ConfigProjet.domainesEquipe` du PC).
- **`C1` partiel** : le CLI ne borne pas ses retries internes ; le vrai frein reste le budget.
- **Portable sans compte Claude authentifié** → répond à l'inventaire mais ne peut héberger d'équipe.
- **Dette** : `dispatch-mandat.ts` ~1106 l, `migrations.ts`, `outils-cycle-vie.ts` > 500 l (pré-existant, aggravé).
- **`ARBORESCENCE.md` en retard** : nouveaux modules non listés (`teams.ts`, `feature-queue.ts`,
  `modele-sous-agents.ts`, `resumeur-compaction.ts`, `format-rapport.ts`, `fin-activation-team.ts`,
  `restauration-teams-worktrees.ts`, `balayage-ttl-teams.ts`, `lecteur-domaines-equipe.ts`).
- **`master` local diverge d'`origin`** : le déploiement se fait par rsync du code local, aucun push nécessaire.

Historique antérieur au 2026-08-07 archivé dans `STATE-ARCHIVE-2026-08-07.md` (598 lignes,
non tronqué) — ce fichier repart de zéro pour tenir sous 300 lignes. Détail complet du harness :
`harness/REPRISE.md`. Registre des points ouverts : `TODO.md`. Synthèse décisionnelle :
`SYNTHESE-CHANTIER.md`.

## Deux systèmes dans ce dépôt

Voir `ARCHITECTURE.md` pour le détail. Résumé : (1) le panneau de contrôle personnel d'origine
(`client/`, `server/`, la moitié « système 1 » de `pi-web/`) et (2) le harness d'orchestration
d'équipes Claude Code (`harness/`, chantier actif depuis fin juillet), dont l'UI vit aussi dans
`pi-web/` (fichiers `harness-*.js`/`_harness_*.html`, relayés vers l'API Bun du Pi). Les deux
partagent la session et le mot de passe de `pi-web`, aucun code.

## En production depuis le 2026-07-22

| Machine | Service | Rôle |
|---|---|---|
| Pi | `ccremote-harness` | control plane du harness : registre, API web (loopback 8722), lien (8721) |
| Pi | `ccremote-web` | `pi-web`, UI publique des deux systèmes, `ccremote.exemple.com` |
| PC | `ccremote-pc` (`--user`, linger) | superviseur de workers du harness, client du lien |
| VPS | superviseur (repli) | même rôle que le PC, pour tourner une équipe sans dépendre du PC allumé |

Suite de tests harness au 21/08 (après fusion de `equipe/c86e5a2c-a7e0-42fe-9c6e-88f0b2ffcb4f`,
fast-forward pur, commit `78b2c7e`) : **1814 pass, 0 fail**, typecheck propre.

## Ce soir, 2026-08-18 — cinq changements livrés

### 1. `deployer-pi.sh` — une seule commande pour le control plane du Pi
Enchaîne `deploy-harness-pi.sh` puis `deploy-web-pi.sh` **seulement si `pi-web/` a changé** (même
idiome de contrôle de fraîcheur que `deployer-tout.sh`). Résout `CCREMOTE_LIEN_SECRET` seul —
environnement de l'appelant, sinon `~/.config/ccremote/pc.env` (le fichier réel du service
`ccremote-pc`, qui porte déjà le même secret) — rien à exporter à la main. Refuse sur arbre de
travail sale. Ne touche ni le PC ni le VPS.

### 2. `CCREMOTE_VPS_LIEN_URL_PI` — piège fermé, pas un détail
`☠` **Panne réelle de 45 minutes le 18/08.** `CCREMOTE_LIEN_URL_PI` traîne légitimement dans
l'environnement du PC avec l'adresse LAN du Pi (`ws://pi.exemple:8721/`) — correcte pour le PC,
injoignable depuis le VPS. Un déploiement du VPS lancé depuis un shell du PC héritait donc
**silencieusement** de cette variable et écrivait sur le VPS une config qui ne peut pas fonctionner
(service actif, boucle de reconnexion à échec constant, deux occurrences ce jour-là).

`deploy-superviseur-vps.sh` lit désormais **`CCREMOTE_VPS_LIEN_URL_PI`**, un nom réservé au VPS
(même convention que `CCREMOTE_VPS_CIBLE`/`CCREMOTE_VPS_RACINE_DEV`/`CCREMOTE_VPS_MACHINE_ID` déjà
présentes dans ce script) — plus aucune collision possible avec la variable du poste qui lance le
déploiement. Défaut inchangé (tunnel public). Validé en exécutant la ligne de résolution réelle
dans 3 environnements : variable empoisonnée (LAN) → tunnel public retenu ; environnement vierge →
tunnel public inchangé ; `CCREMOTE_VPS_LIEN_URL_PI` explicite → surcharge respectée.

### 3. Trois défauts du registre de workers du PC, corrigés (`harness/superviseur/`)
1. **Le verdict « mort confirmé » ne vivait qu'en mémoire** — `restaurerRegistre()` le calculait
   mais `persistance.marquerMort()` n'était jamais appelé. La colonne `vivant` d'une ligne périmée
   restait à 1 indéfiniment. Persisté désormais au moment où le verdict est tranché.
2. **L'extinction propre du superviseur ne marquait mort aucun worker.** `arreterProprementLeParc()`
   ajouté, appelé depuis `assemble.arreter()` (SIGINT/SIGTERM) avant la fermeture du lien — marque
   mort, dans le registre persisté, tout worker encore vivant à l'extinction.
3. **`pid`/`pidStarttime` n'étaient jamais transmis à l'enregistrement**, bien que capturés au
   spawn — restaient `NULL` en base, rendant `revaliderProcess()` structurellement incapable de
   conclure « mort confirmé » lors d'un simple redémarrage de SERVICE (même boot machine). Corrigé :
   transmis à `RegistreWorkers.enregistrer()` au démarrage.

Validé dans les deux sens (git stash des fichiers de production : les nouveaux tests échouent sur
l'ancien code, passent sur le nouveau). Nettoyage associé hors dépôt : la ligne fantôme réelle du
registre de production marquée morte via `PersistanceRegistreSqlite.marquerMort()`.

### 4. `H-76` — un objet non sérialisable bloquait TOUTE inscription au registre PC depuis 20h19
`☠` `construire-worker-spec.ts` plaçait l'instance SDK réelle rendue par `createSdkMcpServer()`
directement dans `WorkerSpec.mcpServers` — un objet à références circulaires, pas une config.
`PersistanceRegistreSqlite.sauvegarder()` sérialisait `enregistrement.spec` tel quel :
`JSON.stringify` levait une `TypeError`, **catchée et loguée, mais la ligne n'était jamais écrite**
— échec silencieux. Le typage `WorkerSpecPersistee` excluait déjà ce champ sur le papier, mais
aucun code ne projetait réellement l'objet dessus avant `stringify` : le type n'avait aucun effet
à l'exécution.

Correctif : `projeterSpecPersistee()` construit maintenant ce qui part réellement sur disque.
`mcpServers` est réduit à une trace minimale toujours sérialisable (`{ type }` par nom de serveur,
jamais l'instance ni la config complète) — suffisant pour la restauration, qui ne relance jamais un
worker depuis une spec relue. Test de régression validé dans les deux sens. **Corrigé et vérifié en
production le soir même** (déployé, suite complète 1771 tests / 0 échec, typecheck propre).

### 5. Page de nouveautés opérateur
`pi-web/static/nouveautes-2026-08-18.html` — comparatif de ce qui a changé sur `master` entre le
07/08 et le 18/08, reformulé sans terme technique, déployé sur le Pi.

## 2026-08-21 — deux outils MCP de relecture des fils, fusionnés dans `master`

Branche `equipe/c86e5a2c-a7e0-42fe-9c6e-88f0b2ffcb4f` (commits `5240965` puis `78b2c7e`), fusionnée
par fast-forward pur (aucun commit de fusion, `master` n'avait pas divergé).

### `lister_fils` et `lire_fil` — relire l'historique des fils depuis l'orchestrateur
Deux nouveaux outils dans `mcp-controle/outils-historique-fils.ts`, tous deux `readOnlyHint`,
délégués à un nouveau dépôt `control-plane/registre/fils-historique.ts` qui n'exécute que des
`SELECT` (aucune écriture, aucune migration — propriété tenue par un test qui compare la base
fixture OCTET POUR OCTET avant et après une série d'appels aux deux outils).

- **`lister_fils`** — les fils enregistrés au registre (celui de l'appelant comme les autres),
  filtrables par plage de dates, avec pour chacun son identifiant, son titre, son nombre de
  messages et ses dates de premier/dernier événement. Défaut 20, plafond dur 100.
- **`lire_fil`** — les messages d'UN fil, ordre chronologique, avec émetteur et horodatage,
  filtrables par plage de dates, recherche textuelle optionnelle (insensible à la casse ET aux
  accents), pagination (`decalage`/`limite`). Défaut 50, plafond dur 200. Un fil inexistant est un
  refus nommé, jamais une page vide.

`☠` Le commit `78b2c7e` corrige deux défauts mesurés sur la base réelle du Pi avant même la
première mise en service de ces outils :
1. **`LEFT JOIN` au lieu d'`INNER JOIN`** dans `lister()` — un fil sans aucun événement (jamais
   écrit) disparaissait de tout listing, quelle que soit la plage demandée. Mesuré : 14 fils sur
   108 n'apparaissaient JAMAIS. Ces fils sont désormais rendus, soumis au filtre de plage via la
   date de mise à jour de leur propre ligne (`conversation.maj_a`), faute d'événement à filtrer.
2. **Recherche insensible aux accents** — le `LIKE` de SQLite ne fait de l'insensible-à-la-casse
   que sur l'ASCII. Mesuré sur un même fil : 213 correspondances pour « équipe » contre 2 pour
   « ÉQUIPE ». `bun:sqlite` ne permet pas d'enregistrer de fonction SQL custom (pas de
   `Database.function`) : la recherche se fait désormais en mémoire côté code (NFD + retrait des
   diacritiques + minuscule), appliquée au motif ET au contenu.

Mesures réelles du jour : base de production, **108 fils, 7 864 événements**, listing complet en
**42 ms sans index dédié**. Trois points laissés ouverts volontairement — voir `TODO.md`.

## Points en suspens (renvoi `TODO.md` pour le détail et l'effort estimé)

- `TODO.md` liste ~64 points ouverts préexistants + les défauts diagnostiqués courant août. Rien
  ci-dessus n'y était explicitement listé sous cette forme sauf le trou résiduel de persistance du
  registre PC (point 14 de la synthèse, désormais fermé — voir `TODO.md`).
- `harness/ARCHITECTURE.md` et `harness/ARBORESCENCE.md` datent du 07/08 et n'ont pas suivi la
  création du domaine `harness/apprentissage/` (44 fichiers, créé le 08/08) ni `harness/shared/`
  et `harness/config-equipe/` — signalé dans `TODO.md`, non corrigé (hors périmètre de cette passe :
  ce ne sont pas des fichiers racine).
- `SYNTHESE-CHANTIER.md` (2026-08-18, 137 lignes) fait doublon partiel avec ce fichier — c'est une
  synthèse décisionnelle des 68 points du `TODO.md`, pas un état du dépôt ; conservé tel quel, les
  deux répondent à des questions différentes (« qu'est-ce qui est vrai maintenant » ici, « que
  faire ensuite et dans quel ordre » là-bas).
- Domaine `harness/apprentissage/` : boucle d'apprentissage entre missions (extraction de leçons
  depuis les transcripts, base SQLite dédiée, consolidation périodique, injection au mandat),
  inspirée de Hermes Agent (Nous Research). Activation par `CCREMOTE_APPRENTISSAGE_ACTIF=1`, posée
  par `deployer-apprentissage.sh`. Au moins un défaut connu et documenté dans `TODO.md` (rapport
  final d'équipe parfois perdu avant persistance, `#enfilerApprentissageSiConfigure` drainant).
