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
- Une session SDK vit dans le processus du poste : au redémarrage du poste, celles qui tournaient sont reprises toutes
  seules (vérifié en réel) ; celles éteintes par Chris restent éteintes.
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
