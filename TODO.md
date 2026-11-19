# TODO — Quart (dépôt ccremote)
*Dernière mise à jour : 2026-11-18*

## En cours

- [x] Outils de présentation (18/11) : serveur `lanterne` (envoyer_fichier, publier_artefact, afficher_widget), images du fil, pièces jointes, route des fichiers ; commit 3ae98f1 sur `lanterne/moteur`, essai réel OK (détails dans STATE.md).
- [ ] Présentation : le bureau de Quart ne rend pas les blocs fichier/artefact/widget/image (seul Lanterne les rend).
- [ ] Présentation : attribuer à leur sous-agent les fichiers présentés par un sous-agent (aujourd'hui dans le fil principal).
- [ ] Présentation : refus d'un outil `lanterne` affiché comme `relance` ; Lanterne ne le montre pas encore.
- [x] Agent HQ v1 + moteur SDK : commités sur `nuit/2026-11-15`, testés de bout en bout en local (16/11, nuit).
- [ ] Chris : relire Agent HQ v1 ; puis fusion dans `dev`, push, CI verte, déploiement (`deploiement/deployer.sh tout`).
- [ ] Agent HQ : Authentik devant `/hq/` (comme le hub) en plus du mot de passe du relais.
- [ ] Agent HQ : maturité des pièces (taille, luxe selon l'âge du dépôt, commits, sessions) + manifeste de projet.
- [ ] Agent HQ : routage « Auto » de la réunion par un Haiku exécuté sur un poste (point d'extension `RouteurAuto`).
- [ ] Agent HQ : navigateurs virtuels (bureaux du hub) dans l'app ; idle compaction affichée en bulle d'info.
- [ ] Supprimer `bureau/` une fois Agent HQ adopté.
- [x] CI : `hq/` dans `.github/workflows/ci.yml` (typecheck, tests, build).
- [x] **Sémaphore / Vigie sur l’API v2** : refaite (sessions, fil, parc, alertes, réglages), charte Echo
      Agency clair/sombre selon l'iPhone ; build de l'IPA sur le portable.
- [ ] Chris : ajouter un vrai compte depuis l'écran Comptes (le code OAuth demande sa connexion) et ouvrir une
      session avec ce compte ; vérifier qu'aucun écran d'accueil du CLI ne bloque sur un dossier de config neuf.
- [ ] Chris : poser le nouvel IPA (dialogues répondables dans Vigie).
- [x] `claude-tmux.zsh` branché sur la tour (06/10, `~/.zshrc` ; l'ancien lanceur de Relais est commenté, même serveur tmux).
- [ ] Mode nuit : essai en vrai par Chris (une nuit), puis corrections ; installer la config nuit sur le Pi et le VPS (`~/.claude/night/install.sh`).
- [ ] Mode nuit : reconstruire et réinstaller l'app de bureau Tauri (la bascule/le badge sont déjà dans le web servi par le relais).
- [x] App de bureau Quart installée et connectée sur le portable (lanceur d'apps, thème, écran Comptes).
- [ ] Chris : valider « Ouvrir le terminal » (kitty, corrigé le 28/09 soir) depuis Quart et la notification système sur un objectif atteint.

- [ ] Chris : écran Accès en prod — créer un connecteur claude.ai, l'ajouter (Paramètres → Connecteurs), vérifier
      `quart_parc` depuis une conversation ; idem avec la commande Claude Code sur une machine.
- [ ] Reconstruire et réinstaller l'app de bureau Tauri : écran Accès (+ bascule nuit) seulement dans le web pour l'instant.
- [ ] Décider avec Chris de la fusion de `centralisation-sessions` (12/10 : lanceur `ccs`, veilleur, registre cc) dans `dev`,
      puis supprimer les branches locales `mcp-quart` / `acces` (déjà dans `dev`).
- [ ] Portable : `git pull` de `~/ccremote` (en retard sur `dev` depuis le 05/11).
- [ ] Chris : reconnecter le compte Claude du portable (« Login expired » à l'ouverture d'une session via le MCP).
- [ ] MCP Quart : l'installer sur le Pi et le VPS si des sessions y en ont besoin (`QUART_JETON_CIBLE=… mcp/installer.sh <hôte>`).

- [ ] Déploiement : la sauvegarde de la base avant migration est un `cp` de la base vivante (copie incohérente constatée le 16/11) → `sqlite3 .backup`.

## Ensuite

- [ ] Relever la consommation réelle d'une vraie session autonome longue (contexte avant/après chaque compaction,
      nombre de relances) et ajuster les seuils 120 k / 350 k si besoin.
- [x] Terminal intégré à l'app (xterm.js + PTY `Bun.Terminal` sur le poste) pour le web et le bureau (28/09).
- [x] Accès à distance par appareil : fichiers (aperçu, édition, dépôt) + terminaux + sessions (28/09).
- [ ] Accès à distance dans Sémaphore (iPhone) : fichiers, aperçu, édition, terminal (SwiftTerm).
- [x] Sessions Claude lancées hors tmux : listées en lecture seule (déclaration `sessions/<pid>.json`).
- [ ] Session de terminal : proposer « Reprendre dans tmux » une fois le terminal fermé.
- [x] Comptes : choix du compte à l'ouverture dans l'app ; écran Comptes (usage, ajout OAuth, retrait).
- [ ] Comptes : `compte-b` du VPS est déconnecté — le reconnecter ou le retirer depuis l'écran Comptes.
- [x] Rétention du fil : purger les événements des sessions fermées depuis plus de 30 jours (démarrage + toutes les 24 h).
- [ ] Décider avec Chris du pilotage à distance de kitty (répondre aux sessions lancées hors tmux).
- [ ] Nettoyer du registre les sessions d'essai fermées (« essai dialogues », « essai dialogues 2 »).
- [ ] Découper le bundle web (un seul fichier de 500 ko+) : Markdown chargé à la demande.

## Plus tard

- [ ] Décider la fin de `bureau/` au profit de `hq/` (reporter d'abord ce que l'app de bureau fait encore).
- [ ] `hq/art/` : sortir les `hq-monde-*.png` du suivi (ou les ignorer) ; retirer le chemin local de `art/gen/`.

- [ ] Écran Accès dans Sémaphore (iPhone) : lister / révoquer les accès depuis le téléphone.
- [ ] Connecteur claude.ai par OAuth au lieu du jeton dans l'URL, si le jeton en clair dans les journaux du tunnel
      devient un problème.
- [ ] Une fois les connecteurs HTTP éprouvés : retirer l'installation stdio (`~/.local/share/quart-mcp`) de la tour et
      du portable au profit de `claude mcp add --transport http`.

- [ ] Supprimer les anciennes installations désactivées (`ccremote-harness`, `ccremote-web`, `ccremote-pc`) une fois le v2
      éprouvé quelques jours.
- [ ] Fusionner `dev` dans `master` (dépôt public) après validation par Chris.
- [ ] Remote Control : après ON, `statut` reste `fermee` dans la fiche alors que le pane tmux tourne et répond (essai
      19/11, session d3b84433… jetable). Piste : publication tardive d'un état du SDK fermé, ou `rattacher` avant l'état du
      TUI. À reproduire avec un journal du poste (le log n'a rien sur la session).
