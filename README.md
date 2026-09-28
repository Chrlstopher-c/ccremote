# Quart (ccremote)

Toutes les sessions **Claude Code** d'un parc de machines, depuis un seul endroit : une app de bureau (Arch Linux),
le web, ou l'iPhone ([Sémaphore](https://github.com/Chrlstopher-c/semaphore)).

- **De vraies sessions Claude Code**, en TUI, dans un serveur tmux dédié (`tmux -L claude`) : on s'y attache dans kitty,
  on les suit et on leur parle à distance. Celles lancées à la main sont reconnues aussi.
- **Un fil précis** : chaque outil avec son entrée complète et son résultat, chaque sous-agent suivi pas à pas.
- **De l'autonomie qui ne brûle pas le compte** : une session travaille jusqu'à son objectif, se compacte aux fins
  d'étape et au-delà d'un seuil de contexte, et plafonne ses sous-agents.
- **Tout le parc** : ouvrir une session sur n'importe quelle machine, y compris sur le projet d'une autre (par SSH),
  voir l'état de chaque machine, la réveiller ou l'éteindre.
- **Répondre à Claude d'où qu'on soit** : ses questions, demandes de permission et validations de plan s'affichent
  dans l'app et sur l'iPhone, et s'y répondent comme au clavier.
- **Les comptes Claude Code** : usage en cours (fenêtre de 5 h, semaine) de chaque compte, machines où il est connecté ;
  en ajouter un sur la machine de son choix (connexion OAuth dans le navigateur), le retirer.

Architecture et définitions : [`ARCHITECTURE.md`](ARCHITECTURE.md). État courant : [`STATE.md`](STATE.md).

## Stack

| Partie | Technique |
|---|---|
| Relais (Pi) et postes | Bun + TypeScript, `bun:sqlite`, zod, pino, SDK MCP |
| App de bureau | Tauri 2 (Rust) + React 19, Tailwind 4, motion, charte Echo Agency (clair / night) |
| Sessions | Claude Code CLI dans tmux ; fil lu dans les transcripts JSONL ; hooks + MCP stdio pour le rythme |

## Ports

| Port | Rôle |
|---|---|
| 8766 | Relais : API des clients, flux WebSocket, app web (derrière Cloudflare Tunnel) |
| 8721 | Relais : lien des postes (WebSocket authentifié par machine) |
| 1420 | App : serveur de dev Vite |

## Lancer en local (dev)

```bash
bun install && (cd bureau && bun install)
cp .env.example .env         # puis renseigner l'empreinte du mot de passe et les secrets de poste
./start.sh                   # relais local + interface (Vite) ; ./stop.sh, ./restart.sh
bun test commun poste relais && (cd bureau && bun test src)
```

Un poste se lance avec `bun run poste/bin.ts` et `~/.config/ccremote/poste.json` (voir `poste/config.ts`).
Pour que tout `claude` tapé au clavier soit pilotable depuis Quart, sourcer `poste/session/claude-tmux.zsh` dans
`~/.zshrc`, avant tout autre enrobage de `claude` (`QUART_SANS_TMUX=1 claude` pour un lancement nu).

## Déployer

```bash
./deploiement/deployer.sh tout          # postes (tour, portable, vps, pi) puis relais
./deploiement/deployer.sh poste tour    # une seule machine
./bureau/construire.sh                  # build release de l'app (sur la tour)
./bureau/installer.sh                   # installe Quart (binaire `quart`, entrée du lanceur d'apps)
```

Les valeurs réelles (adresses, MAC, secrets) vivent dans `~/.config/ccremote/deploiement.env`, jamais dans le dépôt.

## Licence

AGPL-3.0-or-later.
