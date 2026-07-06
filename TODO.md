# TODO — ccremote
*Dernière mise à jour : 2026-07-06*

## En cours
_(rien d'actif à l'instant T)_

## À faire (priorité)
- [ ] Vérifier si `gemma-4-31b` est réellement utilisé — sinon le retirer de `AVAILABLE_MODELS`
      pour ne pas laisser un choix de contexte deviné dans l'UI

## Backlog
- [ ] Conformité standards projet : `README.md`, `ARCHITECTURE.md`, `start.sh`/`stop.sh`/`restart.sh`,
      `.env.example` pour `server/` et `client/`
- [ ] Reasoning par round de tool-calling en streaming (actuellement fusionné en un seul bloc
      pour tout l'échange, simplification assumée)
- [ ] Décider si `zai-glm-4.7`/`gpt-oss-120b` ont vraiment 128k de contexte côté Cerebras, ou si
      les valeurs de `MODEL_CONTEXT_TOKENS` doivent être resserrées

## Terminé (session du 2026-07-06)
- [x] Fix header mobile dupliqué (topbar + header de vue → un seul header, hamburger intégré)
- [x] Fix bug stopPropagation empêchant l'ouverture de la sidebar mobile
- [x] Streaming SSE des réponses de l'agent IA
- [x] Rendu markdown stylisé (marked + DOMPurify)
- [x] Conversations persistantes et reprenables (sidebar)
- [x] Compactage automatique du contexte selon le modèle actif
- [x] Fix crash prod : `send_keys` (texte + Enter séparés, délai) — bracketed-paste de Claude Code
- [x] Timeout sur `ws.recv()` + interception propre des erreurs Cerebras dans le stream
- [x] Switch de compte Claude Code (UI Paramètres + tool agent) avec restart tmux automatique
- [x] Bouton extinction PC (`poweroff` sans sudo, confirmé autorisé par polkit)
- [x] STATE.md / TODO.md / ARBORESCENCE.md créés pour le projet (n'existaient pas avant)
