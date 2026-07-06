# STATE — ccremote
*Dernière mise à jour : 2026-07-06*

## Résumé de l'état actuel

ccremote est un panneau de contrôle personnel : un serveur websocket tourne sur le PC principal
(TrinityArch, `pc.exemple:8765`) et expose tmux (sessions Claude Code) + métriques système ;
une app FastAPI (`pi-web`) tourne sur un Raspberry Pi et sert une SPA exposée publiquement via
Cloudflare Tunnel (`ccremote.exemple.com`). Un agent IA (Cerebras, tool-calling) pilote
le tout en langage naturel : statut PC, sessions tmux, métriques, comptes Claude Code, extinction.

Design "Anthropic-style" (cream/serif/orange) repris d'un mockup fourni par Chris, entièrement
re-câblé sur le vrai backend (aucune donnée fictive). Mobile-first, streaming SSE, markdown stylisé,
conversations persistantes en localStorage. Déployé et vérifié fonctionnel en prod.

## Ce qui a été fait — session du 2026-07-06

- Fix header mobile dupliqué (topbar séparée + header de vue) → hamburger intégré dans chaque
  header de vue, un seul header visible par vue
- Fix bug de propagation d'event : le clic sur le hamburger bubblait jusqu'au listener global
  `[data-view]` qui refermait la sidebar juste après l'avoir ouverte (`stopPropagation()`)
- Réponses de l'agent IA en streaming SSE (token par token), `content_delta`/`reasoning_delta`/
  `tool_call`/`compacted`/`done` comme types d'event
- Rendu markdown stylisé (marked + DOMPurify, CDN pinnés) au lieu de texte brut échappé
- Conversations persistantes : listables/reprenables depuis la sidebar (localStorage
  `ccr_conversations`), fini la perte au clic sur "Nouvelle conversation"
- Compactage automatique de l'historique selon la fenêtre de contexte du modèle actif
  (`agent/context.py`) — résumé via le même modèle, notifié côté UI par un event `compacted`
- Fix bug prod (crash rapporté par Chris) : `tmux send-keys` envoyait texte + `Enter` en un seul
  appel — Claude Code (TUI en bracketed-paste) avalait l'Enter sans soumettre, le texte restait
  visible dans l'input sans être envoyé. Fix : deux appels `send-keys` séparés par un court délai
- Fix robustesse : timeout ajouté sur `ws.recv()` (jamais de hang indéfini côté pi-web↔PC),
  erreurs Cerebras interceptées proprement dans la boucle de streaming au lieu de couper le flux
  SSE sans event `done`
- Nouveau : switch de compte Claude Code depuis Paramètres — deux comptes déjà présents en
  snapshots (`~/.claude/.credentials_account1.json` / `_account2.json`), un switch bascule
  `.credentials.json` et redémarre les sessions tmux en cours pour qu'elles chargent la nouvelle
  identité. Métadonnées dans `~/.claude/.ccremote-accounts.json` (créé et confirmé cette session :
  account1 = compte-a@exemple.fr actif, account2 = compte-b@exemple.fr)
- Nouveau : bouton extinction PC (`poweroff`, sans sudo — confirmé autorisé par polkit pour la
  session active via `CanPowerOff` → yes)
- Déployé et vérifié en prod à chaque étape (curl direct + Playwright DOM/console, jamais de
  screenshot sur demande explicite de Chris)
- Fix hauteur mobile Safari : `h-screen`/`min-h-screen` (`100vh`) remplacés par `100dvh` (avec
  fallback `vh`) sur `index.html` (`.app-shell`) et `login.html` — la barre d'outils dynamique de
  Safari iOS rendait `100vh` plus grand que la zone réellement visible, poussant le bas de page
  hors écran et rendant toute la page scrollable (cachait tour à tour header et input selon le
  scroll). Confirmé par Chris sur iPhone XS.
- Fix responsive carte "PC distant" (Paramètres) : `grid-cols-2` forçait deux colonnes même sur
  mobile, coupant la valeur MAC. Passé en `grid-cols-1 sm:grid-cols-2` avec label/valeur empilés
  verticalement sur mobile.
