# ARBORESCENCE — harness d'orchestration ccremote

Arbre complet du dossier `harness/`, un fichier `.ts` par ligne. Généré par lecture du dépôt le
2026-07-22, à la clôture de la mission de composition. Les fichiers `*.test.ts` ne sont pas
recommentés individuellement (même rôle que leur fichier testé, suffixe `.test.ts`).

## `control-plane/api-web/` — API web lue par pi-web

- `control-plane/api-web/index.ts` — interface publique du module
- `control-plane/api-web/serveur-api.ts` — serveur HTTP en loopback (refuse de démarrer sur une interface publique : aucune authentification propre, pi-web la lui apporte)
- `control-plane/api-web/enveloppe.ts` — l'enveloppe `pcOnline`/`stale`/`data` : le PC absent n'est JAMAIS une erreur (H-75), une panne du control plane en reste une
- `control-plane/api-web/vue-missions.ts` — `Mission` du registre → forme d'affichage ; champs sans source réelle rendus vides, jamais fabriqués
- `control-plane/api-web/vue-comptes.ts` — jauges 5 h / 7 j en pourcentage + heure exacte du reset (AM/PM, avec le jour pour la semaine) ; `reset_a` est en **millisecondes** epoch, une seule convention
- `control-plane/api-web/vue-feed.ts` — le fil d'une mission : transitions d'état, permissions (y compris celles résolues seules par le lead, H-64) et activités du lead (réflexion / outil / texte)
- `control-plane/api-web/vue-feed.test.ts` — banc du fil : natures distinguées, permissions auto tracées, chemin bloqué jamais inventé
- `control-plane/api-web/vue-missions.test.ts` — banc de l'état affiché (harness × SDK) et du contexte ventilé
- `control-plane/api-web/duree.ts` — libellés d'ancienneté partagés par les vues
- `control-plane/api-web/serveur-api.test.ts` — banc : vrai serveur, vrai registre, les trois issues de l'enveloppe
- `control-plane/api-web/logger.ts` — journal pino du domaine

## `composition/` — racine d'assemblage (cette mission)

