# STATE — ccremote

*Dernière mise à jour : 2026-09-28 (nuit), branche `dev`*

## Résumé

**ccremote v2 est en production sur les quatre machines.** Le Pi n'héberge plus d'orchestrateur LLM : un relais sans IA
(`ccremote-relais`) remplace `ccremote-harness` et `ccremote-web` (désactivés, pas supprimés). Chaque machine fait
tourner un poste (`ccremote-poste`) qui gère les **vrais Claude Code en TUI** dans `tmux -L claude` — le même serveur que
relais/Atrium. L'app de bureau (Tauri) est installée sur le portable ; le même frontend est servi en web sur le domaine
public. `master` reste la version publique précédente ; `dev` porte le v2.

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
- **Qualité** : 42 tests (poste, relais, app), typecheck strict, linter des standards à 0 violation.

## Vérifié en réel (production, domaine public)

- 4 postes connectés ; projets découverts (tour 98, portable 20, pi 9, vps 3) ; 2 sessions de Chris adoptées sur la tour.
- Session autonome sur la tour : fichier créé, vérifié, commité, `objectif_atteint` → statut « terminée ».
- **Session sur le Pi travaillant sur un projet de la tour par SSH** : objectif atteint en 30 s.
- VPS → projet de la maison : refusé (403). Fermeture par l'API : tmux arrêté.
- Sur le portable (banc local) : étape → compaction pilotée → relance → objectif atteint, sans intervention.
- Attache kitty au TUI d'une session lancée par l'API : conforme.

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

Voir [`TODO.md`](TODO.md) — en tête : le monde Vigie de Sémaphore refait sur l'API v2.
