# ARBORESCENCE — ccremote

Une ligne par fichier, responsabilité unique. Deux parties : le dépôt hors `harness/`
(format arborescent), puis `harness/` (format liste plate, groupé par sous-dossier —
557 fichiers, trop nombreux pour l'ASCII-art ci-dessus sans perdre en lisibilité).

```
client/
  ccremote.py              CLI sur le Raspberry Pi : Wake-on-LAN + statut (usage direct, hors pi-web)
  config.py                Constantes réseau du client CLI (PC_HOST, PC_MAC, users)
  requirements.txt         Dépendances Python du client CLI

pi-web/
  app.py                   App FastAPI : routes HTTP/SSE, auth par cookie de session, proxy vers le PC et vers le harness
  config.py                Constantes + secrets (.env) : hôte/MAC du PC, mot de passe UI, clés Cerebras (1 ou 2), HARNESS_API_URL
  pc_client.py              Client websocket vers server.py (ws_cmd) + envoi du magic packet WOL — système 1 uniquement
  harness_proxy.py          Relais /api/harness/* vers l'API du control plane du harness (loopback, port 8722), derrière check_session
  requirements.txt          Dépendances Python de pi-web
  .env                       Secrets locaux (gitignored) : UI_PASSWORD, CEREBRAS_API_KEY(_2 optionnelle)
  .env.example                Gabarit des variables d'environnement requises (doublon partiel du .env.example racine)
  CONTRAT-API-HARNESS.md      Contrat exact des routes /api/harness/* servies par pi-web et consommées par le front harness

  agent/
    __init__.py              Marqueur de package
    client.py                 Client Cerebras (AsyncOpenAI compatible) : modèles dispo, contexte par modèle, appel non-stream et stream
    context.py                 Estimation de tokens + compactage automatique de l'historique de conversation
    chat.py                     Boucle agentique streaming (SSE) : appelle le modèle, exécute les tool calls, yield les events
    tools.py                    Schémas de tools (OpenAI function-calling) + exécuteurs réels (status/metrics/sessions/comptes/shutdown)
    usage.py                    Capture des headers x-ratelimit-* Cerebras par clé (requêtes/tokens par minute/heure/jour), snapshot en mémoire

  templates/
    index.html                 Page principale SPA (Jinja2) : sidebar, vues système 1 + fragments harness inclus, panneau sessions/terminal, modals
    login.html                  Page de connexion (mot de passe unique, pas de comptes)
    _harness_styles.html         CSS spécifique aux vues harness (tokens DA cream/serif/orange)
    _harness_views.html          Marquage des conteneurs de vues harness (parc, orchestrateur, mission, comptes...), rendu peuplé en JS
    _harness_modals.html         Modales harness : mandat, arrêt d'urgence, pause, rallonge
    _pcstatus_view.html          Fragment de la vue « État du PC » (système 1)
    _settings_view.html          Fragment de la vue Réglages (système 1 + préférences harness)

  static/
    core.js                     État global du système 1, prefs/historique localStorage, router de vues, sidebar mobile, toasts/modals
    sidebar.js                   Statut PC live (polling), Wake-on-LAN, extinction PC — système 1
    chat.js                      Chat agent système 1 : streaming SSE, markdown, conversations persistantes (localStorage)
    sessions.js                  CRUD sessions tmux, terminal live (panneau droit), redimensionnement draggable — système 1
    pcview.js                    Vue « État du PC » : métriques détaillées (CPU/RAM/GPU/temp/disque/réseau) — système 1
    usage.js                     Contexte de la conversation + quotas API Cerebras (barres, couleurs par seuil) — système 1
    settings.js                  Préférences agent, sélection de modèle, switch de compte Claude Code — système 1

    harness-api.js               HarnessAPI — seul point d'accès fetch() aux données du harness, toute vue passe par lui
    harness-state.js             État d'affichage partagé du harness (namespacé HarnessState, ne collisionne pas avec state)
    harness-agent.js             Vue sous-agent : même niveau de détail que le lead, flux en lecture seule (H-72)
    harness-appels-outils.js     Carte repliable des appels d'outils consécutifs d'un tour, dans le fil
    harness-autonomie.js         Panneau/jauges d'autonomie de l'équipe dans le fil de l'orchestrateur
    harness-comptes.js           Vue Comptes & quotas
    harness-dialogue.js          Dialogues de saisie/confirmation à la charte de l'app (remplace window.prompt/confirm)
    harness-fil-bas.js           Bouton « retour au présent » dans un fil qui défile (ne pas rouvrir en haut)
    harness-horodatage.js        Formats d'horodatage et de durée partagés par les trois fils (orchestrateur/équipe/sous-agent)
    harness-markdown.js          Rendu markdown des messages (titres, gras, tableaux) au lieu du texte brut
    harness-menu-contextuel.js   Moteur générique de menu contextuel (clic droit), délégué sur document, lit data-menu
    harness-menus.js             Contenu des menus contextuels par genre d'objet (mission, équipe, message...)
    harness-mission-feed.js      Segmentation du fil brut d'une mission en « valises » lisibles
    harness-mission.js           Page mission (calquée sur Claude Code mobile) : mandat, équipe, identité, consommation, fil
    harness-mission-sheets.js    Feuilles détaillées de la page mission (outils, réflexions, identité, mandat, sous-agents)
    harness-mock-data.js         Données de démonstration/repli du harness, utilisées quand l'API réelle est indisponible
    harness-notifications.js     Notifications du parc, clic ouvre la conversation concernée
    nouveautes-2026-08-18.html   Page de nouveautés opérateur (déployée sur le Pi) — comparatif master 07/08→18/08 sans terme technique
    harness-orchestrateur.js     Vue Orchestrateur : multi-conversations + streaming par sondage /events?since=curseur
    harness-orch-options.js      Feuille « ··· » de la conversation orchestrateur (autonomie, rappels, statistiques)
    harness-parc.js              Vue Parc : missions du parc, arbre d'équipes, jauges
    harness-patch.js             Écriture DOM ciblée (diff, pas de réassignation innerHTML) pour un rafraîchissement invisible
    harness-pieces-jointes.js    Pièces jointes du composeur orchestrateur (trombone, collage, glisser-déposer)
    harness-rallonges.js         Décisions de rallonge du plafond d'autonomie (migration 27)
    harness-rappels.js           Rappels programmés dans le fil de l'orchestrateur
    harness-safety.js            Barre de sûreté + statut du lien Pi↔PC + démarrage
    harness-sheets.js            Moteur générique des feuilles modales (motif « valise » façon Claude Code)
    harness-valise.js            Valises dépliables en place dans le fil (pas en feuille modale)

server/
  server.py                Serveur websocket sur le PC principal : tmux (launch/kill/capture/send_keys),
                            métriques psutil/nvidia-smi, switch de compte Claude Code, poweroff
  config.py                 Constantes serveur : host/port d'écoute, commande de lancement Claude Code
  launch-claude.sh           Script lancé dans tmux : démarre Claude Code avec les bons flags/env
  ccremote-server.service    Unit systemd du serveur websocket
  requirements.txt           Dépendances Python du serveur

Upgrade/
  00-LIRE-DABORD.md         Point d'entrée de la spécification d'origine du harness, ordre de lecture
  01-verification-sdk.md     Faits vérifiés contre le SDK Claude Agent installé
  02-hypotheses.md            Décisions prises à la place de Chris, réversibles ou non
  03-couche-1.md               Les sept composants, six frontières, cinq propriétés — référence de ARCHITECTURE
  04-arbre-A-orchestrateur.md   Spécification de l'arbre A (orchestrateur)
  05-arbre-B-workers.md          Spécification de l'arbre B (workers)
  06-arbre-C-permissions.md       Spécification de l'arbre C (permissions)
  07-arbre-D-transport.md          Spécification de l'arbre D (transport réseau)
  08-arbre-E-etat-observabilite.md  Spécification de l'arbre E (état/observabilité)
  09-arbre-F-projets-equipes.md      Spécification de l'arbre F (projets/équipes)
  10-arbre-G-gardefous.md             Spécification de l'arbre G (garde-fous)
  11-missions.md                       Modèle de mission
  12-graphe-dependances.md              Graphe de dépendances entre composants
  13-arbre-F2-cycle-projet.md           Spécification du cycle de vie projet
  14-arbre-H-integration-retention.md    Spécification de l'arbre H (intégration/rétention)
  15-grille-revue.md                      Grille de revue de mission
  16-decisions-operateur.md                Décisions tranchées par Chris au fil du chantier

  apprentissage/
    ACTIVATION.md            Comment activer/désactiver la boucle d'apprentissage (CCREMOTE_APPRENTISSAGE_ACTIF)
    INVENTAIRE-HERMES.md      Inventaire du projet Hermes Agent (Nous Research), source d'inspiration
    PLAN-PORTAGE.md            Plan de portage de la conception Hermes vers ce dépôt, étape par étape
    PROTOCOLE-DEMONSTRATION.md  Protocole de la démonstration mesurée (voir harness/acceptation/demo-apprentissage/)
    SPEC-APPRENTISSAGE.md       Spécification du domaine harness/apprentissage/

design-v2/
  index.html                Maquette HTML statique de l'UI harness, DA cream/serif/orange validée par Chris
  COMPARAISON.md             v1 (production) ↔ v2 (maquette) : ce qui change et pourquoi

design-v3/
  index.html                Maquette HTML statique, base v2 + ajouts H-70/H-71/H-72
  CHANGEMENTS.md             v2 validée ↔ v3 : ce qui change et pourquoi

design-mission/
  index.html                Maquette HTML statique de la fiche mission

deploy-pi.sh                 Déploiement du client CLI (système 1) vers le Raspberry Pi
deploy-web-pi.sh             Déploiement de pi-web vers le Raspberry Pi (scp + restart systemd ccremote-web)
deploy-harness-pi.sh         Déploiement du control plane du harness (système 2) vers le Pi
deploy-superviseur-pc.sh     Recharge le superviseur du harness sur le PC (restart + contrôle de fraîcheur, pas de copie)
deploy-superviseur-vps.sh    Déploiement du superviseur (repli) du harness sur le VPS OVH (restart + contrôle de fraîcheur)
deploy-mcp-vps.sh            Déploiement des serveurs MCP utilisés par les équipes du VPS
deployer-pi.sh                Une seule commande : control plane du Pi + interface web SI elle a changé, résout seul le secret du lien
deployer-tout.sh              Une seule commande : les trois machines (Pi, PC, VPS) dans l'ordre imposé, garde équipes actives
deployer-apprentissage.sh     Une seule commande : active/porte la boucle d'apprentissage sur le superviseur du PC
start.sh                      Démarre pi-web en local pour le dev (PID file, logs/pi-web.log)
stop.sh                        Arrête l'instance de dev local de pi-web (via le PID file)
restart.sh                     stop.sh puis start.sh
.gitignore                     Exclusions : venv/, __pycache__/, chroma_data/, logs/, .env
.env.example                   Gabarit racine des secrets (chargés depuis pi-web/.env)
README.md                      Stack, ports, lancement manuel, déploiement — les deux systèmes
ARCHITECTURE.md                Carte des domaines, règles de frontière, définitions anti-rot — les deux systèmes
STATE.md                       État courant du projet, décisions, contexte non-évident
TODO.md                        Tâches en cours et backlog
SYNTHESE-CHANTIER.md           Synthèse décisionnelle des points ouverts du TODO (voir note dans STATE.md)
ARBORESCENCE.md                Ce fichier
logs/                          Répertoire de logs (vide dans le repo, reset à chaque start.sh)
```

# harness/

Arbre complet du dossier `harness/`, un fichier par ligne, chemins relatifs à `harness/`.

## `acceptation/` — bancs d'essai RÉELS (hors `bun test`, jamais lancés en CI)

- `acceptation/apprentissage-consolidation-periodique-reel.ts` — preuve du déclenchement périodique de la consolidation (E10) : refus tant qu'une mission tourne sur la machine, passe réelle exécutée une fois la mission clôturée, horloge de consolidation avancée
- `acceptation/apprentissage-inference-reel.ts` — banc RÉEL du client d'inférence (Haiku 4.5 via SDK Claude Code, remplace l'ancien banc vLLM) et de sa garde de sortie (E5, C-3)
- `acceptation/apprentissage-injection-reel.ts` — preuve E7 : leçon `active` semée en base, worker RÉEL lancé via `construireWorkerSpec`, leçon retrouvée dans son transcript JSONL
- `acceptation/apprentissage-innocuite-cloture.ts` — preuve d'innocuité E6 : moteur d'inférence injoignable, une mission simulée se clôt normalement, l'échec reste une entrée `passe_apprentissage.erreur`, jamais une exception qui remonte
- `acceptation/apprentissage-reduction-reel.ts` — banc RÉEL de la réduction déterministe d'un transcript (E2, C-1) : lecture seule, un vrai fichier du disque, sous la borne de 2000 tokens
- `acceptation/askuserquestion-bypass-reel.ts` — banc RÉEL : `AskUserQuestion` reste posable à l'orchestrateur passé en `permissionMode: 'bypassPermissions'`
- `acceptation/audit-permissions-reel.ts` — audit corrigé sur un refus réel
- `acceptation/bypass-denis-reel.ts` — `☠` prouve sur un worker RÉEL que `disallowedTools` tient en
  `bypassPermissions` : Write/Edit/NotebookEdit retirés de la liste d'outils, Read/Bash conservés,
  règle scopée du plancher toujours refusée. Tout l'accès `lecture` d'un mandat en dépend —
  **à repasser à tout changement de version du SDK**
