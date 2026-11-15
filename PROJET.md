# PROJET — Agent HQ (sur Quart)

**Pourquoi** : remplacer Claude Desktop et l'appli mobile Claude par une app à soi, façon jeu (Les Sims / Smallville),
pour piloter toutes les sessions Claude Code du parc d'un coup d'œil.
**Pour qui** : Chris, sur la tour, le portable et le téléphone.
**Référence** : intérieurs de Stardew Valley vus murs baissés (Les Sims), Smallville (Generative Agents) pour le monde
vivant ; Claude Desktop pour la qualité du fil de conversation.
**Voie** : moteur = relais + postes de Quart, sessions par l'Agent SDK (abonnement, pas de clé API) ; app web
`hq/` (Phaser + React) servie par le relais ; assets dessinés par procédure dans une projection unique (`hq/art/`).
Cadrage d'origine : `~/Agent HQ — notes de cadrage.md`. Règles de rendu : `hq/art/DIRECTION.md`.

## Décisions
- 15/11 : bâtir sur Quart (moteur), son interface part à la poubelle ; Agent SDK préféré à tmux.
- 15/11 : back-end délégué à Haiku, design fait par Claude (Opus).
- 16/11 : une seule projection et une seule taille de pixel pour tout le décor ; exception : le perso de Chris en
  résolution native pour rester reconnaissable.
- 16/11 : `/hq/` public (écran de connexion), API protégée.

## Plan (épiques)
1. Moteur SDK du poste + cycle de vie — **fait**
2. Monde jeu + écran d'agent (remplacer Desktop au quotidien) — **v1 faite**
3. Terminal, fichiers, bibliothèque, réunion, embauche — **v1 faite**
4. Sécurité et déploiement (Authentik, prod) — à faire avec Chris
5. Monde vivant : maturité des pièces, manifeste de projet, MCP d'événements, navigateurs virtuels — à venir
