# TODO — ccremote

## En cours

- [ ] **Sémaphore / Vigie sur l'API v2** : refaire le monde Vigie (sessions, fil, parc, notifications), charte Echo
      Agency clair/sombre selon l'iPhone ; build de l'IPA sur le portable.
- [ ] Valider l'app de bureau connectée sur le portable (connexion avec le mot de passe, « Ouvrir le terminal » depuis
      l'app, notification système sur un objectif atteint).

## Ensuite

- [ ] Relever la consommation réelle d'une vraie session autonome longue (contexte avant/après chaque compaction,
      nombre de relances) et ajuster les seuils 120 k / 350 k si besoin.
- [ ] Terminal intégré à l'app (xterm.js + PTY `Bun.Terminal` sur le poste) pour le web et l'iPhone.
- [ ] Sessions Claude lancées hors tmux sur le bureau de la tour : les lister (lecture) et proposer « Reprendre dans tmux ».
- [ ] Comptes : choix du compte à l'ouverture dans l'app (le VPS en a deux : `compte-a`, `compte-b`).
- [x] Rétention du fil : purger les événements des sessions fermées depuis plus de 30 jours (démarrage + toutes les 24 h).
- [ ] Découper le bundle web (un seul fichier de 500 ko+) : Markdown chargé à la demande.

## Plus tard

- [ ] Supprimer les anciennes installations désactivées (`ccremote-harness`, `ccremote-web`, `ccremote-pc`) une fois le v2
      éprouvé quelques jours.
- [ ] Fusionner `dev` dans `master` (dépôt public) après validation par Chris.
