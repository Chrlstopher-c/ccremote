# Outils du parc pour les sessions hors de Lanterne

Une session Claude Code ouverte hors de Lanterne (terminal, Claude Desktop) peut piloter le parc de Chris par le
serveur MCP `parc` (`poste/presentation/mcp-parc.ts`). Il remplace l'ancien serveur `quart`, arrêté.

## Outils

| Outil | Rôle | Ne modifie rien |
|---|---|---|
| `parc_machines` | Machines, en ligne ou non ; réveil possible | oui |
| `parc_reveiller` | Réveil Wake-on-LAN d'une machine connue | non |
| `parc_sessions` | Sessions vivantes (ou toutes, `toutes: true`), filtre `machine` | oui |
| `parc_fil` | Derniers échanges lisibles d'une session (40 lignes au plus) | oui |
| `parc_envoyer` | Message à une session, comme tapé dans son terminal | non |
| `parc_ouvrir` | Nouvelle session sur une machine, dans un dossier absolu | non |
| `parc_repondre` | Réponse à un dialogue en attente (`index` ou `texte`) | non |

Exemple : `parc_sessions {"machine": "tour"}` puis `parc_fil {"session": "<id>", "limite": 20}`, puis
`parc_envoyer {"session": "<id>", "texte": "Reprends où tu en étais."}`.

## Chemin

```
serveur MCP parc ──socket──▶ poste (liste blanche) ──lien──▶ relais (requete_relais)
                                                             └─ relais/parc/outils-parc.ts
```

- Le socket est `$XDG_RUNTIME_DIR/lanterne/outils.sock` (0600), comme celui des modules.
- Le poste refuse tout ce qui n'est pas une opération du parc ou des modules (`commun/parc.ts`, `QuoiRelais`).
- Le relais valide chaque argument (zod) et rend chaque opération par la fonction de la route HTTP correspondante :
  `ApiSessions` (événements, messages, repondre, ouvrir), `ApiEntretien.reveiller`, `Postes.vues`, `Registre.sessions`.
  Aucune logique n'est dupliquée. L'aiguillage existant (session tenue ailleurs sans Remote Control) et ses refus
  s'appliquent à `parc_envoyer`.

## Garde-fous

- `parc_envoyer` et `parc_repondre` refusent de viser la session appelante : Lanterne pose `CCREMOTE_SESSION` dans
  les sessions tmux qu'elle lance. Une session ouverte dans un terminal ordinaire n'a pas d'identifiant connu : la garde
  ne la couvre pas.
- `parc_ouvrir` crée une session neuve : il ne vise aucune session existante, la garde ne s'applique pas.
- Le réveil n'envoie une trame qu'aux machines dont l'adresse est configurée (`CCREMOTE_WOL=<machine>=<mac>,...` sur le
  relais, `CCREMOTE_DIFFUSION_WOL` pour la diffusion). Rien n'est en dur dans le code.
- Chaque action est journalisée (pino, sur stderr côté serveur MCP ; par domaine `outils-parc` côté relais), sans le
  texte des messages.
- Limites : 20 000 caractères par message, 128 Kio par requête sur le socket, 35 s de délai côté relais.

## Déclaration

Faite par le coordinateur dans la configuration utilisateur de Claude Code, pas par le dépôt :

```sh
claude mcp add --scope user parc -- bun run <dossier-du-code>/poste/presentation/mcp-parc.ts
```

Sur une machine où le code du poste est installé (`bun install --production`) :
`$HOME/.local/share/lanterne-poste<suffixe>/code/poste/presentation/mcp-parc.ts`.

## Tests

`bun test poste/presentation/mcp-parc.test.ts poste/presentation/parc-format.test.ts relais/parc/outils-parc.test.ts`
(socket factice, relais en mémoire, serveur lancé en sous-processus : initialize, tools/list, tools/call).
