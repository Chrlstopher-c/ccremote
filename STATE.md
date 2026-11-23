# STATE — ccremote

*Dernière mise à jour : 2026-11-16 (nuit), branche `nuit/2026-11-15` (commitée, non poussée, non déployée)*

## Résumé

**ccremote v2 est en production sur les quatre machines.** Le Pi n'héberge plus d'orchestrateur LLM : un relais sans IA
(`ccremote-relais`) remplace `ccremote-harness` et `ccremote-web` (désactivés, pas supprimés). Chaque machine fait
tourner un poste (`ccremote-poste`) qui gère les **vrais Claude Code en TUI** dans `tmux -L claude` — le même serveur que
relais/Atrium. L'app de bureau (Tauri) est installée sur le portable ; le même frontend est servi en web sur le domaine
public. `master` reste la version publique précédente ; `dev` porte le v2.

Depuis le 05/11 : Claude (claude.ai, Claude Code) pilote le parc via le MCP « quart » (`quart_*`), branché depuis
l'écran **Accès** de l'app ; relais du Pi = `dev` `2a7fadf`.

## 22/11 — Flux d'un appareil : le canal de l'iPhone ne meurt plus (branche `lanterne/v6-livraison`)
- **Bug** : la diffusion fédérée (`diffusion-federee.ts`) envoyait instantanés et confirmations à TOUS les canaux
  ouverts, appareils compris ; l'iPhone fermait son canal sur ce message inconnu → plus de texte en direct à chaque
  changement de fiche (donc à chaque tour). Désormais `liensPairs` = canaux ouverts vers des nœuds seulement. Test
  `appareil-flux.test.ts` (« un appareil ne reçoit jamais les messages de fédération »), rouge sans le correctif.
- `DiffusionAppareil.ouvrir` : un canal déjà abonné qui redemande le flux est ré-acquitté.
- Banc réel (Sémaphore `leDirectArriveAuFilDeLEau`) : 60 deltas / 30 ms avec fiche modifiée en route → 31 paquets
  sur 1,84 s, retard médian 32 ms, max 65 ms.
- **À déployer** sur le moteur du portable (non fait : interdit à l'agent) ; l'iPhone neuf s'en passe déjà.

## 20/11 — Multi-compte, marche 3 côté Quart (agent Haiku, worktree `quart-mc`, branche `lanterne/multi-compte`)

- Pilotage d'une session claude.ai : `POST /v1/code/sessions/{id}/events` (`{events:[evt]}`) pour message (`user`), interruption (`interrupt`), réglages (`set_model`, `set_permission_mode`, `rename_session` : noms du SDK, identiques aux modes Quart), réponses (`control_response`). Les demandes entrantes `can_use_tool` deviennent un dialogue (permission, AskUserQuestion, ExitPlanMode) ; une réponse close par ailleurs l'efface.
- 403 dont le corps parle d'appareil → `distant.probleme = 'appareil_de_confiance'` et erreur explicite ; 401 → jeton expiré ; le succès suivant lève le problème. Le jeton est lu à chaque appel, le journal ne garde que statut et type.
- Trace de relais : commande `tracer_relais`, route `POST /api/sessions/:id/relais`, événement de fil `relais`, fichier `<données>/relais/<session>.jsonl`, réinsertion par date dans l'historique (`poste/relais-sessions/trace.ts`).
- Pièces jointes refusées à distance ; effort, style, compacter, fermer, autonomie restent refusés (« pas encore pris en charge »).
- `gestionnaire.ts` : le branchement distant est réduit à des appels (le fichier reste au-dessus de 500 lignes, déjà 601 à HEAD : à découper, décision à prendre).
- Tests : `bun test commun poste relais mcp integre` 846 verts (816 avant) ; `tsc --noEmit` vert. Aucun POST réel : l'essai d'écriture reste à faire par Chris sur une session jetable.
- Limites : l'historique relit 400 événements bruts, dont la plupart sont des `system` non traduits (session longue : quelques dizaines d'événements visibles seulement) ; une demande de permission non répondue dans l'historique reste affichée ; le dialogue de question non lisible devient une demande de permission.

## 20/11 — Multi-compte, marches 1 et 2 côté Quart (agent Haiku, worktree `quart-mc`, branche `lanterne/multi-compte`)