- `composition/logger.ts` — journal pino du domaine composition
- `composition/env.ts` — lecture stricte des variables d'environnement (obligatoire/optionnel/nombre/pourcentage)
- `composition/assemblage.test.ts` — test d'assemblage H-74/M-53 : garde-fous branchés sur le produit réel
- `composition/assemblage-lien-pc-pi.test.ts` — test d'assemblage H-75 : multiplexage contrôle/permissions sur le lien unique, reconnexion, réconciliation sur rattachement (aucun socket réel)
- `composition/lien-pc-pi/protocole.ts` — enveloppes multiplexées (`controle_requete/reponse`, `permission_demande/verdict`) sur l'unique lien Pi↔PC (H-75)
- `composition/lien-pc-pi/secret.ts` — authentification du lien : secret en en-tête `Authorization: Bearer` (jamais dans l'URL, qui serait journalisée par Cloudflare Tunnel), comparaison à temps constant
- `composition/lien-pc-pi/correlateur.ts` — corrélation requête/réponse par id, partagée par les deux sens de multiplexage
- `composition/pi/assembler-control-plane.ts` — racine de composition du Pi (registre, bus, mcp-controle, orchestrateur, lien Pi↔PC)
- `composition/pi/bin-pi.ts` — point d'entrée exécutable du process Pi (`bun run start:pi`)
- `composition/pi/serveur-lien-pc.ts` — H-75 : le Pi HÉBERGE le lien unique (Bun.serve WS, authentification, `LienWebSocket` symétrique en mode « attend la prochaine connexion »), oublie la connexion à sa fermeture pour ne pas compter chaque reconnexion du matin comme un doublon
- `composition/pi/serveur-lien-pc.test.ts` — banc d'assemblage du cycle extinction/rallumage : vrai `Bun.serve`, vrai client, refus 4401, supersede réel vs reconnexion légitime
- `composition/pi/client-superviseur-pc.ts` — `InventairePc`/`ReinitialisateurSession`/`ArreteurMission`/`RelanceurMission` réels, multiplexés sur le lien unique (D.3, inversé H-75)
- `composition/pi/permission-verdict-distant.ts` — reçoit les `permission_demande` du PC, interroge la vraie `MachineEtatsDemandes`, pousse le verdict (H-73.1 fermé pour de vrai en déploiement 2 machines)
- `composition/pi/reconciliation-sur-rattachement.ts` — câble `reconcilier(..., 'reconnexion')` sur CHAQUE rattachement du PC (epoch incrémenté à l'adoption d'orphelins, D.2.3/D.2.4)
- `composition/pi/port-utilisation-parc.ts` — `LecteurUtilisationParc` réel, backé par `Registre.comptes` (G.1.3)
- `composition/pi/balayage-telemetrie.ts` — le Pi INTERROGE le PC (D.3.2) toutes les 5 s : modèle résolu, état SDK, coût (en écart, jamais en absolu), contexte ventilé, activités du lead, jauges de quota ; déclenche la réconciliation quand un worker MORT est vu sur une mission active
- `composition/pi/balayage-telemetrie.test.ts` — banc : mort en cours de route, drainage des activités, réconciliation qui échoue sans arrêter le balayage
- `composition/pi/balayage-quotas.test.ts` — banc des jauges : 100 % ⇒ compte `rejected` (H-53), sonde en échec qui n'écrase jamais une valeur connue
- `composition/pi/ports-non-cables.ts` — `RepertoireCibles`/`DefinisseurBudget` : refus explicites, aucune implémentation réseau n'existe (voir rapport)
- `composition/pi/verificateur-session-sdk.ts` — `VerificateurSessionExistante` réel via `getSessionInfo` du SDK
- `composition/pc/assembler-superviseur.ts` — racine de composition du PC (persistance+boot_id, anti-boucle, lien vers le Pi)
- `composition/pc/bin-pc.ts` — point d'entrée exécutable du process PC (`bun run start:pc`), conçu pour `systemd --user` (voir `composition/deploiement/`)
- `composition/pc/client-lien-pi.ts` — H-75 : le PC INITIE (seul point d'entrée réseau sortant), reconnexion infinie backoff+gigue ; le connecteur ne résout que sur `open` RÉEL, sans quoi le backoff ne monte jamais (défaut mesuré au banc à deux machines)
- `composition/pc/client-lien-pi.test.ts` — verrouille les 2 défauts du banc à deux machines : backoff qui ne monte pas, refus d'authentification dégradé en coupure transitoire
- `acceptation/lien-deux-machines-pi.ts` / `-pc.ts` — banc RÉEL à deux machines (aucune session Claude Code, aucun quota consommé) : lancer le premier sur le Pi, le second sur le PC
- `composition/pc/horloge-avec-gigue.ts` — injecte de la gigue par tentative dans le backoff de `LienWebSocket` via le seam `HorlogeTransport` (limite mesurée : `backoffMs` est un tableau fixe, pas de gigue possible autrement)
- `composition/pc/canal-controle-recepteur.ts` — reçoit les `controle_requete` du Pi sur le lien unique, les fait traverser `CanalControle`, répond (remplace `serveur-controle.ts`, supprimé)
- `composition/pc/construire-worker-spec.ts` — construit un `WorkerSpec` qui n'omet jamais `portAuditPermissions`
- `composition/deploiement/ccremote-pc.service` — unité `systemd --user` du process PC, `Restart=always` (H-75)

## `control-plane/` — branche Pi (autorité unique)

### `orchestrateur/entree/` — A.1.3, générateur d'entrée
- `generateur-entree.ts` / `.test.ts` — flux d'entrée asynchrone d'une session, un seul lecteur
- `file-attente.ts` / `.test.ts` — file de messages en attente de livraison
- `message-utilisateur.ts` — construction d'un `SDKUserMessage`
- `erreurs.ts` — erreurs typées du slice entrée
- `journal.ts` — journal injectable (silencieux par défaut)
- `contrat-sdk.test.ts` — vérifie la forme réelle attendue par le SDK
- `horloge-simulee.test-util.ts` — utilitaire de test, horloge simulée
- `index.ts` — interface publique du slice

### `orchestrateur/mcp-controle/` — A.2, serveur MCP de contrôle
- `serveur.ts` / `.test.ts` — assemble le serveur MCP (`createSdkMcpServer`), 12 outils
- `outils-inspection.ts` / `.test.ts` — outils en lecture (lister/état/historique/permissions)
- `outils-cycle-vie.ts` / `.test.ts` — `creer_equipe`/`envoyer_a_equipe`/`interrompre`/`arreter`/`relancer`
- `outils-budget.ts` — `definir_budget` (ex-`outils-arbitrage.ts` : `repondre_permission` est parti avec le bus d'escalade le 31/07)
- `contrat.ts` / `.test.ts` — contrat de retour uniforme (`applique`/`accepte`/`refuse`/`differe`)
- `plafond.ts` / `.test.ts` — `avecPlafond`, garantie mécanique du non-blocage (A.2.1)
- `mandat.ts` / `.test.ts` — construction d'une proposition de mandat (H-61)
- `types.ts` — ports vers B/D/E/F, `LecteurUtilisationParc` (G.1.3)
- `logger.ts` — journal pino
- `index.ts` — interface publique

### `orchestrateur/processus/` — A.1/A.3.2/A.4.2, session orchestrateur maître
- `demarrage.ts` / `.test.ts` — `demarrerOrchestrateur`, point d'entrée unique (n'attend jamais `init`)
- `identite.ts` / `.test.ts` — résolution de l'identité de session (froid/reprise), `StockageIdentiteFichier`
- `options-orchestrateur.ts` / `.test.ts` — composition des `Options`, invariants exécutables (acceptation a)
- `contexte-integration.ts` / `.test.ts` — hooks de discipline de contexte (A.1.4)
- `entree-orchestrateur.ts` / `.test.ts` — entrée dédiée à l'orchestrateur (alarme H-60)
- `incidents.ts` / `.test.ts` — journal d'incidents (fichier/mémoire)
- `alarme-fermeture-imprevue.ts` / `.test.ts` — alarme réelle H-60 (redémarrages plafonnés)
- `mandat.ts` — texte du mandat système de l'orchestrateur
- `logger.ts` — journal pino
- `index.ts` — interface publique

### `reconciliation/` — E.1.4/A.4.2/D.2.4, mission M-30
- `reconciliation.ts` / `.test.ts` — `reconcilier()`, « le PC gagne » mécaniquement
- `types.ts` — ports `InventairePc`/`ReinitialisateurSession`/`RedelivranceBusPermissions`/`LibererWorktree`
- `logger.ts` — journal pino
- `index.ts` — interface publique

### `registre/` — E.1, mission M-03, SQLite
- `connexion.ts` — ouverture/migration de la base (WAL, un seul écrivain)
- `missions.ts` / `.test.ts` — dépôt missions, transitions d'état
- `etats.ts` — transitions d'état harness/SDK
- `lots.ts` — dépôt lots (« ce que j'ai demandé hier soir »)
- `comptes.ts` — comptes Claude Code isolés (H-53) + relevés de quota (H-54)
- `capacites.ts` — capacités surveillées par mission
- `lignes.ts` — mappers ligne SQL ↔ type domaine
- `migrations.ts` — schéma versionné
- `journal.ts` — wrapper d'exécution + erreurs (`ErreurRegistre`)
- `types.ts` — types du domaine registre
- `registre.test.ts` — tests d'intégration du point d'entrée `Registre`
- `index.ts` — interface publique + `ouvrirRegistre()`

### `bus-permissions/` — RETIRÉ le 2026-07-31
Le bus d'escalade était câblé de bout en bout et n'a jamais rien porté : son seul producteur
possible, `canUseTool`, n'est jamais appelé en `permissionMode: 'auto'`. Ce qui protège
réellement vit dans `disallowedTools` — plancher de déni (H-41) et `shared/acces-mandat.ts`.

### `audit-permissions/` — C.5, mission M-22
- `collecteur.ts` / `.test.ts` — `CollecteurAuditPermissions`, trace d'audit
- `hooks-sdk.ts` / `.test.ts` — adaptation aux hooks réels du SDK (`PreToolUse`, `tool_result`)
- `types.ts` — formes de données de l'audit
- `logger.ts` — journal pino
- `index.ts` — interface publique

### `observabilite/` — E.2/C.4.2/F, mission M-50
- `arbre-flux.ts` / `.test.ts` — `ArbreFluxTempsReel`, diffusion par mission
- `diffusion-observation.ts` / `.test.ts` — `DiffusionObservation`, abonnements
- `ligne-agent.ts` / `.test.ts` — ligne de travail d'un sous-agent
- `completude-sous-agents.ts` / `.test.ts` — complétude des rapports de sous-agents
- `permissions-fil.ts` / `.test.ts` — événements de permission dans le fil
- `registre-observation-parc.ts` / `.test.ts` — registre des observateurs du parc
- `types.ts` — formes de données
- `logger.ts` — journal pino
- `index.ts` — interface publique

### `session-store/` — E.3, mission M-31
- `adaptateur.ts` / `.test.ts` — `SessionStoreSqlite`, miroir best-effort (H-15)
- `connexion.ts` — ouverture/migration de la base dédiée
- `clef.ts` — dérivation de `projectKey` (cwd sanitisé)
- `entrees.ts` — lecture/écriture des entrées de session
- `lignes.ts` — mappers ligne SQL ↔ type domaine
- `migrations.ts` — schéma versionné
- `sommaire.ts` — résumé de l'état miroir
- `defaillances.ts` — table `session_defaillance`, divergence détectable
- `divergence.test.ts` — tests de détection de divergence
- `journal.ts` — erreurs (`ErreurSessionStore`)
- `index.ts` — interface publique + `ouvrirSessionStore()`

## `workers/` — branche B, un worker = un process, un worktree

- `start-worker.ts` / `.test.ts` — séquence de démarrage (pré-vol → spawn → capacités)
- `options-composition.ts` / `.test.ts` — composition des `Options` SDK d'un worker (H-44)
- `can-use-tool.ts` — rappel `canUseTool` réduit à un refus fail-closed : le SDK lève si le champ manque lors d'une redélivrance, il n'arbitre plus rien
- `process-spawner.ts` / `.test.ts` — spawn local, capture pid+starttime (dette n°1)
- `preflight-config.ts` / `.test.ts` — pré-vol config machine (H-44, `machine_claude_md_missing`)
- `model-floor.ts` / `.test.ts` — résolution d'alias modèle + plancher (H-43)
- `removed-apis.test.ts` — garde de régression, API SDK supprimées
- `types.ts` — `WorkerSpec`/`WorkerHandle`/`PortBusPermissions` (non exportés par `index.ts` — voir rapport)
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `superviseur/` — branche B/D.3, mission M-13, superviseur PC

- `superviseur-workers.ts` / `.test.ts` — `SuperviseurWorkers`, implémente tous les ports A.2/E.1.4
- `superviseur-workers-types.ts` — dépendances et constantes extraites (limite 500 lignes)
- `canal-controle.ts` / `.test.ts` — `CanalControle` (D.3), idempotence par `opId`
- `persistance-registre.ts` / `.test.ts` — `PersistanceRegistreSqlite` (dette n°1)
- `restauration-registre.ts` / `.test.ts` — `restaurerRegistre()`, revalidation pid+starttime
- `fencing-restauration.ts` — `ConcurrentsRestaures`, câblage restauration ↔ fencing
- `fencing-epoch.ts` / `.test.ts` — arbitrage d'epoch (panne #2)
- `revalidation-process.ts` / `.test.ts` — lecture `/proc`, vivant/mort/indéterminé
- `registre-workers.ts` / `.test.ts` — registre en mémoire + persistance à travers
- `reponse-reinitialize.ts` / `.test.ts` — extraction (vide, H-73 tranché) des demandes en attente
- `arret-urgence-sequence.ts` — séquence pause → fermeture → grâce → forçage (G.4)
- `arret-urgence.test.ts` — tests de la séquence
- `anti-boucle-workers.ts` — `CablageAntiBoucle`, câblage du juge (H-68), optionnalité bruyante (H-74)
- `anti-boucle-cablage.test.ts` — tests du câblage anti-boucle
- `budgets-workers.ts` — relais `rate_limit_event`/messages d'usage vers `ObservateurUsage`
- `sonde-quotas.ts` — mesure RÉELLE des fenêtres de rate limit d'un compte (`usage_EXPERIMENTAL`) ; interroge dès `init` puis interrompt — la méthode n'est valable que pendant que la session vit, et la laisser ouverte consommerait le quota qu'on surveille
- `collecteur-telemetrie.ts` — ce que SEUL le PC observe : modèle résolu, coût, contexte ventilé, saturation de compte, et la file DRAINANTE des activités du lead (réflexion / outil / texte)
- `exploration-projets.ts` — listing en lecture seule BORNÉ à une racine (un `..` est résolu avant le contrôle, jamais après) ; `estDansRacine` y est la source unique du confinement
- `lecture-fichier.ts` / `.test.ts` — contenu d'un fichier en lecture seule, MÊME racine que l'exploration, plafonné à 200 Ko (troncature annoncée) ; liens symboliques résolus avant le contrôle, binaires refusés
- `fencing-arbitrage-workers.ts` — arbitrage de fencing appliqué au flux de résultats
- `observateur-flux-cablage.test.ts` — tests du relais de flux vers l'observabilité
- `superviseur-workers-restauration.test.ts` — tests d'intégration restauration ↔ superviseur
- `types.ts` — formes de données du domaine superviseur
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `transport/` — branche D, mission M-10

- `lien-websocket.ts` / `.test.ts` — `LienWebSocket` (D.1), ping/pong, coupures
- `canal-donnees.ts` / `.test.ts` — `CanalDonnees`, séquencement des octets
- `spawn-processus-distant.ts` / `.test.ts` — adapte un `Lien` en `spawnClaudeCodeProcess`
- `trame.ts` / `.test.ts` — encodage/décodage des trames (texte/exit)
- `horloge-transport.ts` — horloge injectable (réelle par défaut)
- `contrat.ts` — types `Lien`/`Tuyau`/`CanalControleProcessus`
- `logger.ts` — journal pino
- `index.ts` — interface publique
- `DECISION-TRANSPORT.md` — raisonnement du choix WebSocket (D.1.2)

## `plancher-deni/` — C.1.3/G.2, motifs de refus scopés

- `motifs.ts` / `.test.ts` — `PLANCHER_DENI`, 16 motifs scopés
- `validation.ts` — assertions exécutables (unicité, scope, borne)
- `simulateur-arbitrage.ts` — modèle fidèle du classifieur (vérifié en réel)
- `types.ts` — formes de données
- `index.ts` — interface publique

## `budgets/` — branche G, mission M-51

- `plafond-parc.ts` / `.test.ts` — `deciderCreationMission` (G.1.3), désactivé par défaut
- `politique-usage.ts` / `.test.ts` — décision au franchissement (suspendre/notifier/tracer)
- `classification-usage.ts` / `.test.ts` — classification des bannières `system` (limite/transition/avertissement)
- `garde-retry-watchdog.ts` / `.test.ts` — cohérence `CLAUDE_CODE_RETRY_WATCHDOG` (panne #15)
- `types.ts` — formes de données
- `index.ts` — interface publique

## `anti-boucle/` — H-68, mission M-53, juge Haiku

- `juge-haiku.ts` / `.test.ts` — `creerJugeHaiku()`, implémentation réelle du port `JugeBoucle`
- `decision-coupure.ts` / `.test.ts` — biais asymétrique, `incertain` ne coupe jamais
- `paliers.ts` / `.test.ts` — paliers de déclenchement croissants
- `extraction-signaux.ts` / `.test.ts` — signaux agrégés sur les derniers tours
- `types.ts` — formes de données
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `arret-urgence/` — G.4.3, mission M-52, drill récurrent

- `exercice-periodique.ts` / `.test.ts` — `VerificateurDrillArretUrgence`
- `canari-process.ts` / `.test.ts` — cible réelle du drill (process OS trivial, jamais une session CC)
- `types.ts` — formes de données
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `discipline-contexte/` — A.1.4, échantillonnage et compaction

- `echantillonneur-contexte.ts` / `.test.ts` — lecture périodique de `getContextUsage()`
- `observateur-compaction.ts` / `.test.ts` — détection PreCompact/PostCompact
- `sentinelle-contexte.ts` — assemble échantillonneur + observateur
- `contrats.ts` — formes de données, seuils par défaut
- `horloge.ts` — horloge injectable
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `relance/` — B.3.2/M-34, politique de relance (pas de `index.ts`, voir rapport)

- `politique-relance.ts` / `.test.ts` — `deciderRelance()`, mapping `TerminalReason` → action
- `classification.ts` / `.test.ts` — groupes transitoire/structurel/borne atteinte
- `backoff.ts` / `.test.ts` — délai avant relance
- `compteur-relances.ts` / `.test.ts` — `CompteurRelances`, plafond par mission
- `types.ts` — formes de données

## `projets/` — branche F, modèle projets/équipes

- `chargeur-projets.ts` / `.test.ts` — `chargerProjets()`, déclaration = fichier JSON
- `cycle-vie-worktree.ts` / `.test.ts` — revendication/libération de worktree, epoch
- `validation-config.ts` / `.test.ts` — validation d'une config projet
- `git-projet.ts` / `.test.ts` — `InterrogateurGitReel`/`GestionnaireWorktreeGitReel`
- `git-projet-factice.ts` — doublure pour tests d'autres domaines
- `types.ts` — formes de données
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `pause/` — B.4, pause et reprise d'un worker

- `controleur-pause.ts` / `.test.ts` — `ControleurPause`, ni perte ni duplication
- `partition.ts` — partition des messages « still queued »
- `types.ts` — formes de données
- `logger.ts` — journal pino
- `index.ts` — interface publique

## `shared/` — règles transverses, une par fichier, sans I/O

- `acces-mandat.ts` / `.test.ts` — ce qu'une équipe a le DROIT de faire (`lecture` | `ecriture`) et les outils que ça refuse. Source unique : `perimetre` est descriptif, lui seul porte un droit
- `modeles-claude.ts` / `.test.ts` — catalogue des modèles et de leurs niveaux d'effort, aligné sur `supportedModels()` du SDK embarqué ; normalise ce qu'un LLM écrit spontanément
- `saturation-compte.ts` / `.test.ts` — un verdict de saturation ne survit pas à sa fenêtre de quota

## `test-harness/` — outillage de test, jamais importé par un module de production

- `contrats/*.ts` — contrats de pannes injectables (transport, session-store, superviseur, diffusion, horloge)
- `racine-temporaire.ts` — racine de fichiers éphémères sous `os.tmpdir()` : un test crée ce qu'il valide, jamais un chemin de scratchpad préparé à la main
- `deterministe/*.ts` — horloge simulée, aléa semé, pompe de tours
- `doublures/*.ts` — doublures des ports externes (diffusion, lien, store, superviseur, tuyau)
- `journal/*.ts` — journal de pannes injectées
- `rejeu.ts` — rejeu déterministe d'un scénario
- `logger.ts` — journal pino
- `README.md` — table de couverture des 38 pannes de la grille

## `validation-proprietes/` — mission M-53, les cinq propriétés

- `non-blocage.test.ts` / `isolation.test.ts` / `modularite.test.ts` / `bornage.test.ts`
- `reprise.test.ts` — RETIRÉ le 2026-07-31 : la propriété portait entièrement sur la redélivrance du bus d'escalade, qui n'existe plus
- `README.md` — verdict par propriété, ce qui n'est pas prouvé

## `acceptation/` — bancs d'essai RÉELS (hors `bun test`, jamais lancés en CI)

- `orchestrateur-reel.ts` — M-40+M-41+M-42 assemblés sur une vraie session Opus
- `worker-reel.ts` — M-01+M-20+M-31 en conditions réelles
- `bypass-denis-reel.ts` — `☠` prouve sur un worker RÉEL que `disallowedTools` tient en
  `bypassPermissions` : Write/Edit/NotebookEdit retirés de la liste d'outils, Read/Bash conservés,
  règle scopée du plancher toujours refusée. Tout l'accès `lecture` d'un mandat en dépend —
  **à repasser à tout changement de version du SDK**
- `worktree-git-reel.ts` — git réel, bug de perte de données trouvé et corrigé
- `multi-comptes-reel.ts` — deux comptes Claude Code en parallèle
- `session-store-reel.ts` — `SessionStore` sollicité par le vrai SDK
- `plancher-moteur-reel.ts` — motifs du plancher de déni sur le vrai binaire
- `audit-permissions-reel.ts` — audit corrigé sur un refus réel
- `m02-flux-entree.ts` — flux d'entrée, 10 min de silence réel
- `modeles-effort-reel.ts` — niveaux d'effort réels par modèle
- `observabilite-sousagents-reel.ts` / `observabilite-5-sousagents-reel.ts` — flux de sous-agents, non-déterminisme mesuré

## Racine `harness/`

- `package.json` — scripts (`typecheck`, `test`, `lint`, `start:pc`, `start:pi`), dépendances épinglées
- `tsconfig.json` — configuration TypeScript stricte
- `REPRISE.md` — point d'entrée pour reprendre le chantier à froid
- `README.md` — lancement manuel, stack, ports (cette mission)
- `ARCHITECTURE.md` — carte des domaines, définitions, frontières (cette mission)
- `ARBORESCENCE.md` — ce fichier
- `.env.example` — variables d'environnement de composition (cette mission)