- `gemma-4-31b` confirmé réellement utilisé et fonctionnel par Chris (levée du doute posé plus tôt
  dans la session sur ce modèle)
- Conformité complète aux standards projet : `README.md`, `ARCHITECTURE.md` (avec justification
  explicite de la déviation "découpage par machine" plutôt que par domaine métier pur — pertinent
  pour un outil perso à 3 exécutables physiques), `start.sh`/`stop.sh`/`restart.sh` (gèrent le
  dev local de `pi-web` par PID file, `server.py` reste géré par systemd), `.env.example` racine

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| Cerebras (pas Groq) comme provider IA | Choix explicite de Chris | avant 2026-07-06 |
| Modèle par défaut `gpt-oss-120b` | Seul modèle avec tool-calling vérifié fonctionnel parmi les 3 dispo sur la clé | avant 2026-07-06 |
| Contexte des modèles estimé, pas documenté par l'API | `/v1/models` Cerebras ne renvoie pas la taille de contexte ; valeurs conservatrices posées en dur dans `client.py` | 2026-07-06 |
| localStorage pour conversations/prefs (pas de DB) | Cohérent avec l'architecture stateless existante, pas de comptes utilisateurs | 2026-07-06 |
| Switch de compte : snapshot + restart tmux, pas de hot-reload | Claude Code garde son token en mémoire process ; seul un restart du process charge la nouvelle identité | 2026-07-06 |
| `poweroff` nu (pas `systemctl poweroff`) | Préférence explicite de Chris, habitude déjà validée sans sudo | 2026-07-06 |

## Contexte non-évident

- **`~/.claude/.credentials_account1.json` / `_account2.json`** existaient déjà avant cette
  session (créés manuellement par Chris) — ccremote ne fait que les orchestrer. Les tokens sont
  opaques (`sk-ant-oat01-...`), pas de JWT décodable : impossible de déterminer par le code quel
  compte est actif sans le fichier de métadonnées `.ccremote-accounts.json` que cette session a
  introduit comme source de vérité côté serveur.
- **Cloudflare Tunnel** expose l'app publiquement — le footer de login a été corrigé pour ne plus
  prétendre "réseau local uniquement" (faux depuis la mise en place du tunnel).
- **`WS_TIMEOUT` (connexion) vs `RECV_TIMEOUT` (réponse)** dans `pc_client.py` : deux timeouts
  distincts nécessaires — l'ancien code n'avait qu'un `open_timeout`, la réponse pouvait hang
  indéfiniment si le serveur ne répondait jamais (c'était plausiblement la cause du "crash" rapporté).
- **`X-Accel-Buffering: no`** ajouté sur la réponse SSE pour éviter tout buffering par un reverse
  proxy intermédiaire (Cloudflare Tunnel) qui casserait le streaming en prod.

## Prochaines étapes

- Aucune tâche explicitement demandée en attente à la fin de cette session.
- Voir "Points en suspens" pour ce qui mériterait attention prochainement.

## Points en suspens

- **Reasoning en un seul bloc par échange** (pas par round de tool-calling) : simplification
  assumée pour le streaming — acceptable visuellement mais perd la granularité "un think block
  par round" qu'avait l'ancienne version non-streamée.
- **Tailles de contexte des modèles Cerebras** (`MODEL_CONTEXT_TOKENS`) restent des estimations
  faute de documentation publique — `gemma-4-31b` est confirmé utilisé par Chris, mais sa vraie
  fenêtre de contexte n'est pas vérifiée (32k posé par prudence).

## Historique

### Sessions précédentes (avant 2026-07-06)
- Mise en place initiale : repo GitHub privé, checkpoint stable
- Agent IA ajouté (tool-calling Cerebras) avec vérification live des modèles disponibles sur la clé
- Mot de passe UI déplacé en `.env`, changé sur demande
- Refonte complète du frontend à partir d'un mockup fourni (design "Anthropic-style"), 100% du
  JS fictif du mockup remplacé par du vrai câblage backend
- Page de login refaite deux fois (mockup corrigé par Chris), remember-me retiré
- Passe mobile-first complète + panneau droit redimensionnable en drag