- `acceptation/demo-apprentissage/CONTRAT-MESURES.md` — contrat en prose du fichier de mesures, seule frontière entre le protocole expérimental et le générateur de page
- `acceptation/demo-apprentissage/README.md` — mode d'emploi de la démonstration (produire des mesures réelles puis générer la page HTML)
- `acceptation/demo-apprentissage/demonstration.html` — page HTML autonome générée, preuve visuelle qu'une leçon réinjectée change le comportement mesuré d'une équipe
- `acceptation/demo-apprentissage/experience/agregation.ts` — dérive les agrégats par condition et assemble le descriptif statique du protocole, aucune nouvelle mesure
- `acceptation/demo-apprentissage/experience/contrat.ts` — le contrat du fichier de mesures, seule frontière entre le protocole (producteur) et le générateur de page (consommateur)
- `acceptation/demo-apprentissage/experience/extraction-jsonl.ts` — extrait toutes les mesures du transcript JSONL réel produit par le CLI, jamais une estimation, chaque champ revérifié par `typeof`/`Array.isArray`
- `acceptation/demo-apprentissage/experience/mandat.ts` — mandat des cobayes mot pour mot et blocs de leçons par condition, seule différence entre elles
- `acceptation/demo-apprentissage/experience/preparation.ts` — écrit une copie fraîche jetable du projet piège sous `os.tmpdir()`, suppression bornée au dossier jetable dédié
- `acceptation/demo-apprentissage/experience/projet-piege.ts` — gabarit fichier→contenu du projet jetable et de son piège, un dictionnaire pour ne pas être ramassé par `bun test`/`tsc` du harness
- `acceptation/demo-apprentissage/experience/protocole.ts` — point d'entrée exécutable du protocole : exécutions entrelacées entre conditions, écrit le fichier de mesures final
- `acceptation/demo-apprentissage/experience/verification.ts` — vérificateur externe : prépare sa propre copie du projet piège, rejoue la commande livrée, juge sur ce qu'il observe lui-même
- `acceptation/demo-apprentissage/mesures-factices.json` — jeu de mesures factices (`factice: true`) pour éprouver le rendu de la page sans exécution réelle
- `acceptation/demo-apprentissage/mesures.json` — fichier de mesures réel produit par une exécution du protocole
- `acceptation/demo-apprentissage/page/generer-page.ts` — point d'entrée exécutable du générateur : lit un fichier de mesures, le valide contre le contrat, écrit la page HTML, refuse d'écrire si non conforme
- `acceptation/demo-apprentissage/page/sections/bandeau.ts` — bandeau d'avertissement « chiffres factices », premier élément du corps dès que `factice === true`
- `acceptation/demo-apprentissage/page/sections/boucle.ts` — schéma SVG des quatre étapes fixes de la boucle d'apprentissage (observer → extraire → confirmer → réinjecter)
- `acceptation/demo-apprentissage/page/sections/entete.ts` — en-tête de la page : titre, thèse éditoriale, ligne de provenance (modèle, nombre d'exécutions, date)
- `acceptation/demo-apprentissage/page/sections/hermes.ts` — section prose fixe « ce qu'on a repris de Hermes », trois écarts documentés
- `acceptation/demo-apprentissage/page/sections/limites.ts` — section « ce que ça ne prouve pas », la liste des limites du protocole
- `acceptation/demo-apprentissage/page/sections/mesures-communs.ts` — regroupement par condition et légende partagés par les trois graphiques de mesures
- `acceptation/demo-apprentissage/page/sections/mesures-cout-duree.ts` — graphique coût moyen et durée médiane par condition, échelles calculées depuis les agrégats
- `acceptation/demo-apprentissage/page/sections/mesures-premier-coup.ts` — graphique « réussi du premier coup », barre segmentée par condition
- `acceptation/demo-apprentissage/page/sections/mesures-tableaux.ts` — tableaux par exécution et par agrégat de condition, valeur absente affichée « non mesuré »
- `acceptation/demo-apprentissage/page/sections/mesures-tentatives.ts` — graphique tentatives avant succès, une barre par exécution groupée par condition
- `acceptation/demo-apprentissage/page/sections/mesures.ts` — assemble les trois graphiques et les deux tableaux de la section « Les mesures », ne calcule rien lui-même
- `acceptation/demo-apprentissage/page/sections/outils.ts` — usage cumulé des outils par condition, barres monochromes triées par nombre d'appels décroissant
- `acceptation/demo-apprentissage/page/sections/pied.ts` — pied de page : chemin du fichier de mesures lu, version du contrat, date de génération
- `acceptation/demo-apprentissage/page/sections/piege.ts` — rend le piège et la tâche telles qu'écrites dans le fichier de mesures, jamais reformulées
- `acceptation/demo-apprentissage/page/sections/protocole.ts` — section « Le protocole » : les trois conditions, le mandat mot pour mot, les blocs de leçons, répétitions et critère de succès
- `acceptation/demo-apprentissage/page/sections/sens-inverse.ts` — section « Le sens inverse » : `sans_lecon` est la condition « leçon retirée », alternée avec les autres
- `acceptation/demo-apprentissage/page/sections/traces.ts` — section « Les traces réelles » : leçon mot pour mot, preuve d'injection, tâtonnement vs trajet direct
- `acceptation/demo-apprentissage/page/svg.ts` — primitives SVG pures (échelles, axes, formes), aucune donnée métier en dur
- `acceptation/demo-apprentissage/page/theme.ts` — charte visuelle : variables CSS et feuille de style complète, inline dans le document produit
- `acceptation/demo-apprentissage/page/utils.ts` — helpers transverses du générateur (échappement HTML, formatage de nombres, gabarit de section)
- `acceptation/lien-deux-machines-pc.ts` — banc RÉEL à deux machines (aucune session Claude Code, aucun quota consommé) : volet PC, à lancer après `lien-deux-machines-pi.ts`
- `acceptation/lien-deux-machines-pi.ts` — banc RÉEL à deux machines (aucune session Claude Code, aucun quota consommé) : volet Pi, à lancer en premier
- `acceptation/m02-flux-entree.ts` — flux d'entrée, 10 min de silence réel
- `acceptation/mcp-equipe-reel.ts` — banc RÉEL : une équipe voit-elle vraiment ses serveurs MCP ? preuve prise dans `mcp_servers` du message `init`, jamais `capabilities.tools`
- `acceptation/modeles-effort-reel.ts` — niveaux d'effort réels par modèle
- `acceptation/multi-comptes-reel.ts` — deux comptes Claude Code en parallèle
- `acceptation/observabilite-5-sousagents-reel.ts` — flux de sous-agents, non-déterminisme mesuré
- `acceptation/observabilite-sousagents-reel.ts` — flux de sous-agents, non-déterminisme mesuré
- `acceptation/orchestrateur-reel.ts` — M-40+M-41+M-42 assemblés sur une vraie session Opus
- `acceptation/parallelisme-git-reel.ts` — banc RÉEL du parallélisme git (mandat E2 câblage-worktree + mandat E3 H-56 assoupli) : deux équipes simultanées sur le même dépôt via le vrai `dispatcherMandat`, chacune dans son propre worktree
- `acceptation/plancher-moteur-reel.ts` — motifs du plancher de déni sur le vrai binaire
- `acceptation/session-store-reel.ts` — `SessionStore` sollicité par le vrai SDK
- `acceptation/taches-fond-sousagents-reel.ts` — `☠` prouve sur un flux RÉEL qu'un `init` est un début de tour
  et non un démarrage de process. Fait tourner le VRAI `CollecteurTelemetrie` en maintenant, en
  parallèle, la réplique de la règle d'AVANT : le même run montre les deux verdicts côte à côte
  (dernier passage : deux `result` où l'ancienne règle tuait l'équipe, gardée par la nouvelle)
- `acceptation/worker-reel.ts` — M-01+M-20+M-31 en conditions réelles
- `acceptation/worktree-git-reel.ts` — git réel, bug de perte de données trouvé et corrigé

## `anti-boucle/` — H-68, mission M-53, juge Haiku

- `anti-boucle/decision-coupure.test.ts` — biais asymétrique, `incertain` ne coupe jamais
- `anti-boucle/decision-coupure.ts` — biais asymétrique, `incertain` ne coupe jamais
- `anti-boucle/extraction-signaux.test.ts` — signaux agrégés sur les derniers tours
- `anti-boucle/extraction-signaux.ts` — signaux agrégés sur les derniers tours
- `anti-boucle/index.ts` — interface publique
- `anti-boucle/juge-haiku.test.ts` — `creerJugeHaiku()`, implémentation réelle du port `JugeBoucle`
- `anti-boucle/juge-haiku.ts` — `creerJugeHaiku()`, implémentation réelle du port `JugeBoucle`
- `anti-boucle/logger.ts` — journal pino
- `anti-boucle/paliers.test.ts` — paliers de déclenchement croissants
- `anti-boucle/paliers.ts` — paliers de déclenchement croissants
- `anti-boucle/types.ts` — formes de données

## `apprentissage/` — boucle d'apprentissage post-mission, conception inspirée de Hermes Agent (transposition indépendante)

- `apprentissage/base/base.test.ts` — preuve E1 : la base s'ouvre, les migrations s'appliquent deux fois sans casser les données, le dépôt de leçons écrit/relit correctement
- `apprentissage/base/connexion.test.ts` — tests de `connexion.ts`
- `apprentissage/base/connexion.ts` — ouverture/fermeture de la base SQLite d'apprentissage (E1), un seul écrivain, WAL, mêmes PRAGMA que `control-plane/registre/connexion.ts`
- `apprentissage/base/horloge-consolidation.ts` — date la dernière passe de consolidation (C-4) dans une ligne unique de `consolidation_etat`, ne décide jamais rien sur `lecon`
- `apprentissage/base/lecons.ts` — dépôt des leçons, de leurs observations et des passes d'apprentissage, seul point d'accès en écriture/lecture à ces trois tables
- `apprentissage/base/migrations.ts` — versionnage et application du schéma SQLite d'apprentissage, autorité `PRAGMA user_version`, sur le modèle de `control-plane/registre/migrations.ts`
- `apprentissage/competences/depot-competences.ts` — lecture/écriture des `COMPETENCE.md` (C-8), seul point d'accès aux fichiers de compétences, frontmatter YAML minimal jamais produit par le modèle
- `apprentissage/competences/operations.test.ts` — tests de `operations.ts`
- `apprentissage/competences/operations.ts` — application déterministe d'une `OperationCompetence` déjà validée par `garde-sortie.ts` ; seuils de convergence (trois leçons pour `creer`, une pour `ajouter_piege`), aucune exécution
- `apprentissage/extraction/client-inference.test.ts` — tests de `client-inference.ts`
- `apprentissage/extraction/client-inference.ts` — seul point de sortie réseau du domaine (C-3), inférence via SDK Claude Code (Haiku 4.5, compte-a, `maxTurns: 1`), indisponibilité toujours typée `{ disponible: false }`, jamais une exception
- `apprentissage/extraction/extraction-lecons.test.ts` — tests de `extraction-lecons.ts`
- `apprentissage/extraction/extraction-lecons.ts` — orchestre une passe d'extraction de leçons (C-3) : prompt, appel au client d'inférence, garde de sortie, filtre de la liste négative ; ne touche jamais `apprentissage.db`
- `apprentissage/extraction/garde-sortie.test.ts` — tests de `garde-sortie.ts`
- `apprentissage/extraction/garde-sortie.ts` — valide STRICTEMENT toute sortie du modèle avant écriture (sortie de modèle = entrée non fiable), message de rejet listant toujours les valeurs acceptées
- `apprentissage/extraction/prompts.ts` — gabarits de prompts pour le modèle local, courts, dimensionnés pour un 8B/Haiku, liste négative des cinq interdits reprise de SPEC §5.3
- `apprentissage/extraction/rapprochement.test.ts` — tests de `rapprochement.ts`
- `apprentissage/extraction/rapprochement.ts` — rapproche les leçons extraites de l'existant du même projet (C-5) : confirmation, contradiction, ou création `candidate` ; en zone grise, choisit toujours la sûreté
- `apprentissage/extraction/similarite-lexicale.ts` — rapprochement lexical pur de deux énoncés de leçon, sans modèle ni I/O, trigrammes de caractères
- `apprentissage/index.ts` — interface publique du domaine `apprentissage`, seul import autorisé de l'extérieur
- `apprentissage/injection/bloc-lecons.test.ts` — tests de `bloc-lecons.ts`
- `apprentissage/injection/bloc-lecons.ts` — compose le bloc de leçons injecté dans le mandat d'une équipe (C-6), auto-suffisant, zéro leçon ⇒ chaîne vide, ne lève jamais
- `apprentissage/logger.ts` — journal du domaine apprentissage et enveloppe d'erreur commune (`executer`)
- `apprentissage/observation/classement-issue.test.ts` — tests de `classement-issue.ts`
- `apprentissage/observation/classement-issue.ts` — classe comment une mission s'est terminée (C-2) à partir de faits déjà persistés, sans modèle ; type d'entrée propre au domaine, jamais importé de `control-plane/registre/`
- `apprentissage/observation/fixtures/transcript-reel-erreurs.jsonl` — fixture JSONL, extrait réel de transcript avec erreurs, pour les tests de réduction
- `apprentissage/observation/fixtures/transcript-reel-extrait.jsonl` — fixture JSONL, extrait réel de transcript, pour les tests de réduction
- `apprentissage/observation/lecture-jsonl.ts` — lecture EN FLUX d'un transcript JSONL, jamais `readFileSync` entier, ligne illisible comptée et ignorée
- `apprentissage/observation/reduction-transcript.test.ts` — tests de `reduction-transcript.ts`
- `apprentissage/observation/reduction-transcript.ts` — réduction déterministe d'un transcript JSONL en `ResumeMission` (C-1), pure, bornée quelle que soit la taille source
- `apprentissage/service/consolidation-periodique.test.ts` — tests de `consolidation-periodique.ts`
- `apprentissage/service/consolidation-periodique.ts` — déclenchement périodique de la consolidation : décide QUAND rappeler `executerConsolidation`, thunks relus à chaque tick, ne lève jamais
- `apprentissage/service/consolidation.test.ts` — tests de `consolidation.ts`
- `apprentissage/service/consolidation.ts` — passe de consolidation périodique (C-4) : transitions d'état par horloge puis retrait des doublons actifs, sauvegarde AVANT toute mutation, jamais de suppression
- `apprentissage/service/file-attente.test.ts` — tests de `file-attente.ts`
- `apprentissage/service/file-attente.ts` — point d'entrée unique de la file d'apprentissage à la clôture d'une mission, appel non bloquant par construction (`void enfilerPasseApprentissage(...)`)
- `apprentissage/service/passe-cloture.test.ts` — tests de `passe-cloture.ts`
- `apprentissage/service/passe-cloture.ts` — enchaîne une passe d'apprentissage complète (C-2 → C-1 → C-3 → C-5) sur une mission conclue, invariant absolu : ne lève jamais
- `apprentissage/service/resolution-projet.ts` — résout le chemin du dépôt git canonique depuis un `cwd` de worker (souvent un worktree dédié), via `git rev-parse --git-common-dir`
- `apprentissage/service/resolution-transcript.test.ts` — tests de `resolution-transcript.ts`
- `apprentissage/service/resolution-transcript.ts` — résout le chemin du transcript JSONL d'une mission depuis `sessionId`/`cwd`/`configDir`, réplique volontairement `cleProjet()` de `superviseur/sous-agents-disque.ts`
- `apprentissage/service/sauvegarde.test.ts` — tests de `sauvegarde.ts`
- `apprentissage/service/sauvegarde.ts` — sauvegarde `apprentissage.db` et `competences/` AVANT toute passe mutante, copie de fichiers, 5 sauvegardes conservées au maximum
- `apprentissage/types.ts` — formes de données du domaine apprentissage, aucune I/O

## `arret-urgence/` — G.4.3, mission M-52, drill récurrent

- `arret-urgence/canari-process.test.ts` — cible réelle du drill (process OS trivial, jamais une session CC)
- `arret-urgence/canari-process.ts` — cible réelle du drill (process OS trivial, jamais une session CC)
- `arret-urgence/exercice-periodique.test.ts` — `VerificateurDrillArretUrgence`
- `arret-urgence/exercice-periodique.ts` — `VerificateurDrillArretUrgence`
- `arret-urgence/index.ts` — interface publique
- `arret-urgence/logger.ts` — journal pino
- `arret-urgence/types.ts` — formes de données

## `budgets/` — branche G, mission M-51

- `budgets/classification-usage.test.ts` — classification des bannières `system` (limite/transition/avertissement)
- `budgets/classification-usage.ts` — classification des bannières `system` (limite/transition/avertissement)
- `budgets/garde-retry-watchdog.test.ts` — cohérence `CLAUDE_CODE_RETRY_WATCHDOG` (panne #15)
- `budgets/garde-retry-watchdog.ts` — cohérence `CLAUDE_CODE_RETRY_WATCHDOG` (panne #15)
- `budgets/index.ts` — interface publique
- `budgets/plafond-parc.test.ts` — `deciderCreationMission` (G.1.3), désactivé par défaut
- `budgets/plafond-parc.ts` — `deciderCreationMission` (G.1.3), désactivé par défaut
- `budgets/politique-usage.test.ts` — décision au franchissement (suspendre/notifier/tracer)
- `budgets/politique-usage.ts` — décision au franchissement (suspendre/notifier/tracer)
- `budgets/types.ts` — formes de données

## `composition/` — racine d'assemblage

- `composition/assemblage-lien-pc-pi.test.ts` — test d'assemblage H-75 : multiplexage contrôle/permissions sur le lien unique, reconnexion, réconciliation sur rattachement (aucun socket réel)
- `composition/assemblage-partiel-flux.test.ts` — test d'assemblage E.2 : un `stream_event` lu par le superviseur ressort en `partial` sur `GET /missions/:id`
- `composition/assemblage.test.ts` — test d'assemblage H-74/M-53 : garde-fous branchés sur le produit réel
- `composition/deploiement/ccremote-harness.service` — unité `systemd` du control plane sur le Pi (H-75 : le Pi héberge), arrêt toujours par PID exact (`systemctl stop`), jamais un `pkill` sur motif générique
- `composition/deploiement/ccremote-pc.service` — unité `systemd --user` du process PC, `Restart=always` (H-75)
- `composition/deploiement/config-orchestrateur/CLAUDE.md` — instructions de conduite de l'orchestrateur (comment il parle et se comporte, en anglais pour l'adhérence aux instructions ; la conversation reste toujours en français) ; distinct du mandat qui définit ce qu'il peut faire
- `composition/deploiement/config-orchestrateur/skills/campaign-planning/SKILL.md` — skill orchestrateur : planifier un chantier qui dépasse une seule équipe avant de lancer quoi que ce soit
- `composition/deploiement/config-orchestrateur/skills/mandate-framing/SKILL.md` — skill orchestrateur : cadrer un mandat qu'une équipe ne peut pas mal lire, avant chaque `creer_equipe`
- `composition/deploiement/config-orchestrateur/skills/parc-diagnosis/SKILL.md` — skill orchestrateur : établir ce qui est réellement cassé avant d'y dépenser une équipe
- `composition/deploiement/config-orchestrateur/skills/unattended-shift/SKILL.md` — skill orchestrateur : tenir une fenêtre d'autonomie longue sans personne qui regarde
- `composition/env.ts` — lecture stricte des variables d'environnement (obligatoire/optionnel/nombre/pourcentage)
- `composition/lien-pc-pi/correlateur.test.ts` — tests de `correlateur.ts`
- `composition/lien-pc-pi/correlateur.ts` — corrélation requête/réponse par id, partagée par les deux sens de multiplexage
- `composition/lien-pc-pi/identite-machine.test.ts` — tests de `identite-machine.ts`
- `composition/lien-pc-pi/identite-machine.ts` — l'identité d'une machine de travail sur le lien Pi↔machine (« qui se présente ? »), séparée du secret partagé qui, lui, est identique pour toutes les machines
- `composition/lien-pc-pi/protocole.ts` — enveloppes multiplexées (`controle_requete/reponse`, `permission_demande/verdict`) sur l'unique lien Pi↔PC (H-75)
- `composition/lien-pc-pi/secret.test.ts` — tests de `secret.ts`
- `composition/lien-pc-pi/secret.ts` — authentification du lien : secret en en-tête `Authorization: Bearer` (jamais dans l'URL, qui serait journalisée par Cloudflare Tunnel), comparaison à temps constant
- `composition/logger.ts` — journal pino du domaine composition
- `composition/pc/assembler-superviseur.ts` — racine de composition du PC (persistance+boot_id, anti-boucle, lien vers le Pi)
- `composition/pc/bin-pc.ts` — point d'entrée exécutable du process PC (`bun run start:pc`), conçu pour `systemd --user`
- `composition/pc/canal-controle-recepteur.ts` — reçoit les `controle_requete` du Pi sur le lien unique, les fait traverser `CanalControle`, répond (remplace `serveur-controle.ts`, supprimé)
- `composition/pc/client-lien-pi.test.ts` — verrouille les 2 défauts du banc à deux machines : backoff qui ne monte pas, refus d'authentification dégradé en coupure transitoire
- `composition/pc/client-lien-pi.ts` — H-75 : le PC INITIE (seul point d'entrée réseau sortant), reconnexion infinie backoff+gigue ; le connecteur ne résout que sur `open` RÉEL
- `composition/pc/construire-worker-spec.test.ts` — tests de `construire-worker-spec.ts`
- `composition/pc/construire-worker-spec.ts` — construit un `WorkerSpec` qui n'omet jamais `portAuditPermissions`
- `composition/pc/decouverte-comptes.test.ts` — tests de `decouverte-comptes.ts`
- `composition/pc/decouverte-comptes.ts` — quels comptes Claude cette machine peut-elle réellement utiliser, répondu par OBSERVATION du disque, jamais par une liste figée à l'installation (`CCREMOTE_PC_COMPTES` pouvait diverger du disque, mesuré 01/08)
- `composition/pc/horloge-avec-gigue.test.ts` — tests de `horloge-avec-gigue.ts`
- `composition/pc/horloge-avec-gigue.ts` — injecte de la gigue par tentative dans le backoff de `LienWebSocket` via le seam `HorlogeTransport` (limite mesurée : `backoffMs` est un tableau fixe, pas de gigue possible autrement)
- `composition/pi/assembler-control-plane.ts` — racine de composition du Pi (registre, bus, mcp-controle, orchestrateur, lien Pi↔PC)
- `composition/pi/balayage-cloture.ts` — clôt périodiquement, depuis le Pi, les équipes au repos qui verrouillent leur projet, boucle séparée de la télémétrie pour survivre à un PC éteint
- `composition/pi/balayage-quotas.test.ts` — banc des jauges : 100 % ⇒ compte `rejected` (H-53), sonde en échec qui n'écrase jamais une valeur connue
- `composition/pi/balayage-quotas.ts` — mesure en continu, DEPUIS LE PI, l'usage des fenêtres de rate limit de chaque compte par appel HTTP OAuth direct (toutes les 20 s), écrit au registre, PC allumé ou non
- `composition/pi/balayage-rappels.ts` — fait tirer les rappels échus à intervalle régulier depuis le Pi, indépendant du PC et de toute session vivante
- `composition/pi/balayage-telemetrie.test.ts` — banc : mort en cours de route, drainage des activités, réconciliation qui échoue sans arrêter le balayage
- `composition/pi/balayage-telemetrie.ts` — le Pi INTERROGE le PC (D.3.2) toutes les 5 s : modèle résolu, état SDK, coût (en écart), contexte ventilé, activités du lead, jauges de quota ; déclenche la réconciliation quand un worker MORT est vu sur une mission active
- `composition/pi/bin-pi.ts` — point d'entrée exécutable du process Pi (`bun run start:pi`)
- `composition/pi/choix-compte-orchestrateur.test.ts` — tests de `choix-compte-orchestrateur.ts`
- `composition/pi/choix-compte-orchestrateur.ts` — choisit sur QUEL compte l'orchestrateur maître démarre, à partir des quotas RÉELLEMENT mesurés par `balayage-quotas.ts`, jamais « toujours le premier » (dette de rotation en mémoire corrigée, vécue le 23/07)
- `composition/pi/client-superviseur-pc.ts` — `InventairePc`/`ReinitialisateurSession`/`ArreteurMission`/`RelanceurMission` réels, multiplexés sur le lien unique (D.3, inversé H-75)
- `composition/pi/machines-frontiere.test.ts` — la frontière HTTP du multi-machines, éprouvée sur un vrai serveur : ce que le navigateur reçoit réellement pour la liste des machines et la création d'un fil
- `composition/pi/parc-liens-machines.ts` — côté Pi, tient UN LIEN PAR MACHINE DE TRAVAIL identifiée et arbitre les connexions entrantes entre elles (remplace la file à un seul emplacement, dette n°6, 1268 évictions mesurées)
- `composition/pi/parc-superviseurs.test.ts` — tests de `parc-superviseurs.ts`
- `composition/pi/parc-superviseurs.ts` — côté Pi, sait à QUELLE MACHINE adresser une opération et la lui adresse, remplace le singulier de fait `ClientSuperviseurPc` par un routage explicite par mission/machine/toutes
- `composition/pi/port-utilisation-parc.ts` — `LecteurUtilisationParc` réel, backé par `Registre.comptes` (G.1.3)
- `composition/pi/reconciliation-sur-rattachement.ts` — câble `reconcilier(..., 'reconnexion')` sur CHAQUE rattachement du PC (epoch incrémenté à l'adoption d'orphelins, D.2.3/D.2.4)
- `composition/pi/reveil-wol.test.ts` — réveil Wake-on-LAN du PC en UDP broadcast LOCAL depuis le Pi, HORS canal D.3 ; MAC surchargeable via `CCREMOTE_PC_MAC`, valeur malformée refusée
- `composition/pi/reveil-wol.ts` — réveil Wake-on-LAN du PC en UDP broadcast LOCAL depuis le Pi, HORS canal D.3 (H-75 : le PC éteint n'a aucun lien à emprunter) ; MAC surchargeable via `CCREMOTE_PC_MAC`, valeur malformée refusée
- `composition/pi/serveur-lien-pc.test.ts` — banc d'assemblage du cycle extinction/rallumage : vrai `Bun.serve`, vrai client, refus 4401, supersede réel vs reconnexion légitime
- `composition/pi/serveur-lien-pc.ts` — H-75 : le Pi HÉBERGE le lien unique (Bun.serve WS, authentification, `LienWebSocket` symétrique en mode « attend la prochaine connexion »), oublie la connexion à sa fermeture
- `composition/pi/service-systeme.test.ts` — lecture (`is-active`/`show`) et redémarrage (`sudo -n systemctl restart`) LOCAUX d'une unité systemd du Pi via `execFile`, HORS canal D.3
- `composition/pi/service-systeme.ts` — lecture (`is-active`/`show`) et redémarrage (`sudo -n systemctl restart`) LOCAUX d'une unité systemd du Pi via `execFile` (jamais de shell interpolé), HORS canal D.3
- `composition/pi/verificateur-session-sdk.ts` — `VerificateurSessionExistante` réel via `getSessionInfo` du SDK

## `config-equipe/` — configuration des comptes d'équipe

- `config-equipe/CLAUDE-equipe.md` — instructions permanentes du team leader (dérivées de la configuration personnelle de l'opérateur, sans la relation humaine — aucune question posée n'atteint Chris)
- `config-equipe/installer-config-compte.sh` — installe la configuration Claude Code d'un compte d'équipe (CLAUDE.md, skills, règles, settings) par liens symboliques, corrige l'écart mesuré le 01/08 (`reference/` non lié, `compte-b` incomplet)

## `control-plane/` — branche Pi (autorité unique)

### `control-plane/api-web/` — API web lue par pi-web

- `control-plane/api-web/duree.ts` — libellés d'ancienneté partagés par les vues
- `control-plane/api-web/ecritures.ts` — les ordres que l'opérateur envoie depuis son téléphone ; lecture et écriture séparées, une écriture à moitié câblée rend un 501 explicite, jamais un 200 poli
- `control-plane/api-web/enveloppe.ts` — l'enveloppe `pcOnline`/`stale`/`data` : le PC absent n'est JAMAIS une erreur (H-75), une panne du control plane en reste une
- `control-plane/api-web/index.ts` — interface publique du module
- `control-plane/api-web/logger.ts` — journal pino du domaine
- `control-plane/api-web/serveur-api.test.ts` — banc : vrai serveur, vrai registre, les trois issues de l'enveloppe
- `control-plane/api-web/serveur-api.ts` — serveur HTTP en loopback (refuse de démarrer sur une interface publique : aucune authentification propre, pi-web la lui apporte)
- `control-plane/api-web/vue-comptes.ts` — jauges 5 h / 7 j en pourcentage + heure exacte du reset (AM/PM, avec le jour pour la semaine) ; `reset_a` est en **millisecondes** epoch, une seule convention
- `control-plane/api-web/vue-conversations.test.ts` — tests de `vue-conversations.ts`
- `control-plane/api-web/vue-conversations.ts` — traduit les conversations orchestrateur (domaine) vers le JSON servi à l'UI, définit le port dont l'API a besoin (implémenté par `GestionnaireConversations`)
- `control-plane/api-web/vue-feed.test.ts` — banc du fil : natures distinguées, permissions auto tracées, chemin bloqué jamais inventé
- `control-plane/api-web/vue-feed.ts` — le fil d'une mission : transitions d'état, permissions (y compris celles résolues seules par le lead, H-64) et activités du lead (réflexion / outil / texte)
- `control-plane/api-web/vue-missions.test.ts` — banc de l'état affiché (harness × SDK) et du contexte ventilé
- `control-plane/api-web/vue-missions.ts` — `Mission` du registre → forme d'affichage ; champs sans source réelle rendus vides, jamais fabriqués
- `control-plane/api-web/vue-notifications.ts` — forme des notifications servie à l'interface (`read` / `delivered` exposés séparément : deux faits distincts, jamais fondus)
- `control-plane/api-web/vue-rallonges.ts` — traduit les demandes de rallonge du plafond d'autonomie vers le JSON servi à l'UI ; `approuver` applique un réglage déjà décrit au fil, distinct de `PortMandats.approuver`
- `control-plane/api-web/vue-rappels.ts` — forme des rappels servie à l'interface ; `nextAt` rendu en horodatage ABSOLU, jamais un délai calculé côté serveur

### `control-plane/audit-permissions/` — C.5, mission M-22

- `control-plane/audit-permissions/collecteur.test.ts` — `CollecteurAuditPermissions`, trace d'audit
- `control-plane/audit-permissions/collecteur.ts` — `CollecteurAuditPermissions`, trace d'audit
- `control-plane/audit-permissions/hooks-sdk.test.ts` — adaptation aux hooks réels du SDK (`PreToolUse`, `tool_result`)
- `control-plane/audit-permissions/hooks-sdk.ts` — adaptation aux hooks réels du SDK (`PreToolUse`, `tool_result`)
- `control-plane/audit-permissions/index.ts` — interface publique
- `control-plane/audit-permissions/logger.ts` — journal pino
- `control-plane/audit-permissions/types.ts` — formes de données de l'audit

### `control-plane/autonomie/` — qui autorise un mandat, migration 15

- `control-plane/autonomie/decision-autorisation.test.ts` — plafond, puis fenêtre datée, puis engagement du fil
- `control-plane/autonomie/decision-autorisation.ts` — plafond, puis fenêtre datée, puis engagement du fil. L'ordre EST le garde-fou. Pur, aucune I/O
- `control-plane/autonomie/fenetre-autonomie.test.ts` — tests de `fenetre-autonomie.ts`
- `control-plane/autonomie/fenetre-autonomie.ts` — la fenêtre d'autonomie d'un fil : comment un instant s'écrit, quelles bornes une plage respecte, si un changement ÉLARGIT ou RESSERRE l'autonomie existante ; resserrer seul est permis, élargir passe par une demande tranchée par Chris
- `control-plane/autonomie/index.ts` — interface publique
- `control-plane/autonomie/reglage-plafond.test.ts` — tests de `reglage-plafond.ts`
- `control-plane/autonomie/reglage-plafond.ts` — le plafond d'autonomie d'un fil (ex-constante compilée `AUTO_APPROBATIONS_MAX = 40`) : trois états distincts `herite`/`illimite`/`valeur`, réglable sans redéploiement
- `control-plane/autonomie/relance-par-approbation.test.ts` — `☠` défaut mesuré en production le 07/08 : le comptage d'autonomie partait de `autonomieDebut`, qu'une approbation manuelle ne déplaçait pas, tenant le fil mort définitivement après 40 équipes ; test passant par un registre SQLite réel

### `control-plane/cloture/` — ce qui empêche une équipe au repos de verrouiller son projet (H-56)

- `control-plane/cloture/cloture.test.ts` — tests du domaine clôture
- `control-plane/cloture/index.ts` — interface publique du domaine clôture
- `control-plane/cloture/logger.ts` — journal pino du domaine clôture
- `control-plane/cloture/politique-cloture.ts` — décide quelles missions au repos ont assez attendu pour être closes, pur ; ne clôt jamais dès `running → idle` (l'état où on réinjecte un message), corrige la panne mesurée le 01/08 (équipe idle verrouillant son projet indéfiniment)
- `control-plane/cloture/service-cloture.ts` — applique la clôture des missions au repos : état terminal, trace dans le fil, libération du worker

### `control-plane/inspection/` — H-68, inspection à la demande

- `control-plane/inspection/etat-inspection.ts` — cycle de vie d'une inspection à la demande ; un verdict `boucle` ouvre une décision (`en_attente`/`confirme`/`decline`), une inspection répond mais ne coupe jamais d'elle-même
- `control-plane/inspection/index.ts` — interface publique
- `control-plane/inspection/inspection.test.ts` — tests du domaine inspection
- `control-plane/inspection/service-inspection.ts` — orchestre une inspection de bout en bout : interroge le juge sur le PC, persiste son verdict (corrige un verdict perdu à chaque rafraîchissement de page), puis arbitre

### `control-plane/notifications/` — canal asynchrone, migration 14

- `control-plane/notifications/detecteur-fin-equipe.test.ts` — tests de `detecteur-fin-equipe.ts`
- `control-plane/notifications/detecteur-fin-equipe.ts` — reconnaît `running → idle`, la seule transition où la fin d'un travail est observable. Pur
- `control-plane/notifications/index.ts` — interface publique du domaine
- `control-plane/notifications/logger.ts` — journal du domaine
- `control-plane/notifications/redaction.ts` — deux textes par fait : celui que Chris lit, celui que l'orchestrateur reçoit. Ce second est un PROMPT, pas un libellé. Pur
- `control-plane/notifications/service-notifications.test.ts` — tests de `service-notifications.ts`
- `control-plane/notifications/service-notifications.ts` — journalise PUIS tente la remise ; le réveil d'une session endormie est un choix explicite, jamais le défaut (quota)

### `control-plane/observabilite/` — E.2/C.4.2/F, mission M-50

- `control-plane/observabilite/arbre-flux.test.ts` — `ArbreFluxTempsReel`, diffusion par mission
- `control-plane/observabilite/arbre-flux.ts` — `ArbreFluxTempsReel`, diffusion par mission
- `control-plane/observabilite/completude-sous-agents.test.ts` — complétude des rapports de sous-agents
- `control-plane/observabilite/completude-sous-agents.ts` — complétude des rapports de sous-agents
- `control-plane/observabilite/diffusion-observation.test.ts` — `DiffusionObservation`, abonnements
- `control-plane/observabilite/diffusion-observation.ts` — `DiffusionObservation`, abonnements
- `control-plane/observabilite/index.ts` — interface publique
- `control-plane/observabilite/ligne-agent.test.ts` — ligne de travail d'un sous-agent
- `control-plane/observabilite/ligne-agent.ts` — ligne de travail d'un sous-agent
- `control-plane/observabilite/logger.ts` — journal pino
- `control-plane/observabilite/partiels-missions.ts` — état courant du bloc en cours de frappe par mission regardée (Pi, en mémoire, jamais SQLite)
- `control-plane/observabilite/permissions-fil.test.ts` — événements de permission dans le fil
- `control-plane/observabilite/permissions-fil.ts` — événements de permission dans le fil
- `control-plane/observabilite/registre-observation-parc.test.ts` — registre des observateurs du parc
- `control-plane/observabilite/registre-observation-parc.ts` — registre des observateurs du parc
- `control-plane/observabilite/types.ts` — formes de données

### `control-plane/orchestrateur/` — A.1/A.3.2/A.4.2, session orchestrateur maître

- `control-plane/orchestrateur/collecteur-conversation.test.ts` — tests de `collecteur-conversation.ts`
- `control-plane/orchestrateur/collecteur-conversation.ts` — transforme le flux SDK d'une session orchestrateur en événements affichables avec un VRAI streaming token par token (`stream_event` avant le message `assistant` complet), deux régimes jamais simultanés
- `control-plane/orchestrateur/conversation-operateur.test.ts` — tests de `conversation-operateur.ts`
- `control-plane/orchestrateur/conversation-operateur.ts` — transforme la session orchestrateur (flux SDK à lecteur unique) en un aller-retour question→réponse pour l'API web, un seul tour à la fois, jamais un second `for await`
- `control-plane/orchestrateur/dimensionnement.test.ts` — garde le dimensionnement des modèles d'une équipe : un mandat qui dit « laisse modèle/effort vides » et un `AgentInput.model` omis qui hérite du parent ont coûté 52,93 $ en six vagues (défaut mesuré 01/08)
- `control-plane/orchestrateur/dispatch-mandat.test.ts` — tests de `dispatch-mandat.ts`
- `control-plane/orchestrateur/dispatch-mandat.ts` — ce qui se passe quand l'opérateur AUTORISE un mandat (H-61), seul endroit du harness où une équipe est réellement créée ; mission inscrite au registre AVANT démarrage
- `control-plane/orchestrateur/entree/contrat-sdk.test.ts` — vérifie la forme réelle attendue par le SDK
- `control-plane/orchestrateur/entree/erreurs.ts` — erreurs typées du slice entrée
- `control-plane/orchestrateur/entree/file-attente.test.ts` — file de messages en attente de livraison
- `control-plane/orchestrateur/entree/file-attente.ts` — file de messages en attente de livraison
- `control-plane/orchestrateur/entree/generateur-entree.test.ts` — flux d'entrée asynchrone d'une session, un seul lecteur
- `control-plane/orchestrateur/entree/generateur-entree.ts` — flux d'entrée asynchrone d'une session, un seul lecteur
- `control-plane/orchestrateur/entree/horloge-simulee.test-util.ts` — utilitaire de test, horloge simulée
- `control-plane/orchestrateur/entree/index.ts` — interface publique du slice
- `control-plane/orchestrateur/entree/journal.ts` — journal injectable (silencieux par défaut)
- `control-plane/orchestrateur/entree/message-utilisateur.ts` — construction d'un `SDKUserMessage`
- `control-plane/orchestrateur/gestionnaire-conversations.test.ts` — tests de `gestionnaire-conversations.ts`
- `control-plane/orchestrateur/gestionnaire-conversations.ts` — gère N conversations orchestrateur INDÉPENDANTES (modèle ChatGPT), chacune sa propre session SDK, LAZY par conception, un seul lecteur par `query`
- `control-plane/orchestrateur/mcp-controle/carburant.test.ts` — protège un orchestrateur autonome de lancer une équipe à 95 % de sa fenêtre 5 h, qui serait coupée en route pour rien
- `control-plane/orchestrateur/mcp-controle/contrat.test.ts` — contrat de retour uniforme (`applique`/`accepte`/`refuse`/`differe`)
- `control-plane/orchestrateur/mcp-controle/contrat.ts` — contrat de retour uniforme (`applique`/`accepte`/`refuse`/`differe`)
- `control-plane/orchestrateur/mcp-controle/index.ts` — interface publique
- `control-plane/orchestrateur/mcp-controle/logger.ts` — journal pino
- `control-plane/orchestrateur/mcp-controle/mandat.test.ts` — construction d'une proposition de mandat (H-61)
- `control-plane/orchestrateur/mcp-controle/mandat.ts` — construction d'une proposition de mandat (H-61)
- `control-plane/orchestrateur/mcp-controle/outils-autonomie.test.ts` — tests de `outils-autonomie.ts`
- `control-plane/orchestrateur/mcp-controle/outils-autonomie.ts` — groupe « autonomie » : l'orchestrateur pilote la fenêtre de SON fil ; resserrer/terminer direct, ouvrir/élargir passe toujours par une demande écrite tranchée par Chris
- `control-plane/orchestrateur/mcp-controle/outils-budget.ts` — `definir_budget` (ex-`outils-arbitrage.ts` : `repondre_permission` est parti avec le bus d'escalade le 31/07)
- `control-plane/orchestrateur/mcp-controle/outils-cycle-vie.test.ts` — `creer_equipe`/`envoyer_a_equipe`/`interrompre`/`arreter`/`relancer`
- `control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts` — `creer_equipe`/`envoyer_a_equipe`/`interrompre`/`arreter`/`relancer`
- `control-plane/orchestrateur/mcp-controle/outils-fil.test.ts` — tests de `outils-fil.ts`
- `control-plane/orchestrateur/mcp-controle/outils-fil.ts` — groupe « fil » : l'orchestrateur nomme la conversation dans laquelle il parle, borné à LA conversation appelante via la closure du serveur
- `control-plane/orchestrateur/mcp-controle/outils-inspection.test.ts` — outils en lecture (lister/état/historique/permissions)
- `control-plane/orchestrateur/mcp-controle/outils-inspection.ts` — outils en lecture (lister/état/historique/permissions)
- `control-plane/orchestrateur/mcp-controle/outils-machine.test.ts` — groupe « machine » (A.2.2) : `etat_machine`/`reveiller_machine`
- `control-plane/orchestrateur/mcp-controle/outils-machine.ts` — groupe « machine » (A.2.2) : `etat_machine` (lecture pure, délègue à `metriques_hote`) et `reveiller_machine` (WoL, `accepte` jamais `applique`) ; `machine` en `z.enum(['pc'])` fermé
- `control-plane/orchestrateur/mcp-controle/outils-rallonge.test.ts` — tests de `outils-rallonge.ts`
- `control-plane/orchestrateur/mcp-controle/outils-rallonge.ts` — groupe « rallonge » : l'orchestrateur DEMANDE un relèvement de son plafond d'autonomie, il ne l'accorde jamais ; seul un clic humain applique un nouveau plafond
- `control-plane/orchestrateur/mcp-controle/outils-rappels.ts` — groupe « rappels » : l'orchestrateur agit sur le temps, tous les outils bornés à LA conversation appelante via la closure du serveur
- `control-plane/orchestrateur/mcp-controle/outils-service.test.ts` — groupe « service » (A.2.2) : `etat_service`/`piloter_service` sur les unités systemd du Pi
- `control-plane/orchestrateur/mcp-controle/outils-service.ts` — groupe « service » (A.2.2) : `etat_service`/`piloter_service` sur les unités systemd du Pi ; liste blanche à trois seaux, `piloter_service` n'expose que `restart`
- `control-plane/orchestrateur/mcp-controle/plafond.test.ts` — `avecPlafond`, garantie mécanique du non-blocage (A.2.1)
- `control-plane/orchestrateur/mcp-controle/plafond.ts` — `avecPlafond`, garantie mécanique du non-blocage (A.2.1)
- `control-plane/orchestrateur/mcp-controle/portee-liste.test.ts` — ce que `lister_equipes` montre et surtout ne montre PAS : historique borné au fil appelant, mais le VIVANT reste visible sur tout le parc (H-56, plafond de parc, fenêtre de quota partagés)
- `control-plane/orchestrateur/mcp-controle/serveur.test.ts` — assemble le serveur MCP (`createSdkMcpServer`), 12 outils
- `control-plane/orchestrateur/mcp-controle/serveur.ts` — assemble le serveur MCP (`createSdkMcpServer`), 12 outils
- `control-plane/orchestrateur/mcp-controle/types.ts` — ports vers B/D/E/F, `LecteurUtilisationParc` (G.1.3)
- `control-plane/orchestrateur/processus/alarme-fermeture-imprevue.test.ts` — alarme réelle H-60 (redémarrages plafonnés)
- `control-plane/orchestrateur/processus/alarme-fermeture-imprevue.ts` — alarme réelle H-60 (redémarrages plafonnés)
- `control-plane/orchestrateur/processus/contexte-integration.test.ts` — hooks de discipline de contexte (A.1.4)
- `control-plane/orchestrateur/processus/contexte-integration.ts` — hooks de discipline de contexte (A.1.4)
- `control-plane/orchestrateur/processus/demarrage.test.ts` — `demarrerOrchestrateur`, point d'entrée unique (n'attend jamais `init`)
- `control-plane/orchestrateur/processus/demarrage.ts` — `demarrerOrchestrateur`, point d'entrée unique (n'attend jamais `init`)
- `control-plane/orchestrateur/processus/entree-orchestrateur.test.ts` — entrée dédiée à l'orchestrateur (alarme H-60)
- `control-plane/orchestrateur/processus/entree-orchestrateur.ts` — entrée dédiée à l'orchestrateur (alarme H-60)
- `control-plane/orchestrateur/processus/identite.test.ts` — résolution de l'identité de session (froid/reprise), `StockageIdentiteFichier`
- `control-plane/orchestrateur/processus/identite.ts` — résolution de l'identité de session (froid/reprise), `StockageIdentiteFichier`
- `control-plane/orchestrateur/processus/incidents.test.ts` — journal d'incidents (fichier/mémoire)
- `control-plane/orchestrateur/processus/incidents.ts` — journal d'incidents (fichier/mémoire)
- `control-plane/orchestrateur/processus/index.ts` — interface publique
- `control-plane/orchestrateur/processus/logger.ts` — journal pino
- `control-plane/orchestrateur/processus/mandat.ts` — texte du mandat système de l'orchestrateur
- `control-plane/orchestrateur/processus/options-orchestrateur.test.ts` — composition des `Options`, invariants exécutables (acceptation a)
- `control-plane/orchestrateur/processus/options-orchestrateur.ts` — composition des `Options`, invariants exécutables (acceptation a)
- `control-plane/orchestrateur/prompt-lead.test.ts` — le prompt initial d'un team leader : garde que `rapport_equipe` (dernier bloc texte du lead, lu automatiquement à la fin d'une équipe) contient toutes les informations dont le lead a besoin pour ne pas se tromper
- `control-plane/orchestrateur/resultats-outils.test.ts` — tests de `resultats-outils.ts`
- `control-plane/orchestrateur/resultats-outils.ts` — lit dans le flux SDK ce qu'un appel d'outil de l'orchestrateur a DEMANDÉ et RENDU, et les affiche sans noyer le fil ; distinct de H-45 qui vise les sous-agents
- `control-plane/orchestrateur/titre-fil.test.ts` — tests de `titre-fil.ts`
- `control-plane/orchestrateur/titre-fil.ts` — qui a le droit de nommer un fil et quand : l'orchestrateur nomme une fois au deuxième message puis n'y touche plus, borne mécanique plutôt qu'une consigne de prompt

### `control-plane/pieces-jointes/` — fichiers joints à un message opérateur, migration 24

- `control-plane/pieces-jointes/index.ts` — interface publique du domaine
- `control-plane/pieces-jointes/pieces-jointes.test.ts` — refus avant toute écriture, traversée de chemin refusée (jamais
  « nettoyée »), extension dérivée du type validé et non du nom fourni
- `control-plane/pieces-jointes/pieces-jointes.ts` — validation PURE (types, plafonds, signature) puis écriture sur disque, et
  le bloc de texte qui donne à l'orchestrateur le chemin + la consigne `Read`. `☠` Il reçoit un
  CHEMIN, jamais l'image : mesuré le 04/08, son `Read` rend le contenu visuel d'un PNG, et un
  fichier survit à la compaction là où un bloc image dans le contexte ne survit pas.

### `control-plane/rappels/` — ce qui permet à l'orchestrateur d'agir sur le temps

- `control-plane/rappels/index.ts` — interface publique du domaine « rappels »
- `control-plane/rappels/logger.ts` — journal du domaine « rappels »
- `control-plane/rappels/politique-rappels.ts` — ce qu'un rappel a le droit d'être et quand il a le droit de tirer, pur ; bornes anti-boucle (période minimale cinq minutes) contre un rappel qui réveillerait une session Opus en boucle
- `control-plane/rappels/rappels.test.ts` — tests du domaine rappels
- `control-plane/rappels/service-rappels.ts` — fait tirer les rappels échus ou les reporte ; un tir peut être REPORTÉ plutôt qu'exécuté quand le carburant est tendu

### `control-plane/reconciliation/` — E.1.4/A.4.2/D.2.4, mission M-30

- `control-plane/reconciliation/index.ts` — interface publique
- `control-plane/reconciliation/logger.ts` — journal pino
- `control-plane/reconciliation/reconciliation.test.ts` — `reconcilier()`, « le PC gagne » mécaniquement
- `control-plane/reconciliation/reconciliation.ts` — `reconcilier()`, « le PC gagne » mécaniquement
- `control-plane/reconciliation/types.ts` — ports `InventairePc`/`ReinitialisateurSession`/`RedelivranceBusPermissions`/`LibererWorktree`

### `control-plane/registre/` — E.1, mission M-03, SQLite

- `control-plane/registre/capacites.ts` — capacités surveillées par mission
- `control-plane/registre/comptes.ts` — comptes Claude Code isolés (H-53) + relevés de quota (H-54)
- `control-plane/registre/connexion.ts` — ouverture/migration de la base (WAL, un seul écrivain)
- `control-plane/registre/conversations.test.ts` — tests de `conversations.ts`
- `control-plane/registre/conversations.ts` — fils de discussion de l'orchestrateur (migration 2) et leur journal d'événements ; écrire un événement bouge `conversation.maj_a` dans la MÊME transaction
- `control-plane/registre/etats.ts` — transitions d'état harness/SDK
- `control-plane/registre/index.ts` — interface publique + `ouvrirRegistre()`
- `control-plane/registre/journal.ts` — wrapper d'exécution + erreurs (`ErreurRegistre`)
- `control-plane/registre/lignes-conversation.ts` — forme SQL d'un fil et de ses événements, et sa traduction vers le domaine, extrait mécaniquement de `conversations.ts` pour tenir la limite de 500 lignes
- `control-plane/registre/lignes.ts` — mappers ligne SQL ↔ type domaine
- `control-plane/registre/lots.ts` — dépôt lots (« ce que j'ai demandé hier soir »)
- `control-plane/registre/migrations.test.ts` — migrations qui RECONSTRUISENT une table : « la migration s'est appliquée » et « les données sont encore là » sont deux faits distincts
- `control-plane/registre/migrations.ts` — schéma versionné
- `control-plane/registre/missions.test.ts` — dépôt missions, transitions d'état
- `control-plane/registre/missions.ts` — dépôt missions, transitions d'état
- `control-plane/registre/notifications.ts` — dépôt des faits notifiables (migration 14). `luA` (Chris) et `remisA`
  (orchestrateur) sont deux marqueurs indépendants
- `control-plane/registre/propositions.ts` — mandats proposés par l'orchestrateur et en attente d'autorisation humaine (H-61, migration 4), ce qui rend H-61 réellement applicable
- `control-plane/registre/rallonges.test.ts` — tests de `rallonges.ts`
- `control-plane/registre/rallonges.ts` — demandes de rallonge du plafond d'autonomie (migration 27) ; `trancher` change le statut, jamais `conversation.plafond_autonomie` directement — deux écritures distinctes, jamais fusionnées
- `control-plane/registre/rappels.ts` — rappels programmés d'une conversation (migration 16) ; toute lecture filtrée par `conversationId` sauf `echus()` qui sert le balayage global ; `prochaineA` toujours une échéance ABSOLUE
- `control-plane/registre/registre.test.ts` — tests d'intégration du point d'entrée `Registre`
- `control-plane/registre/resultat-outil.test.ts` — garde l'appariement des `tool_result` avec leur `tool_use_id` : le fil montrait ce qu'un lead lançait sans jamais montrer ce que ça donnait
- `control-plane/registre/types-evenement.test.ts` — garde la synchronisation entre `TypeEvenementConversation` (TypeScript) et le CHECK SQLite de `conversation_evenement`, panne de prod du 01/08 (migration 14 avait oublié le CHECK)
- `control-plane/registre/types.ts` — types du domaine registre

### `control-plane/session-store/` — E.3, mission M-31

- `control-plane/session-store/adaptateur.test.ts` — `SessionStoreSqlite`, miroir best-effort (H-15)
- `control-plane/session-store/adaptateur.ts` — `SessionStoreSqlite`, miroir best-effort (H-15)
- `control-plane/session-store/clef.ts` — dérivation de `projectKey` (cwd sanitisé)
- `control-plane/session-store/connexion.ts` — ouverture/migration de la base dédiée
- `control-plane/session-store/defaillances.ts` — table `session_defaillance`, divergence détectable
- `control-plane/session-store/divergence.test.ts` — tests de détection de divergence
- `control-plane/session-store/entrees.ts` — lecture/écriture des entrées de session
- `control-plane/session-store/index.ts` — interface publique + `ouvrirSessionStore()`
- `control-plane/session-store/journal.ts` — erreurs (`ErreurSessionStore`)
- `control-plane/session-store/lignes.ts` — mappers ligne SQL ↔ type domaine
- `control-plane/session-store/migrations.ts` — schéma versionné
- `control-plane/session-store/sommaire.ts` — résumé de l'état miroir

## `discipline-contexte/` — A.1.4, échantillonnage et compaction

- `discipline-contexte/contrats.ts` — formes de données, seuils par défaut
- `discipline-contexte/echantillonneur-contexte.test.ts` — lecture périodique de `getContextUsage()`
- `discipline-contexte/echantillonneur-contexte.ts` — lecture périodique de `getContextUsage()`
- `discipline-contexte/horloge.ts` — horloge injectable
- `discipline-contexte/index.ts` — interface publique
- `discipline-contexte/logger.ts` — journal pino
- `discipline-contexte/observateur-compaction.test.ts` — détection PreCompact/PostCompact
- `discipline-contexte/observateur-compaction.ts` — détection PreCompact/PostCompact
- `discipline-contexte/sentinelle-contexte.ts` — assemble échantillonneur + observateur

## `pause/` — B.4, pause et reprise d'un worker

- `pause/controleur-pause.test.ts` — `ControleurPause`, ni perte ni duplication
- `pause/controleur-pause.ts` — `ControleurPause`, ni perte ni duplication
- `pause/index.ts` — interface publique
- `pause/logger.ts` — journal pino
- `pause/partition.ts` — partition des messages « still queued »
- `pause/types.ts` — formes de données

## `pilotage/` — banc de pilotage du harness de production depuis une session de code

- `pilotage/client-pilote.ts` — parle au harness de PRODUCTION avec les MÊMES routes que l'interface web, authentification comprise (jamais un chemin de test parallèle) ; jeton de session `sha256(UI_PASSWORD)` recalculé pour éviter un aller-retour de login
- `pilotage/pilote.ts` — pilote le harness de production depuis une session de code : ouvre un fil d'orchestrateur, lui parle, autorise un mandat, lit une équipe, relève ce que ça a coûté ; permet de chiffrer le dimensionnement des modèles plutôt que de le décider à l'impression
- `pilotage/rendu-terminal.ts` — rend lisible au terminal ce que le harness renvoie, séparé du client pour que la mise en forme ne « arrondisse » jamais ce qu'elle affiche

## `plancher-deni/` — C.1.3/G.2, motifs de refus scopés

- `plancher-deni/index.ts` — interface publique
- `plancher-deni/motifs.test.ts` — `PLANCHER_DENI`, 16 motifs scopés
- `plancher-deni/motifs.ts` — `PLANCHER_DENI`, 16 motifs scopés
- `plancher-deni/simulateur-arbitrage.ts` — modèle fidèle du classifieur (vérifié en réel)
- `plancher-deni/types.ts` — formes de données
- `plancher-deni/validation.ts` — assertions exécutables (unicité, scope, borne)

## `projets/` — branche F, modèle projets/équipes

- `projets/chargeur-projets.test.ts` — `chargerProjets()`, déclaration = fichier JSON
- `projets/chargeur-projets.ts` — `chargerProjets()`, déclaration = fichier JSON
- `projets/cycle-vie-worktree.test.ts` — revendication/libération de worktree, epoch
- `projets/cycle-vie-worktree.ts` — revendication/libération de worktree, epoch
- `projets/git-projet-factice.ts` — doublure pour tests d'autres domaines
- `projets/git-projet.test.ts` — `InterrogateurGitReel`/`GestionnaireWorktreeGitReel`
- `projets/git-projet.ts` — `InterrogateurGitReel`/`GestionnaireWorktreeGitReel`
- `projets/index.ts` — interface publique
- `projets/logger.ts` — journal pino
- `projets/types.ts` — formes de données
- `projets/validation-config.test.ts` — validation d'une config projet
- `projets/validation-config.ts` — validation d'une config projet

## `relance/` — B.3.2/M-34, politique de relance (pas de `index.ts`)

- `relance/backoff.test.ts` — délai avant relance
- `relance/backoff.ts` — délai avant relance
- `relance/classification.test.ts` — groupes transitoire/structurel/borne atteinte
- `relance/classification.ts` — groupes transitoire/structurel/borne atteinte
- `relance/compteur-relances.test.ts` — `CompteurRelances`, plafond par mission
- `relance/compteur-relances.ts` — `CompteurRelances`, plafond par mission
- `relance/politique-relance.test.ts` — `deciderRelance()`, mapping `TerminalReason` → action
- `relance/politique-relance.ts` — `deciderRelance()`, mapping `TerminalReason` → action
- `relance/types.ts` — formes de données

## `shared/` — règles transverses, une par fichier, sans I/O

- `shared/acces-mandat.test.ts` — ce qu'une équipe a le DROIT de faire (`lecture` | `ecriture`) et les outils que ça refuse
- `shared/acces-mandat.ts` — ce qu'une équipe a le DROIT de faire (`lecture` | `ecriture`) et les outils que ça refuse. Source unique : `perimetre` est descriptif, lui seul porte un droit
- `shared/budget-equipe.test.ts` — tests de `budget-equipe.ts`
- `shared/budget-equipe.ts` — le plafond dur d'une équipe (`maxBudgetUsd`) distinct des paliers d'inspection anti-boucle (H-68) ; défaut mesuré en prod 01/08 : les deux valaient 12 $, rendant les huit paliers suivants inatteignables
- `shared/modeles-claude.test.ts` — catalogue des modèles et de leurs niveaux d'effort
- `shared/modeles-claude.ts` — catalogue des modèles et de leurs niveaux d'effort, aligné sur `supportedModels()` du SDK embarqué ; normalise ce qu'un LLM écrit spontanément
- `shared/routage-machine.ts` — le refus de routage vers une machine de travail (migration 22), vit dans `shared/` pour que l'API web puisse le reconnaître et rendre un 409 lisible plutôt qu'un 500 ; message toujours accompagné de la liste des machines utilisables
- `shared/saturation-compte.test.ts` — un verdict de saturation ne survit pas à sa fenêtre de quota
- `shared/saturation-compte.ts` — un verdict de saturation ne survit pas à sa fenêtre de quota

## `superviseur/` — branche B/D.3, mission M-13, superviseur PC

- `superviseur/anti-boucle-cablage.test.ts` — tests du câblage anti-boucle
- `superviseur/anti-boucle-workers.ts` — `CablageAntiBoucle`, câblage du juge (H-68), optionnalité bruyante (H-74)
- `superviseur/apprentissage-preserve-telemetrie.test.ts` — garde que `#enfilerApprentissageSiConfigure` ne draine plus `activitesEnAttente` de TOUTES les missions du process (panne mesurée) : le rapport final du lead survit désormais jusqu'au balayage périodique du Pi
- `superviseur/arret-urgence-sequence.ts` — séquence pause → fermeture → grâce → forçage (G.4)
- `superviseur/arret-urgence.test.ts` — tests de la séquence
- `superviseur/budgets-workers.ts` — relais `rate_limit_event`/messages d'usage vers `ObservateurUsage`
- `superviseur/canal-controle.test.ts` — `CanalControle` (D.3), idempotence par `opId`
- `superviseur/canal-controle.ts` — `CanalControle` (D.3), idempotence par `opId`
- `superviseur/collecteur-telemetrie.test.ts` — tests de `collecteur-telemetrie.ts`
- `superviseur/collecteur-telemetrie.ts` — ce que SEUL le PC observe : modèle résolu, coût, contexte ventilé, saturation de compte, et la file DRAINANTE des activités du lead (réflexion / outil / texte). Porte aussi le comptage des tâches de fond et l'état SDK, DÉRIVÉ à la lecture — « tour rendu » n'est pas « au repos »
- `superviseur/cout-en-cours-de-tour.test.ts` — garde que le coût mesuré bouge PENDANT le tour et ne redescend jamais, panne mesurée 01/08 : usage bloqué à 0 $ constant lu seulement sur un message `result` de fin de tour
- `superviseur/etat-git.test.ts` — état du dépôt d'une équipe (branche, fichiers non commités, dernier commit) : le fait qui distingue « a livré » de « a fini de parler »
- `superviseur/etat-git.ts` — état du dépôt d'une équipe (branche, fichiers non commités, dernier commit) : le fait qui distingue « a livré » de « a fini de parler » (migration 23)
- `superviseur/exploration-cablage.test.ts` — test d'ASSEMBLAGE : `explorerProjets` était écrit et correct mais appelé par personne, `SuperviseurWorkers` ne l'exposait jamais à `CanalControle` — seul un test d'assemblage pouvait le voir
- `superviseur/exploration-projets.ts` — listing en lecture seule BORNÉ à une racine (un `..` est résolu avant le contrôle, jamais après) ; `estDansRacine` y est la source unique du confinement
- `superviseur/fencing-arbitrage-workers.ts` — arbitrage de fencing appliqué au flux de résultats
- `superviseur/fencing-epoch.test.ts` — arbitrage d'epoch (panne #2)
- `superviseur/fencing-epoch.ts` — arbitrage d'epoch (panne #2)
- `superviseur/fencing-restauration.ts` — `ConcurrentsRestaures`, câblage restauration ↔ fencing
- `superviseur/identite-boot.ts` — identité du boot Linux courant, comparée à l'identité persistée d'un enregistrement (H-75, dette n°1) : après un redémarrage, `(pid, starttime)` peut être réattribué, tout ce qui précède le boot est mort
- `superviseur/index.ts` — interface publique
- `superviseur/jetons-comptes.ts` — lit côté PC le jeton d'accès OAuth de chaque compte pour que le Pi sonde les quotas lui-même en HTTP sans le PC ; aucun refresh ici, les refresh tokens sont tournants
- `superviseur/lecture-fichier.test.ts` — contenu d'un fichier en lecture seule
- `superviseur/lecture-fichier.ts` — contenu d'un fichier en lecture seule, MÊME racine que l'exploration, plafonné à 200 Ko (troncature annoncée) ; liens symboliques résolus avant le contrôle, binaires refusés
- `superviseur/logger.ts` — journal pino
- `superviseur/metriques-hote.test.ts` — tests de `metriques-hote.ts`
- `superviseur/metriques-hote.ts` — métriques hôte du PC (état service, ressources) servies à `etat_machine`
- `superviseur/observateur-flux-cablage.test.ts` — tests du relais de flux vers l'observabilité
- `superviseur/persistance-registre.test.ts` — `PersistanceRegistreSqlite` (dette n°1)
- `superviseur/persistance-registre.ts` — `PersistanceRegistreSqlite` (dette n°1)
- `superviseur/pilotage-workers.test.ts` — tests de `pilotage-workers.ts`
- `superviseur/pilotage-workers.ts` — actions de pilotage sur un worker (pause/reprise/instruction) exposées au superviseur
- `superviseur/recherche-projets.test.ts` — recherche de contenu bornée via `rg`
- `superviseur/recherche-projets.ts` — recherche de contenu bornée via `rg`. `chemin` OBLIGATOIRE : la racine
  entière dépasse deux minutes (mesuré 01/08). Confinement partagé avec `exploration-projets.ts`
- `superviseur/registre-workers.test.ts` — registre en mémoire + persistance à travers
- `superviseur/registre-workers.ts` — registre en mémoire + persistance à travers
- `superviseur/reponse-reinitialize.test.ts` — extraction (vide, H-73 tranché) des demandes en attente
- `superviseur/reponse-reinitialize.ts` — extraction (vide, H-73 tranché) des demandes en attente
- `superviseur/restauration-registre.test.ts` — `restaurerRegistre()`, revalidation pid+starttime
- `superviseur/restauration-registre.ts` — `restaurerRegistre()`, revalidation pid+starttime
- `superviseur/revalidation-process.test.ts` — lecture `/proc`, vivant/mort/indéterminé
- `superviseur/revalidation-process.ts` — lecture `/proc`, vivant/mort/indéterminé
- `superviseur/sonde-quotas-http.test.ts` — tests de `sonde-quotas-http.ts`
- `superviseur/sonde-quotas-http.ts` — mesure l'usage des fenêtres de rate limit d'un compte par appel HTTP direct à l'endpoint OAuth, SANS lancer de session Claude Code ; ~200 ms, aucun token consommé, jamais de refresh de jeton
- `superviseur/sonde-quotas.ts` — mesure RÉELLE des fenêtres de rate limit d'un compte (`usage_EXPERIMENTAL`) ; interroge dès `init` puis interrompt — la méthode n'est valable que pendant que la session vit, et la laisser ouverte consommerait le quota qu'on surveille
- `superviseur/sous-agents-disque.test.ts` — tests de `sous-agents-disque.ts`
- `superviseur/sous-agents-disque.ts` — établit depuis le DISQUE la liste des sous-agents d'une session et ce que chacun produit (source de complétude H-72.3) ; le flux `forwardSubagentText` est non déterministe, le disque est l'autorité (H.3.1)
- `superviseur/superviseur-workers-restauration.test.ts` — tests d'intégration restauration ↔ superviseur
- `superviseur/superviseur-workers-types.ts` — dépendances et constantes extraites (limite 500 lignes)
- `superviseur/superviseur-workers.test.ts` — `SuperviseurWorkers`, implémente tous les ports A.2/E.1.4
- `superviseur/superviseur-workers.ts` — `SuperviseurWorkers`, implémente tous les ports A.2/E.1.4
- `superviseur/taches-fond-init.test.ts` — `☠` la panne du 02/08 (mission ab7183f0, 7,72 $) : un `init` de reprise de tour ne doit PAS effacer les tâches de fond d'une équipe, et une tâche qui ne s'éteint jamais ne doit pas la rendre immortelle
- `superviseur/types.ts` — formes de données du domaine superviseur
- `superviseur/worktree-cablage.test.ts` — câblage E2 : `SuperviseurWorkers.demarrer()`/`arreter()` appellent réellement `GestionnaireCycleVieWorktree.allouer()`/`liberer()`, sur git RÉEL
- `superviseur/worktree-creation.test.ts` — garde la panne mesurée 01/08 : `spawn` sur un projet inexistant lève ENOENT mais le SDK rend un diagnostic FAUX (piste libc/binaire) au lieu du vrai répertoire manquant
- `superviseur/worktree-wiring-workers.ts` — câblage du cycle de vie worktree ↔ mission au démarrage/fin de vie d'un worker (F.2, E2), extrait mécaniquement de `superviseur-workers.ts` pour la limite de 500 lignes ; `ConfigProjet` reconstruit à la volée depuis un relevé git réel, jamais simulé

## `test-harness/` — outillage de test, jamais importé par un module de production

- `test-harness/README.md` — table de couverture des 38 pannes de la grille
- `test-harness/contrats/diffusion.ts` — contrat de panne injectable (diffusion)
- `test-harness/contrats/horloge.ts` — contrat de panne injectable (horloge)
- `test-harness/contrats/index.ts` — interface publique des contrats
- `test-harness/contrats/session-store.ts` — contrat de panne injectable (session-store)
- `test-harness/contrats/superviseur.ts` — contrat de panne injectable (superviseur)
- `test-harness/contrats/transport.ts` — contrat de panne injectable (transport)
- `test-harness/deterministe/alea-seme.test.ts` — aléa semé, déterministe
- `test-harness/deterministe/alea-seme.ts` — aléa semé, déterministe
- `test-harness/deterministe/horloge-simulee.test.ts` — horloge simulée
- `test-harness/deterministe/horloge-simulee.ts` — horloge simulée
- `test-harness/deterministe/index.ts` — interface publique du slice déterministe
- `test-harness/deterministe/pompe.ts` — pompe de tours
- `test-harness/doublures/diffusion-factice.test.ts` — doublure du port diffusion
- `test-harness/doublures/diffusion-factice.ts` — doublure du port diffusion
- `test-harness/doublures/lien-factice.test.ts` — doublure du port lien
- `test-harness/doublures/lien-factice.ts` — doublure du port lien
- `test-harness/doublures/store-sessions-factice.test.ts` — doublure du port store de sessions
- `test-harness/doublures/store-sessions-factice.ts` — doublure du port store de sessions
- `test-harness/doublures/superviseur-factice.test.ts` — doublure du port superviseur
- `test-harness/doublures/superviseur-factice.ts` — doublure du port superviseur
- `test-harness/doublures/tuyau-octets.test.ts` — doublure du port tuyau
- `test-harness/doublures/tuyau-octets.ts` — doublure du port tuyau
- `test-harness/journal/faits.ts` — faits journalisés d'une panne injectée
- `test-harness/journal/index.ts` — interface publique du journal de pannes
- `test-harness/journal/journal-pannes.test.ts` — journal de pannes injectées
- `test-harness/journal/journal-pannes.ts` — journal de pannes injectées
- `test-harness/logger.ts` — journal pino
- `test-harness/racine-temporaire.ts` — racine de fichiers éphémères sous `os.tmpdir()` : un test crée ce qu'il valide, jamais un chemin de scratchpad préparé à la main
- `test-harness/rejeu.ts` — rejeu déterministe d'un scénario

## `transport/` — branche D, mission M-10

- `transport/DECISION-TRANSPORT.md` — raisonnement du choix WebSocket (D.1.2)
- `transport/canal-donnees.test.ts` — `CanalDonnees`, séquencement des octets
- `transport/canal-donnees.ts` — `CanalDonnees`, séquencement des octets
- `transport/contrat.ts` — types `Lien`/`Tuyau`/`CanalControleProcessus`
- `transport/horloge-transport.ts` — horloge injectable (réelle par défaut)
- `transport/index.ts` — interface publique
- `transport/lien-websocket.test.ts` — `LienWebSocket` (D.1), ping/pong, coupures
- `transport/lien-websocket.ts` — `LienWebSocket` (D.1), ping/pong, coupures
- `transport/logger.ts` — journal pino
- `transport/spawn-processus-distant.test.ts` — adapte un `Lien` en `spawnClaudeCodeProcess`
- `transport/spawn-processus-distant.ts` — adapte un `Lien` en `spawnClaudeCodeProcess`
- `transport/trame.test.ts` — encodage/décodage des trames (texte/exit)
- `transport/trame.ts` — encodage/décodage des trames (texte/exit)

## `validation-proprietes/` — mission M-53, les cinq propriétés

- `validation-proprietes/README.md` — verdict par propriété, ce qui n'est pas prouvé
- `validation-proprietes/bornage.test.ts` — propriété de bornage
- `validation-proprietes/isolation.test.ts` — propriété d'isolation
- `validation-proprietes/modularite.test.ts` — propriété de modularité
- `validation-proprietes/non-blocage.test.ts` — propriété de non-blocage

## `workers/` — branche B, un worker = un process, un worktree

- `workers/audit-hooks.test.ts` — tests de `audit-hooks.ts`
- `workers/audit-hooks.ts` — branche `spec.portAuditPermissions` (C.5, M-22) sur `Options.hooks` d'un worker en garantissant qu'un hook ne bloque ni ne fait jamais échouer un tour ; port et callbacks individuellement capturés, jamais propagés au spawn
- `workers/can-use-tool.ts` — rappel `canUseTool` réduit à un refus fail-closed : le SDK lève si le champ manque lors d'une redélivrance, il n'arbitre plus rien
- `workers/config-compte.test.ts` — ce que la configuration d'un compte d'équipe doit contenir (CLAUDE.md, skills, règles, settings) et pourquoi son absence était invisible (`reference/` non lié sur aucun compte, `settings.json` manquant sur `compte-b`, relevé 01/08)
- `workers/index.ts` — interface publique
- `workers/logger.ts` — journal pino
- `workers/mcp-depense/serveur.test.ts` — tests de `serveur.ts`
- `workers/mcp-depense/serveur.ts` — serveur MCP en-process donnant à un lead la connaissance de SA PROPRE dépense (coût, plafond, part consommée, contexte) ; né d'un incident réel où une équipe a bâti son hypothèse sur un supposé dépassement de budget alors qu'elle était à 15 %
- `workers/mcp-du-poste.test.ts` — tests de `mcp-du-poste.ts`
- `workers/mcp-du-poste.ts` — donne à une équipe les serveurs MCP du poste, lus à la source et transmis EXPLICITEMENT au worker ; corrige le défaut « écrit, testé, branché sur rien » le plus coûteux mesuré (`mcpServers: []` pour toutes les équipes)
- `workers/model-floor.test.ts` — résolution d'alias modèle + plancher (H-43)
- `workers/model-floor.ts` — résolution d'alias modèle + plancher (H-43)
- `workers/options-composition.test.ts` — composition des `Options` SDK d'un worker (H-44)
- `workers/options-composition.ts` — composition des `Options` SDK d'un worker (H-44)
- `workers/preflight-config.test.ts` — pré-vol config machine (H-44, `machine_claude_md_missing`)
- `workers/preflight-config.ts` — pré-vol config machine (H-44, `machine_claude_md_missing`)
- `workers/process-spawner.test.ts` — spawn local, capture pid+starttime (dette n°1)
- `workers/process-spawner.ts` — spawn local, capture pid+starttime (dette n°1)
- `workers/removed-apis.test.ts` — garde de régression, API SDK supprimées
- `workers/start-worker.test.ts` — séquence de démarrage (pré-vol → spawn → capacités)
- `workers/start-worker.ts` — séquence de démarrage (pré-vol → spawn → capacités)
- `workers/types.ts` — `WorkerSpec`/`WorkerHandle`/`PortBusPermissions` (non exportés par `index.ts` — voir rapport)

## Racine `harness/`

- `.env.example` — variables d'environnement de composition
- `ARBORESCENCE.md` — arbre complet du dossier, un fichier par ligne
- `ARCHITECTURE.md` — carte des domaines, définitions, frontières
- `CHANTIER-MULTI-MACHINES.md` — trace du chantier deux machines de travail simultanées (PC + VPS), exécuté et en production le 2026-08-01 ; document historique, pas l'état courant
- `README.md` — lancement manuel, stack, ports
- `REPRISE.md` — point d'entrée pour reprendre le chantier à froid
- `bun.lock` — verrou des dépendances Bun
- `package.json` — scripts (`typecheck`, `test`, `lint`, `start:pc`, `start:pi`), dépendances épinglées
- `tsconfig.json` — configuration TypeScript stricte
