# TODO — Quart (dépôt ccremote)
*Dernière mise à jour : 2026-09-28*

## En cours

- [x] **Sémaphore / Vigie sur l’API v2** : refaite (sessions, fil, parc, alertes, réglages), charte Echo
      Agency clair/sombre selon l'iPhone ; build de l'IPA sur le portable.
- [ ] Chris : ajouter un vrai compte depuis l'écran Comptes (le code OAuth demande sa connexion) et ouvrir une
      session avec ce compte ; vérifier qu'aucun écran d'accueil du CLI ne bloque sur un dossier de config neuf.
- [ ] Chris : poser le nouvel IPA (dialogues répondables dans Vigie).
- [ ] Brancher `claude-tmux.zsh` sur la tour (son lanceur actuel vit dans `/mnt/projects/relais/sessions/`).
- [x] App de bureau Quart installée et connectée sur le portable (lanceur d'apps, thème, écran Comptes).
- [ ] Chris : valider « Ouvrir le terminal » (kitty, corrigé le 28/09 soir) depuis Quart et la notification système sur un objectif atteint.

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

- [ ] Supprimer les anciennes installations désactivées (`ccremote-harness`, `ccremote-web`, `ccremote-pc`) une fois le v2
      éprouvé quelques jours.
- [ ] Fusionner `dev` dans `master` (dépôt public) après validation par Chris.