- Dossier des comptes isolable : `CCREMOTE_DOSSIER_COMPTES` (lu à l'appel, défaut `~/.claude-comptes`) ; le moteur intégré le pose sous `<données>/comptes`.
- Interrupteur par compte « sessions Remote Control » : `EtatCompte.distant`, `poste.json` → `distants`, commande `compte_distant`, route relais `POST /api/machines/:id/comptes/:nom/distant`.
- `poste/distant/` : le spectateur lit `GET /v1/code/sessions` (bridge + active) toutes les 5 s par compte activé, dédoublonne avec les sessions locales (`remoteControl.url`), historique des ~400 derniers événements puis suivi direct (dédoublonné par `event_id`). Rien sur disque.
- Sessions claude.ai : lecture seule. Pilotage (envoyer, interrompre, répondre…) rend « pas encore pris en charge » (marche 3).
- Essai réel en lecture (`essais/spectateur-lecture.ts`, compte par défaut) : 5 sessions RC actives, historique d'une session de 113 événements traduit.
- Limites connues : liste lue en une page (50) sans pagination ; une session qui sort de la liste active passe `fermee` côté relais ; un refus 401/403 marque les sessions du compte, pas le compte (EtatCompte) ; le contrat miroir `hq/src/donnees/contrat.ts` ne connaît pas `claude_ai`.
- Tests : `bun test commun poste relais mcp integre` 816 verts (779 avant) ; `tsc --noEmit` vert.

## 20/11 — Catégories de la barre latérale (agent Haiku, branche `lanterne/categories`)
- `GET|PUT /api/categories` (`{ categories: [{ id, nom, replie, sessions }] }`) : PUT remplace tout, rend la liste normalisée
  (une session = une catégorie, première occurrence gagne) ; doublon d'`id` ou format invalide → 400. Pas de diffusion WebSocket.
- Table `categories` (migration n°11, un seul document JSON, ligne `id = 1`) ; contrat zod dans `commun/categories.ts`.
- Tests : `bun test commun poste relais mcp integre` vert (727), `tsc --noEmit` propre.

## 19/11 — Sessions découvertes sur les postes (agent Haiku, branche `lanterne/historique`)
- Chaque poste liste les transcripts `<config>/projects/*/*.jsonl` (index incrémental mtime+taille, cache dans les données
  du poste, surveillance des dossiers) ; le relais les expose dans `/api/etat` (`decouvertes`, hors fiches connues) ;
  ouvrir une session découverte = fiche fermée moteur SDK + historique lu du transcript (`importer` avant `historique`).
- Exclus : sous-agents (`agent-*`, `isSidechain`), vides, sans message de Chris (sessions automatiques), sans dossier.
  Doublons d'identifiant (copies `ssh-<id>/`) : une seule entrée.
- Mesure tour (lecture seule, 1234 transcripts) : 1182 découvertes, 25 + 22 exclus, 5 doublons ; premier index 6,0 s,
  régime 8-9 ms par relecture+liste. Essai réel : `claude -p` dans lanterne-essai-reel = une seule nouvelle entrée.
- Retiré : le bouton « Importer N sessions CLI » de la carte Créer (il importerait tout d'un coup) ; `importables`
  reste côté relais/poste.

## 19/11 — Vague W2 Lanterne (agent Haiku, worktree `quart-w2`, branche `lanterne/w2`)
- Session : `style_sortie`, `bac_a_sable` (`non`/`oui`/`strict` → `sandbox`), `controle_distant` à l'ouverture ; `POST
  /api/sessions/:id/style`, `GET …/styles`, `POST …/connecteurs/:nom` (`toggleMcpServer`), `POST|GET …/annexes`.
  Annexe = fork complet importé en SDK, `bypassPermissions`, outils d'écriture retirés, consigne « Conversation annexe ».
  Exclue des artefacts et des notifications ; supprimer la parente supprime ses annexes.
- Remote Control à la création : le poste le rejoue au premier repos (une bascule refuse une session en tour).
- Machine : `GET|PUT /api/machines/:id/instructions` (CLAUDE.md, empreinte sha256, 409 `conflit`), `…/competences`,
  `…/competences/contenu` (403 hors liste), `…/connecteurs` (`claude mcp list`, 60 s, cache 30 s), `…/plugins`,
  `POST …/plugins/:plugin`, `POST …/styles` (409 si le fichier existe). Code dans `poste/configuration/`.
- Lecture réelle (read-only) : `claude mcp list` et `claude plugin list --json` analysés sur la tour ; aucun write.
- Tests : `bun test commun poste relais mcp` vert (564), `tsc --noEmit` propre.
- Dette relevée, non traitée : `poste/session/session-sdk.ts` 584 lignes (554 avant W2, limite 500) ; `gestionnaire.ts` 489.

## 19/11 — Machines SSH (agent Haiku) — relais et outils, testé en loopback
- Nouveau : `relais/machines/` (config SSH, test, dossiers, installation du poste par SSH, confirmations), routes
  `/api/machines/config…`, `/api/machines/:id/dossiers`, `/api/confirmations…`, migration 9 (`machines_ssh`), outils
  `lister/tester/ajouter/modifier/supprimer_machine` dans le serveur `lanterne` du poste (`poste/presentation/machines-outils.ts`).
- Variables (environnement du relais, hors dépôt) : `CCREMOTE_RELAIS_POSTES` (WebSocket du relais vu des machines),
  `CCREMOTE_URL_API_POUR_POSTES` (HTTP de l'API vue des machines). Secrets des postes : `~/.config/quart-lanterne/postes/`.
  Poste distant : `~/.config/quart-poste/` (600), unité `quart-poste-distant.service`.
- Tests : `bun test commun poste relais mcp` vert (383). Essai réel fait sur une copie privée (voir STATE Lanterne, 19/11).
- Non déployé sur `/mnt/projects/quart-lanterne` (worktree sale d'autres agents) : fusion et redémarrage à décider.

## 18/11 (agent Haiku) — Suppression, environnements, import CLI (branche `lanterne/moteur`, 0ec7d23, 111d001)

- Suppression : `POST /api/sessions/:id/supprimer` → poste : ferme la session SDK, retire `<config>/projects/<dossier>/<id>.jsonl` et `<id>/` (sous-agents) seulement, retient l'id dans `supprimees.json` (sinon la découverte la ferait réapparaître). Refus si la session tourne dans un terminal. Relais : efface la fiche, le fil et les notifications après accord du poste.
- Environnements : table `environnements` (migration 6), `GET/POST /api/environnements` ; la liste = enregistrés puis dossiers des sessions récentes.
- Import : `GET /api/machines/:id/importables` (transcripts de `projects` inconnus, non en cours, 100 au plus) et `POST /api/machines/:id/importer` (ids → sessions fermées sur le moteur tmux, historique lu, reprenables).
- Essai réel sur la tour : session jetable créée puis supprimée dans `lanterne-essai-reel` (seul son jsonl parti) ; environnement enregistré ; une session CLI importée.
- Non fait : Remote Control (le SDK n'expose pas de contrôle par session) ; sessions enfants (liens dans `subagents/*.meta.json`, pas de session côté SDK).

## 18/11 (nuit) — Contexte, connecteurs et tâches de fond relayés (branche `lanterne/moteur`)

- Lectures du panneau, sans effet, par le canal de commandes du poste (comme `fichiers_lister`) : `GET
  /api/sessions/:id/contexte` (`null` hors requête ouverte), `/connecteurs` (`mcpServerStatus`, nom + statut),
  `/taches` (liste sans prompt) et `/taches/:tache` (détail, 404 si absente). Schémas dans `commun/panneau.ts`.
- Contexte : `getContextUsage({detail:'summary'})`. Mesure réelle (SDK 0.3.325, 15 connecteurs dont des
  outils MCP déférés) : `summary` 33-70 ms, `full` 413 ms (un comptage d'API par catégorie). Totaux identiques
  (29 579 jetons) ; le détail par outil MCP est une estimation locale, environ 16 % sous le compte exact de `full`.
  Choix : `summary` pour le panneau. `full` n'est pas branché.
- Tâches de fond (`poste/session/taches-sdk.ts`) : `task_started` (prompt, type, sous-agent, arrière-plan, parent),
  `task_progress` (activité, outils, jetons), `task_updated` (statut, arrière-plan), `task_notification` (fin),
  `background_tasks_changed` (marque l'arrière-plan). Le modèle n'est pas dans `task_started` : il vient de l'appel
  `Agent`/`Task` (`input.model`), relié par `tool_use_id`. Les tâches ambiantes sont écartées ; 50 terminées gardées.
  Pas d'événement sur `/api/flux` : le panneau relit les routes.
- Non fait : rien n'est déployé ; le moteur Lanterne (`crates/lanterne-moteur-quart`) suit sur sa branche `contexteSession`.

## 18/11 — Moteur SDK pour Lanterne : flux, permissions, réglages (branche `lanterne/moteur`)

- Deltas de texte et de réflexion relayés en direct (`flux`, genre `reflexion`, `agent` pour un sous-agent) ; jamais
  persistés, le bloc final reste dans le fil. Le client web ignore ces deltas (magasin.ts).
- Permissions hors mode bypass : `canUseTool` → dialogue Autoriser / Toujours / Refuser, file d'attente
  (`avis-sdk.ts`, `file-avis-sdk.ts`), refus de la file à l'interruption. Bypass (défaut) : aucune demande.
  `allowDangerouslySkipPermissions` posé pour que le bypass soit accessible en cours de session.
- Réglages en cours de session : `mode`, `modele`, `effort`, `renommer` (routes relais `/mode` etc.) ; sans requête
  vivante, le réglage attend le prochain démarrage. Limite : le titre n'est pas écrit dans le JSONL du SDK.
- À vérifier en réel (non fait, abonnement) : que `AskUserQuestion` et `ExitPlanMode` passent toujours par `canUseTool`
  en mode bypass.

## 16/11 (nuit) — Agent HQ v1 : l'app jeu qui remplace Claude Desktop

**Ce qui marche (vérifié de bout en bout sur un relais + un poste d'essai locaux, isolés de la prod)** :
- `hq/` servi par le relais sous `/hq/` (build de production `VITE_SOURCE=relais`, adresse = origine de la page) ;
  écran de connexion (mot de passe du relais, jeton dans le navigateur).
- Monde jeu (Phaser) en projection unique façon Stardew : bâtiment généré depuis les sessions (un bureau par session,
  couloir, bibliothèque, réunion, hall café, salle serveurs, façade, rue), meubles dessinés par `art/oblique.py`,
  Clawd en 3/4 (assis de dos au travail, tourné vers la pièce quand il t'attend, dehors au fumoir quand il est inactif),
  marche de Chris tirée de vidéos MiniMax H3 (4 directions), nuit selon l'heure réelle. Murs façon Stardew (faces
  visibles) : le style « murs baissés » des Sims a été écarté par Chris pendant la nuit.
- Écran d'agent : fil complet (bulles, Markdown, outils regroupés dépliables, sous-agents, réflexions, repères, flux en
  direct), question en attente avec ses choix, envoi, interrompre / compacter / terminal / éteindre / rallumer /
  archiver, colonne des fichiers touchés + frise. Testé sur une VRAIE session SDK ouverte depuis l'app.
- Embauche d'un agent (machine, projet, mission, modèle, autonomie), terminal réel (xterm, zsh de Chris), fichiers réels
  (arborescence + CodeMirror, enregistrement vérifié sur disque), salle de réunion (relais : diffusion, historique,
  limite par réunion ; réponse réelle d'un agent reçue), HUD (rouge = t'attendent, ambre = ont fini, notifications
  navigateur), vue téléphone (panneaux plein écran, touches de terminal).
- Moteur SDK du poste à parité avec tmux (rythme, autonomie, nuit, comptes) ; messages de Chris dans le fil SDK.

**Pas fait / limites** :
- PAS déployé (mode nuit : prod interdite). `deploiement/deployer.sh tout` (essai : `--essai`) sauvegarde la base,
  construit `bureau` et `hq`, pousse sur le Pi. `~/.config/ccremote/deploiement.env` absent de la tour : le lancer
  depuis la machine qui l'a.
- Une session SDK vit dans le processus du poste : au redémarrage du poste, seules celles prises en plein tour sont
  relancées (corrigé le 22/11, voir la section du 22/11) ; les autres repartent au prochain message. Celles éteintes par
  Chris restent éteintes.
- Authentik pas encore devant `/hq/` (mot de passe du relais seulement).
- Banc d’essai local et isolé : `hq/scripts/essai-local.sh` (relais 8790 + poste « essai », tmux à part ; `arreter`).

## 15/11 — Moteur SDK du poste, cycle de vie, Agent HQ (`hq/`)

**Livré (rien commité, à relire puis committer)** :
- **Poste, moteur `sdk`** (défaut des sessions ouvertes depuis l'app) : à parité avec tmux pour le fil, les commandes,
  les dialogues (AskUserQuestion, ExitPlanMode) et la fin de tour (relance, compaction, mode nuit, même politique pure).
  Fichiers `poste/session/*-sdk.ts`, `bilan-tour.ts`, `rythme.ts`. Voir ARCHITECTURE « Moteurs du poste ».
- **Cycle de vie** : inactivité à 30 min (`CCREMOTE_INACTIVITE_MIN`, recalcul chaque minute, changements seulement) ;
  archivage `POST /api/sessions/:id/archiver|desarchiver`, archiver ferme d'abord la session vivante ; archivées masquées
  sauf `?archivees=1`. Le client HQ appelle la même route, testée des deux côtés.
- **Relais** : sert Agent HQ sous `/hq/` (`CCREMOTE_HQ`), derrière la même authentification que l'API.
- **Agent HQ** (`hq/`) : monde Phaser (carte, un Clawd par session, Chris jouable), client de données (démo ou relais),
  actions de session ; pipeline d'assets local dans `hq/art/`. Apparence en cours de design.

**Vérifié** : `bun test` à la racine vert (249 tests, dont `hq/src/donnees`) ; `bun run typecheck` vert ; `hq` : 57 tests
`src/donnees` verts et typecheck vert. **Non vérifié** : sessions SDK sur un vrai poste (ouverture, question, relance,
compaction) et l'écran Agent HQ connecté à un relais réel.

**Reste** : commit après relecture ; CI sans `hq/` (`.github/workflows/ci.yml` ne lance ni son typecheck ni ses tests) ;
décision de fin de `bureau/` au profit de `hq/`.

## 05/11 — Écran « Accès » : brancher claude.ai et Claude Code, gérer les accès

- Nouvel écran **Accès** (barre latérale, palette) : appareils connectés (app, web, iPhone), connecteurs Claude.ai et
  Claude Code ; créer un accès (nom, durée 30 j / 90 j / 1 an) → marche à suivre avec le jeton montré une seule fois
  (claude.ai : Paramètres → Connecteurs → connecteur personnalisé, URL `/mcp/<jeton>` ; Claude Code : `claude mcp add
  --transport http … /mcp --header "Authorization: Bearer …"`) ; révoquer (confirmation, « cet appareil » signalé).
- Relais : jetons typés (`genre`, `vu_le`, migration 3), `/api/acces` réservé aux jetons `appareil`, MCP servi en HTTP
  sans état (`relais/connecteurs/mcp-http.ts`, mêmes outils que `mcp/`), `/.well-known/*` → 404 (pas d'OAuth).
- Risque assumé : le jeton claude.ai voyage dans l'URL (journaux du tunnel) — révocable depuis l'écran.
- `centralisation-sessions` (4 commits du 12/10, lanceur `ccs`, veilleur) n'est PAS dans `dev` : à fusionner à part.
- **Décisions** : claude.ai n'accepte qu'un MCP distant → servi par le relais lui-même (aucun nouveau service) ; jeton
  dans l'URL plutôt qu'OAuth (simple, révocable) ; un connecteur pilote le parc mais n'administre pas les accès ;
  travail repris depuis `origin/dev` (MCP cherry-picked) pour ne pas déployer `centralisation-sessions` sans validation.
- **Déployé et vérifié en prod le 05/11** (CI verte) : relais à jour par `git reset` sur `origin/dev` + `bureau/dist`
  copié, base sauvegardée avant migration (`/mnt/hdd/ccremote/relais-avant-acces-20261105.db`). Vérifié : 401/403/404
  attendus, `initialize` + `quart_parc` par `/mcp` (4 machines). Non vérifié : l'écran connecté en prod (mot de passe
  de Chris) et l'ajout réel du connecteur sur claude.ai.
- **Reprendre par** : (1) Chris ouvre Accès, crée un connecteur claude.ai et le teste ; (2) reconstruire/réinstaller
  l'app Tauri (l'écran n'est que dans le web) ; (3) décider de la fusion de `centralisation-sessions` dans `dev` ;
  (4) sur le portable, `git pull` de `~/ccremote` (en retard sur `dev`).

## 05/11 — MCP Quart : ouvrir une session depuis Claude, sur n'importe quelle machine

- `mcp/` : serveur MCP stdio « quart », client de l'API publique du relais (jeton porteur). Outils : `quart_parc`,
  `quart_projets`, `quart_ouvrir`, `quart_fil` (attente longue jusqu'à 30 s), `quart_envoyer`, `quart_repondre`,
  `quart_piloter`, `quart_reveiller`. Aucune modif du relais ni des postes : rien à redéployer.
- Jetons sans mot de passe : `mcp/emettre-jeton.ts` lancé SUR le Pi contre la base du relais (appareils `mcp-tour`,
  `mcp-portable`, 1 an, révocables par `DELETE FROM jetons WHERE appareil = …`). Côté machine : `~/.config/quart/mcp.env` (600).
- Installé (copie autonome `~/.local/share/quart-mcp`, enregistré niveau utilisateur) sur la **tour** et le **portable**.
- Vérifié en réel depuis la tour : parc des 4 machines, projets, session ouverte sur la tour (réponse lue, message envoyé,
  fermeture) ; session ouverte sur le portable → le poste rend « Login expired » : **compte Claude du portable à
  reconnecter** (écran Comptes de Quart), le MCP n'y est pour rien.

## 06/10 — Mode nuit (config Claude Code ⇄ Quart)

Chris dort pendant que les sessions travaillent : « je vais dormir / je te laisse gérer en autonomie » → la session travaille
seule jusqu'à tout finir et tout tester, sans question ni to-do rendue ; au réveil, il ne fait que tester. Deux moitiés :

- **Config Claude Code** (`~/.claude/night/`, hooks UserPromptSubmit / Stop / SessionStart + commande `night`, voir son README) :
  détecte la phrase, injecte le protocole, plan à cases + `VERIFY`, relance tant qu'il reste du travail, rappelle les consignes
  permanentes à chaque message et les rappels au démarrage.
- **Quart** (cette base) : le **filet** — Claude Code coupe un hook Stop après 9 blocages sans action (mesuré : 14 passent si chaque
  tour agit), donc `poste/session/suivi-nuit.ts` réveille par tmux une session à l'arrêt dont Chris ne répond plus depuis 6 min
  (4 réveils sans effet max, puis alerte) ; la **vitrine** — l'état (`nuit` : heures, cases ouvertes, relances, réveils) est lu dans
  `~/.claude/night/sessions/<id>.json`, publié dans la fiche de session, affiché dans l'app (lune + bascule « nuit ») ; la fin réussie
  (`night done`, VERIFY vert) devient une notification « objectif atteint », un abandon une alerte « nuit interrompue ».
- **Bascule depuis l'app/l'iPhone** : `POST /api/sessions/:id/nuit {active, objectif?}` → commande `nuit` au poste → `night on|off`
  puis message collé dans le tmux. Valable pour les sessions adoptées (terminal) comme pilotées.
- **Sessions du terminal de la tour** : `claude-tmux.zsh` (Quart) remplace le lanceur de Relais dans `~/.zshrc` ; toute session ouverte
  au clavier vit dans `tmux -L claude` → adoptée par le poste, visible et pilotable dans Quart (vérifié : la session de travail du
  06/10 y figure avec son transcript).
- **CI** ajoutée (`.github/workflows/ci.yml` : types racine + app, tests racine + app) — le dépôt n'en avait pas. 90 tests.
- **Fil de session** : les fichiers présentés par un appel d'outil (image lue, `SendUserFile`, envoi avec `files`) s'affichent dans le fil — image en aperçu, autre fichier en carte à télécharger — lus sur la machine de la session par l'API fichiers du relais. Plus « aveugle » face à ce que Claude présente.
- Déployé le 06/10 : postes tour et portable, relais (Pi). Vérifié de bout en bout : fichier d'état → poste → relais de production →
  `/api/etat` (champ `nuit`).

## 28/09 soir — Accès à distance (fichiers, terminaux) et terminal kitty réparé

- **iPhone** (dépôt semaphore, onglet Vigie « Accès ») : même accès natif — fichiers, QuickLook, édition, dépôt de
  photos, terminal SwiftTerm, sessions. Le terminal s'ouvre par jeton en `Authorization` : `upgrade()` de Bun plantait
  sur `headers: {}` (corrigé, e6af2f2).

- **Terminal kitty qui se refermait aussitôt** (Chris, sur le portable) : deux causes mesurées. Le Pi et le VPS n'ont pas
  la terminfo `xterm-kitty` → tmux refusait (« missing or unsuitable terminal ») ; et le poste du Pi tourne sous `pi`
  alors que l'alias SSH arrive en `trinity` → « no sessions ». Correctifs : repli `TERM=xterm-256color` côté distant,
  chaque poste annonce son compte Unix (`etat.utilisateur`) et kitty vise `-l <compte>`.
- **Catégorie « Accès à distance »** (barre latérale, palette Ctrl+K) : par appareil, onglets **Fichiers** (fil d'Ariane,
  cachés, créer, déposer par glisser-déposer, renommer, télécharger, supprimer ; aperçu image/vidéo/son/PDF, Markdown
  rendu, éditeur CodeMirror avec Ctrl+S), **Terminal** (xterm.js, onglets multiples, reconnecter) et **Sessions**
  (lancer ici, voir le fil, s'attacher dans l'app ou dans kitty). Tout passe par le relais : marche en 4G et en web.
- **Protocole** : `commun/appareil.ts` — fichiers par morceaux de 4 Mo (lecture en flux, dépôt en ajouts), terminaux =
  vrais PTY `Bun.Terminal` sur le poste (`poste/terminal/`), frappe en binaire sur `/api/terminal` (jeton en
  sous-protocole), sans réponse par touche. Relais : `relais/appareils/`.
- **Vérifié en réel depuis le VPS (hors maison)** : fichier de 9 Mo déposé puis relu à l'identique sur les 4 machines
  (1,5–3,8 s), renommer/supprimer/type MIME ; shell distant sur les 4 (< 1 s) ; attache à une session tmux de la tour :
  la frappe y arrive, la session survit à la fermeture, plus aucun client attaché. Captures de l'app web (Playwright,
  tour) : fichiers, Markdown, image, script, terminal, sessions — 0 erreur console.
- **Qualité** : 77 tests, typecheck strict, linter 0 violation.

## 28/09 après-midi — Quart, dialogues, comptes

- **Renommé Quart** côté produit (app de bureau `quart`, entrée de lanceur, titre ; onglet « Quart » de Sémaphore).
  Dépôt, services et identifiants techniques restent `ccremote` (la connexion de l'app survit à la mise à jour).
- **Thème** : bascule système / clair / sombre (pied de la barre latérale, palette Ctrl+K).
- **Dialogues du TUI répondables** depuis l'app et l'iPhone (AskUserQuestion : choix unique, cases, réponse libre,
  relecture ; permissions ; plans). Relevés à l'écran du pane — le transcript n'écrit la question qu'une fois répondue.
  Validé de bout en bout sur une vraie session (portable, Haiku).
- **Comptes Claude Code** : chaque poste relève identité et usage (5 h, semaine, par modèle) toutes les 5 min ; écran
  « Comptes » (regroupés par email) ; ajout d'un compte sur une machine au choix par OAuth (URL ouverte dans le
  navigateur, code collé), retrait ; choix du compte à l'ouverture d'une session. Relevé vérifié sur les 4 machines ;
  ajout testé jusqu'au code (le vrai code demande la connexion de Chris).
- **Lanceur zsh** (`poste/session/claude-tmux.zsh`, branché sur le portable) : tout `claude` tapé démarre dans tmux.
- **Correctifs trouvés en route** : Cloudflare remplaçait les réponses 502 du relais par sa page (message perdu) →
  refus de poste en 409 ; Bun coupait toute requête HTTP à 10 s (long-poll compris) → `idleTimeout` 75 s ; une fiche de
  session d'un ancien contrat faisait tomber `/api/etat` → lecture tolérante.

## Pourquoi cette refonte (mesuré le 28/09)

- Analyse des 74 sessions du 21 au 28/09 : les sous-agents ne font que 11 % du coût ; ce qui coûte, c'est **le contexte
  relu à chaque tour** (≈ 540 k tokens par message sur les marathons Tessera/portfolio, 7 compactions en 42 h).
- Le harness v1 multipliait les démarrages à froid : orchestrateur Opus permanent → équipe par mandat → sous-agents sans
  plafond (393 mandats en un mois). Les « teams persistantes » censées réutiliser le contexte étaient inertes en prod.
- D'où le v2 : une session persistante par travail, compaction pilotée aux fins d'étape (120 k) et au seuil dur (350 k),
  sous-agents plafonnés (Sonnet, 3 par étape, pas de fork), plus aucune IA au relais.

## Ce qui a été fait — nuit du 27 au 28/09

- **Dépôt** : portable aligné sur l'historique assaini de GitHub ; 12 commits du 03/09 récupérés de la tour ; branche
  `dev` ; MAC réelle retirée d'un test oublié par l'assainissement ; ancien harness retiré de `dev` (reste sur `master`).
- **Maillage SSH** (`~/parc-ssh/installer-maillage.sh`, hors dépôt) : alias `pi`/`tour`/`portable`/`vps` partout,
  tunnel inverse du portable par le Pi (joignable en 4G), Pi par Cloudflare hors LAN ; **le VPS n'a aucun accès à la
  maison** (décision de Chris).
- **Poste** : sessions tmux (lancement, adoption des sessions existantes, reprise `--resume`, fermeture), fil lu dans
  les transcripts (sous-agents compris), crochets (Stop, SessionStart, UserPromptSubmit, PreToolUse) et MCP de rythme,
  compaction pilotée, relance autonome, patience pendant un sous-agent en arrière-plan, erreurs d'API visibles.
- **Relais** : registre SQLite (sur `/mnt/hdd`, pas la carte SD), jetons révocables (empreinte sha256), argon2, limite
  de tentatives, un secret par machine, isolation du VPS, long-poll réveillé seulement sur un vrai changement, CORS pour
  l'app, jeton du flux en sous-protocole WebSocket (jamais dans l'URL).
- **App de bureau** : charte Echo Agency clair/night ; sessions, fil détaillé (outils dépliables, sous-agents), parc
  (mesures, réveil, extinction), notifications système, « Ouvrir le terminal » (kitty attaché, local ou SSH dédié).
- **Sessions hors tmux** (retour de Chris, 28/09 midi) : le poste lit `<config>/sessions/<pid>.json`, déclaré par
  Claude lui-même — identifiant de session exact pour les sessions tmux, et sessions lancées dans un terminal ordinaire
  suivies en **lecture seule**. Machine éteinte : « Réveiller » au lieu d'un 502 ; le relais journalise chaque refus.
- **Qualité** : 45 tests (poste, relais, app), typecheck strict, linter des standards à 0 violation.

## Vérifié en réel (production, domaine public)

- 4 postes connectés ; projets découverts (tour 98, portable 20, pi 9, vps 3) ; 2 sessions de Chris adoptées sur la tour.
- Session autonome sur la tour : fichier créé, vérifié, commité, `objectif_atteint` → statut « terminée ».
- **Session sur le Pi travaillant sur un projet de la tour par SSH** : objectif atteint en 30 s.
- VPS → projet de la maison : refusé (403). Fermeture par l'API : tmux arrêté.
- Sur le portable (banc local) : étape → compaction pilotée → relance → objectif atteint, sans intervention.
- Attache kitty au TUI d'une session lancée par l'API : conforme.

## ccremote a travaillé sur lui-même (dogfooding, 28/09 à 3 h 30)

Une session pilotée, **modèle par défaut de Chris**, autonome, lancée par l'API publique sur la tour :
« rétention du fil du relais » (purge des événements des sessions fermées depuis 30 jours). Résultat : livrée en
~2 min, **règle pure + test + branchement + journalisation + TODO**, 0 violation au linter, 43 tests verts, commit sur
une branche d'essai ; relue puis reprise dans `dev` (`relais/registre/retention.ts`). **Contexte en fin de session :
67 k** (dont ~60 k de base : CLAUDE.md, outils, MCP de Chris), aucune compaction nécessaire.

Ce que cet essai a trouvé et qui est corrigé :
- `--mcp-config` est variadique : sans `--model` derrière lui, il avalait le premier message → toute session au modèle
  par défaut quittait aussitôt. Arguments réordonnés, test qui fige l'ordre.
- Le modèle affiché restait « défaut » : il se lit désormais dans le transcript.

## Décisions

| Décision | Raison | Date |
|---|---|---|
| Sessions = CLI Claude Code en TUI dans tmux, pas le SDK | Chris travaille dans le TUI ; une session SDK ne s'attache pas | 28/09 |
| Relais sans IA | L'orchestrateur LLM était le premier coût et ne produisait rien | 28/09 |
| Transcript = source du fil | Voit aussi ce qui est tapé dans le terminal ; sous-agents dans leurs propres fichiers | 28/09 |
| Compaction : 120 k en fin d'étape, 350 k au seuil dur | Coût par tour ∝ contexte ; compacter pour rien coûte aussi | 28/09 |
| Sous-agents : Sonnet, 3 par étape, pas de fork | Utiles pour explorer, ruineux en série (mesuré) | 28/09 |
| Poste du Pi sur `~/.claude-orchestrateur` | Le `~/.claude` de pi n'a plus d'identifiants valides | 28/09 |
| `KillMode=process` sur les postes | Redémarrer un poste ne doit jamais tuer les Claude de tmux | 28/09 |

## Contexte non évident

- Une config Claude neuve bloque sur deux boîtes (confiance du dossier, avertissement bypass) dont l'option par défaut
  est **quitter** : le poste approuve le dossier dans `.claude.json` et passe `skipDangerousModePermissionPrompt`.
- zsh expanse `=nom` : la cible tmux `=nom` doit être entre apostrophes dans toute commande distante (ssh).
- Le jeton d'essai de Claude (`~/.config/ccremote/jeton-essai`, appareil « essais Claude (portable) ») se révoque dans
  la table `jetons` du relais.
- Anciennes installations laissées en place, services désactivés : `/mnt/projects/ccremote-harness`,
  `/mnt/projects/ccremote-web` (Pi), `ccremote-pc` (tour, portable, vps).

## Prochaines étapes

1. Chris : poser le nouvel IPA (`~/semaphore/deploy.sh`) — Vigie sait répondre aux dialogues.
2. Chris : ajouter un vrai compte depuis l'écran Comptes de Quart, puis ouvrir une session avec ce compte (vérifier
   qu'aucun écran d'accueil du CLI ne bloque sur un dossier de config neuf — `marquerAccueilFait` est censé l'éviter).
3. Brancher `claude-tmux.zsh` sur la tour à la place du lanceur de `relais/sessions/`.
4. Ensuite : [`TODO.md`](TODO.md).

## Points en suspens

- **Répondre aux sessions lancées hors tmux** (comme la session de refonte du 28/09) : impossible sans le pilotage à
  distance de kitty (`allow_remote_control` + `listen_on`), non activé — décision de Chris (toute app locale pourrait
  alors taper dans ses terminaux). Le lanceur zsh rend le cas rare.
- `compte-b` du VPS est déconnecté : à reconnecter ou retirer depuis l'écran Comptes.
- La tour est restée allumée en fin de session (28/09, 15 h 50) : une session du portable (« semaphore ») y pilotait le
  récepteur Iris. Pas allumée par moi.
- Titre des sessions : la liste montre encore « CCremote Refactor in Portable » (titre posé par Claude Code, pas par Quart).

## Outils de présentation (18/11/2026, branche `lanterne/moteur`, commit 3ae98f1)

- Poste : serveur MCP en processus `lanterne` ajouté à chaque session SDK. Outils : `envoyer_fichier` (copie d'un
  fichier du poste, mode afficher ou joindre, légende), `publier_artefact` (page HTML, versions par `id`),
  `afficher_widget` (SVG ou HTML court). Chaque appel émet un événement `fichier` / `artefact` / `widget` ; les appels
  `mcp__lanterne__*` n'ont pas de carte `outil` dans le fil (traduction-sdk.ts masque l'appel et son résultat).
- Un refus (type, taille, chemin hors des dossiers autorisés) émet une `relance` « présentation refusée » et renvoie
  l'erreur à l'agent.
- Chemins confinés (`poste/presentation/chemins.ts`) : dossier de la session, racines de projet, dossier temporaire ;
  realpath, donc un lien qui sort est refusé.
- Stockage : `donnees/fichiers/<session>/<id>` + `<id>.json`. Identifiants stricts (16 hex, `-vN` pour un artefact).
  Supprimé avec la session.
- Images : les blocs image des résultats d'outils (Read d'une image compris) deviennent des événements `image`
  (origine outil). Pièces jointes de Chris (`envoyer` avec `pieces`, 3 au plus, 3 Mo chacune) : images et PDF partent
  au modèle en blocs, les autres fichiers sont déposés et leur chemin est donné dans le texte.
- Relais : `GET /api/sessions/:id/fichiers/:fichier` (lecture sur le poste par la commande `fichier_session`). HTML et
  SVG sous CSP `sandbox`, `nosniff`, téléchargement seulement avec `?telecharger=1`.
- Essai réel (Haiku 5.5, effort faible, un tour, dossier jetable) : image relue → événement image ; fichier et
  artefact présentés ; aucun appel lanterne dans le fil ; trois routes 200 avec les bons en-têtes.
- Limites connues : les sous-agents émettent leurs fichiers dans le fil principal (l'appel n'est pas attribuable) ;
  dans Claude Code les outils MCP sont différés (`ToolSearch`), l'agent doit les charger avant de s'en servir ; le
  bureau de Quart ne rend pas les nouveaux genres (Lanterne les rend).

## Remote Control par bascule (19/11/2026, branche lanterne/remote-control)
- Remote Control n'existe que dans le TUI : `POST /api/sessions/:id/remote-control {actif}` bascule la session entre le
  SDK et `claude --resume` dans tmux (`poste/session/bascule-controle.ts`, `remote-control.ts`). Fiche : `remoteControl {actif, url}`.
- Essai réel (session jetable, haiku, relais et poste de test sur socket tmux `rc-test`) : ON → URL
  `https://claude.ai/code/session_…` ; message pendant ON → réponse dans le .jsonl et dans le fil du relais ; OFF →
  `disconnected`, moteur sdk, message SDK → réponse dans le fil.
- Limite levée (19/11, branche lanterne/rc-statut) : après ON, `statut: fermee` venait de `rattacherTerminal` : le processus SDK
  fermé (même identifiant, hors tmux) passait la session tmux en terminal, puis sa mort la fermait. Un pane tmux l'emporte désormais.
- 19/11 correctifs V1 (suite 2) : `fichier_session` n'est plus une commande de l'appareil (poste/fichiers/appareil.ts, cause de « Aperçu indisponible » et de « undefined is not an object (r.ok) ») ; serveur `lanterne` en `alwaysLoad` avec `searchHint` ; consignes : bloc « Présenter des fichiers » (moteur SDK) et encouragement à une liste de tâches ; événement `taches` (TodoWrite du fil principal). Haiku 5.5 n'expose ni TodoWrite ni TaskCreate en SDK : la liste est prête, pas encore alimentée. Pour la suite : tester un vrai TodoWrite dès qu'un réglage le rend disponible (`CLAUDE_CODE_ENABLE_TODO_TOOLS` n'a pas suffi).

## 20/11 ~06 h — Multi-compte vérifié au banc (orchestrateur Opus)
- Sessions Remote Control d'un compte (poste/distant/) lues et pilotées depuis une seconde instance isolée, sur une session
  jetable : envoi, interruption, permission, modèle, mode. Forme des POST : `{events:[{payload: evt}]}` (sans enveloppe :
  400 « event_type is required »). Un message posté avec un jeton du CLI arrive comme message de PAIR : retenu par une
  session en bypassPermissions, livré en mode default/acceptEdits.
- Correctifs de l'essai : poste.json du moteur intégré conserve `comptes`/`distants` ; republication des sessions
  distantes toutes les 30 s ; messages tapés rendus dans le fil distant ; mode relu dans les `system`.

## 20/11 — Entretien pour Lanterne (audit TOP 7, branche `lanterne/audit-top7`, agent Haiku 5.5)
- Livré côté Quart : `GET /api/entretien/etat` (versions relais/poste/Claude Code, empreinte attendue, ressources, réveil,
  contrôles `controlesMachine`), `GET /api/entretien/chantiers` (suivis d'agents, lecture seule, normalisés), `GET
  /api/entretien/processus` + `POST …/processus/arreter` + `POST …/tmux/arreter` (inventaire par parenté `/proc`, jamais par
  motif ; registre `processus.json` 0600 ; SIGTERM puis SIGKILL seulement si `force` après un SIGTERM du même processus),
  `GET …/liaisons/:id/occupant` + `POST …/liberer` (sshd de l'utilisateur de la fiche seulement, puis `Tunnels.relancer`),
  `POST /api/machines/:id/reveiller` (MAC relevée et stockée dans `reveil.json` du relais, envoi délégué à un poste du même
  réseau, banc `CCREMOTE_REVEIL_FACTICE`).
- Build : `commun/version.ts` (VERSION '2.0.0', COMMIT). Ligne de construction attendue côté Lanterne :
  `bun build --compile --target=bun-linux-x64-baseline --define 'process.env.QUART_COMMIT="<sha>"' integre/bin.ts --outfile dist/integre/lanterne-moteur`
  Sans cette option, COMMIT vient du fichier `COMMIT` de l'archive du poste, sinon `null`.
- Environnement : `CCREMOTE_MACHINE_LOCALE` posé par le moteur (machine locale). `LANTERNE_DOSSIER_CHANTIERS` et
  `CCREMOTE_REVEIL_FACTICE` ne sont pas reposés : le moteur est un seul processus, il hérite de l'environnement de l'appli.
- Limite connue : le gestionnaire ne relie pas encore un pid SDK à son id de session (`sessionDePid` renvoie `null`) ; les
  sessions tmux sont listées sans id de session. Le réveil d'une machine sans MAC relevée reste impossible tant qu'elle n'a
  jamais été en ligne avec ce code.
- Essai réel (tour, lecture) : `essais/entretien-inventaire.ts` sur le PID d'un `sleep 300` lancé pour l'essai : le
  processus est bien trouvé comme descendant de la racine. Chantiers réels : 101 fichiers (en cours 6, échec 1, inconnu
  19, terminé 75).
- Tests : 920 → 1009 (`bun test commun poste relais mcp integre`), `tsc --noEmit` vert.

## 22/11 — Sommeil des sessions SDK (branche `agent/sessions-sommeil`, non poussée)

**Cause** : au démarrage du poste, toute session SDK avec `aReprendre` était relancée (`reprisePrevue`), y compris celles
au repos ; `aReprendre` reste vrai tant que Chris n'a pas fermé la session. Sur le portable : 4 `claude --resume` à
~250 Mo chacun pour des sessions inactives.

**Correction** :
- Démarrage : seule une session prise en plein tour (`travail`, `compaction`, `question`) est relancée, avec le
  message de redémarrage. Les autres restent sans processus (statut et conversation gardés).
- Sommeil (`sommeil.ts`, balayage toutes les 30 s) : une session SDK au repos depuis `sommeilMinutes` (défaut 5, clé de
  `poste.json`) rend son processus. Pas de sommeil si un message est en vol, une question est posée, une tâche de fond
  tourne, ou si le mode nuit est actif (le réveil de nuit a besoin du processus).
- Réveil : un message, une pièce jointe ou une compaction à une session endormie la relance d'abord (même chemin que
  la reprise d'une session fermée). Une session fermée par Chris garde son refus de pièce jointe et de message de pair.
- Usage du compte : sans session vivante, la dernière lecture datée reste rendue (au lieu de rien).
- Un compte ne se retire pas sous une session endormie qui reprendra sur lui.

**Mesure (banc, moteur factice `sdkFactice`, 3 sessions au repos + 1 en plein tour, journal du poste)** :
- Au démarrage : 4 reprises avant (HEAD), 1 après (celle en plein tour).
- Après 40 s : 4 processus encore vivants avant ; après, 0 (la session en plein tour finit son tour puis s'endort).
- RAM non mesurée avec de vrais `claude` : le banc ne peut pas en lancer sans écrire dans `~/.claude` (interdit) ; le
  gain attendu est ~250 Mo par session au repos, chiffre de la mesure du portable.

**Limites connues** :
- Une session endormie n'a plus de panneau vivant (contexte détaillé, connecteurs à jour, usage) : le fil, le statut, le
  modèle et le contexte résumé viennent de la fiche et du transcript.
- À chaque mise en sommeil, la queue du transcript est relue une fois (le relais fusionne sans doublon).
- Fenêtre de course : une conversation prise par Claude Desktop pendant le sommeil n'est reconnue qu'au balayage suivant ;
  une reprise dans cet intervalle ferait deux processus sur le même transcript (même risque qu'une session fermée).
- `poste/session/gestionnaire.ts` dépasse 500 lignes (521, déjà 516 avant ce chantier) : découpage à faire.

## Migration Claude Desktop / terminal → Lanterne (22/11/2026, branche agent/migrer-desktop)
- Route `POST /api/sessions/:id/migrer` (relais), commande poste `migrer` → `poste/session/migration.ts` : fork SDK
  (`forkSession`, historique complet), nouvelle session SDK pilotée, titre/modèle/effort/mode repris ; Remote Control non repris.
- Choix (a) seulement : la source n'est jamais écrite. (b) reprise du même id refusée : la règle « un seul écrivain » ne
  tient pas si Desktop rouvre la conversation pendant un tour Lanterne (la cession ne couvre que le tour en cours).
- Champs de vue `migrable` / `migreeVers` (relais, colonne `migree_vers`) ; événement de fil `migration` (sortie/entree),
  tracé sur le poste hors transcript. Épingle copiée sur la nouvelle.
- Garde : chef du réseau si une charte existe (pas de rôle « appareil » dans le code). Invités refusés par le poste.
- Non vérifié en réel (banc non lancé, consigne de Chris) : que `--resume --fork-session` garde l'historique.

## Invités : conversations sur le PC de l'invité, relais d'API du chef (23/11/2026, branche agent/windows-vm)
- Bug corrigé (4edb8c2) : une machine fraîche reliée/invitée fondait son propre réseau (reprise) en acceptant
  l'appairage, puis refusait la charte du chef (`autre-reseau`). Seul le demandeur de l'appairage peut fonder par
  reprise ; une reprise v1 fondée seule cède devant la charte d'un réseau qui la compte, sans révocation. Prouvé en VM.
- Nouveau modèle (décision de Chris, 23/11) : Claude Code tourne chez l'invité avec `ANTHROPIC_BASE_URL` vers
  `/api/relais-claude` de son moteur (jeton local), relayé par le lien chiffré au nœud du chef qui vérifie la charte,
  applique modèle/effort/parts/simultanées, met l'OAuth de l'abonnement et transmet en flux ; télémétrie sans contenu.
  Vérifié en réel avant de coder : Claude Code 2.1.323 accepte la redirection (200 via relais, `oauth-2025-04-20`).
- Invitation tout-en-un : `POST /api/reseau/invites/invitation` (code + accès VPN) ; aiguilleur
  `POST /api/membres/vpn-invites` + geste root `deploiement/vpn-invites/` (NON installé sur le serveur réel : à faire
  par Chris, voir README). Réglages d'invité partiels acceptés.
- Limites : annulation à la déconnexion codée non testée ; `surSaMachine` et l'ancien chemin chez le chef restent dans le
  code sans servir ; sessions d'invité gardent le cadre confiné (pas de Bash) même sur son PC.
