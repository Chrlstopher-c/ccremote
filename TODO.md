# TODO — ccremote
*Dernière mise à jour : 2026-07-06*

## En cours
_(rien d'actif à l'instant T)_

## À faire (priorité)
- [ ] Déployer sur le Pi : pas d'accès SSH depuis cet environnement, `deploy-web-pi.sh` à lancer manuellement
      (script corrigé cette session — il ne syncait pas `agent/`, `static/`, `pc_client.py`)

## Backlog
- [ ] Reasoning par round de tool-calling en streaming (actuellement fusionné en un seul bloc
      pour tout l'échange, simplification assumée)
- [ ] Décider si `zai-glm-4.7`/`gpt-oss-120b`/`gemma-4-31b` ont vraiment les tailles de contexte
      posées dans `MODEL_CONTEXT_TOKENS` (estimations faute de doc publique Cerebras)

## Terminé (session du 2026-07-06)
- [x] Suivi d'usage API Cerebras : quotas requêtes/tokens par minute/heure/jour (headers `x-ratelimit-*`
      réels capturés à chaque appel), + contexte de la conversation active (tokens utilisés/limite du
      modèle) — visible en pill dans le header agent et en détail dans Paramètres
- [x] Fix `deploy-web-pi.sh` : ne synchronisait que app.py/config.py/requirements.txt/index.html,
      jamais `agent/`, `static/`, `pc_client.py` (bug pré-existant, découvert en voulant déployer)
- [x] `gemma-4-31b` confirmé utilisé et fonctionnel par Chris — commentaire de doute retiré
- [x] Conformité standards projet : `README.md`, `ARCHITECTURE.md`, `start.sh`/`stop.sh`/`restart.sh`,
      `.env.example` racine
- [x] Fix responsive carte "PC distant" dans Paramètres (grid-cols-2 illisible sur mobile → stack vertical)
- [x] Fix hauteur mobile Safari (`100vh` → `100dvh`) sur index.html et login.html
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
