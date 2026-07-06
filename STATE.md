# STATE — ccremote
*Dernière mise à jour : 2026-07-06 (soir)*

## Résumé de l'état actuel

ccremote est un panneau de contrôle personnel : un serveur websocket tourne sur le PC principal
(TrinityArch, `pc.exemple:8765`) et expose tmux (sessions Claude Code) + métriques système ;
une app FastAPI (`pi-web`) tourne sur un Raspberry Pi et sert une SPA exposée publiquement via
Cloudflare Tunnel (`ccremote.exemple.com`). Un agent IA (Cerebras, tool-calling) pilote
le tout en langage naturel : statut PC, sessions tmux, métriques, comptes Claude Code, extinction.

Design "Anthropic-style" (cream/serif/orange) repris d'un mockup fourni par Chris, entièrement
re-câblé sur le vrai backend (aucune donnée fictive). Mobile-first, streaming SSE, markdown stylisé,
conversations persistantes en localStorage. Déployé et vérifié fonctionnel en prod.

## Ce qui a été fait — session du 2026-07-06 (suite, fin de journée)

- **Fix bouton extinction PC (bug signalé par Chris)** : `subprocess.Popen(["poweroff"])` échouait
  silencieusement côté serveur (`Access denied — interactive authentication required`, vu dans
  `journalctl -u ccremote-server`). Cause : `ccremote-server.service` tourne comme service systemd
  (`User=trinity`) hors session logind — le `CanPowerOff=yes` vérifié précédemment ne valait que
  pour la session graphique active, pas pour un process de service. Fix : règle polkit dédiée
  `/etc/polkit-1/rules.d/49-ccremote-poweroff.rules` autorisant `org.freedesktop.login1.power-off`
  pour l'uid `trinity` sans condition de session. Vérifié via `pkcheck` (`result=yes`) ; pas de test
  réel déclenché (irréversible), à valider par Chris depuis l'app.
- **Fix quotas Cerebras pas "temps réel" (bug signalé par Chris)** : les quotas affichés restaient
  figés sur les valeurs du dernier appel API réel — après un appel épuisant un quota (ex: 5/min),
  la minute suivante sans nouvel appel montrait toujours l'ancien `remaining`, donnant l'impression
  fausse que le quota ne se régénère jamais. Cause : `agent/usage.py` stocke un snapshot passif des
  headers `x-ratelimit-*`, jamais recalculé entre deux appels. Fix : `_effective_quotas()` compare
  le temps écoulé depuis `updated_at` à la durée de la fenêtre (`WINDOW_SECONDS`) et resynthétise
  `remaining = limit` si la fenêtre est dépassée — heuristique "reset complet après un cycle entier
  sans appel", cohérente avec une fenêtre glissante Cerebras. Appliqué à `get_snapshot()` et
  `_combined_quotas()`. Déployé sur le Pi (`scp` + `systemctl restart ccremote-web`), service
  vérifié actif.

## Ce qui a été fait — session du 2026-07-06

- Retrait du sous-titre "Agent local" sous le logo ccremote dans la sidebar (demande directe de Chris)
- Déploiement effectué directement par l'agent via `~/.ssh/id_ed25519_ccremote` (accès SSH direct
  au Pi `pi@pi.exemple`, sudo passwordless pour le restart du service) — plus besoin que Chris
  exécute les commandes lui-même à chaque déploiement pi-web. Voir mémoire sémantique
  `ccremote-pi-ssh-access`.
- Affichage des quotas repensé après remarque de Chris : la carte "Utilisation" montrait
  seulement la clé active, ce qui donnait l'impression fausse d'être proche du mur en cas de
  quasi-épuisement de key1 alors que key2 est intacte à côté. Vu que le fallback est réel et
  automatique, la capacité combinée (10 req/min, 60k tokens/min avec 2 clés) n'est pas fictive —
  affichée en priorité (`agent/usage.py::get_all`, somme des limites/restants des clés
  configurées), avec le détail par clé toujours visible en dessous pour ne rien cacher.
- Fix signalé par Chris : le snapshot de quotas (en mémoire) redevenait vide à chaque restart du
  serveur, ce qui donnait l'impression trompeuse que le quota réel était remis à zéro — alors que
  le quota côté Cerebras n'est jamais affecté par un restart de notre process, seul notre miroir
  local l'était. Fix : `warm_up_usage()` (`agent/client.py`) fait un appel minimal (max_tokens=1)
  par clé configurée au démarrage du serveur (`lifespan` FastAPI, `app.py` — migré depuis
  `on_event("startup")` déprécié au passage), pour peupler le vrai snapshot avant toute requête
  utilisateur. Coût : 1 requête par clé et par restart.
- Rotation automatique de clé API Cerebras (`CEREBRAS_API_KEY_2`) : `create_completion`/
  `create_completion_stream` (`agent/client.py`) essaient la clé active, et sur `RateLimitError`
  (429) basculent vers la clé suivante et retentent une fois avant de propager l'erreur. Quotas
  suivis séparément par clé (`agent/usage.py`, `get_snapshot(key_label)`). Un event SSE
  `key_rotated` prévient l'UI (toast + entrée historique) quand la bascule a lieu en cours de
  conversation. Logique de rotation validée par un test isolé (mock de RateLimitError, sans
  requête réseau — le rate limit Cerebras (fenêtre glissante) rendait un test live peu fiable
  sans gaspiller le quota réel).
- Suivi d'usage API Cerebras (`agent/usage.py`) : `create_completion`/`create_completion_stream` passent
  par `with_raw_response` pour capturer les vrais headers `x-ratelimit-{limit,remaining}-{requests,tokens}-
  {minute,hour,day}` renvoyés par Cerebras à chaque appel, stockés en snapshot mémoire (process unique,
  pas de DB nécessaire). Exposé via `GET /api/agent/usage` et embarqué dans chaque event `done` du stream
  (`agent/chat.py`), donc mis à jour dans l'UI sans requête supplémentaire après chaque échange.
- Contexte de la conversation active : `POST /api/agent/context-usage` réutilise
  `estimate_messages_tokens`/`MODEL_CONTEXT_TOKENS` déjà en place pour le compactage — donne
  tokens_used/tokens_limit pour l'historique + le modèle courants, rafraîchi au changement de vue/modèle/
  conversation. Affiché en pill compacte dans le header Agent IA (`headerContextUsage`) et en détail dans
  une nouvelle carte "Utilisation" (Paramètres), avec les 6 barres de quotas (2 types × 3 fenêtres),
  couleur verte/orange/rouge selon le ratio consommé (seuils 70%/90%).
- Fix `deploy-web-pi.sh` : ne synchronisait que 4 fichiers (app.py/config.py/requirements.txt/
  templates/index.html), jamais `agent/`, `static/`, ni `pc_client.py` — bug pré-existant découvert
  en tentant de déployer cette feature. Corrigé pour syncer les dossiers entiers.
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
| Rotation round-robin réactive (sur 429), pas proactive | Simplicité — bascule seulement quand la clé active est réellement épuisée, pas d'alternance systématique qui compliquerait le suivi de quota par clé | 2026-07-06 |
| Quotas affichés en combiné (somme des clés) + détail par clé | Chris a fait remarquer que le fallback étant réel et automatique, un total combiné n'est pas trompeur — seulement l'était le fait de ne montrer que la clé active | 2026-07-06 |
| Reset quota simulé par seuil (pas d'interpolation progressive) | Chris a explicitement décrit l'attente comme un reset complet après une fenêtre pleine ("la minute d'après ça doit revenir à zéro"), pas une régénération graduelle — plus simple et fidèle à la demande | 2026-07-06 |
| Règle polkit dédiée plutôt que modifier le service pour tourner en session utilisateur | Le service `ccremote-server` doit rester un service système auto-démarré au boot, indépendant d'une session graphique ouverte | 2026-07-06 |

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
- **`poweroff` (symlink vers `systemctl`) passe toujours par polkit**, même lancé depuis un service
  systemd tournant sous un utilisateur non-root — polkit distingue "session active" de "process de
  cet uid", et une règle basée sur `CanPowerOff` de session ne couvre pas le second cas. Toute
  action privilégiée déclenchée par `ccremote-server` (pas seulement poweroff) devra passer par une
  règle polkit explicite sur l'uid, jamais s'appuyer sur un test fait en session interactive.
- **Coût réel par appel bien plus élevé que le message tapé** : `TOOL_SCHEMAS` (tous les tools
  disponibles) est envoyé à chaque appel Cerebras, même sans tool call. Vérifié en prod (test session
  du 2026-07-06) : un message de 8 mots sans tool a consommé ~16 650 tokens sur le quota "tokens/minute"
  (limite 30 000) — la marge réelle avant un 429 est donc bien plus faible que ce que la longueur de
  la conversation seule suggérerait. C'est justement ce que le nouveau suivi de quotas rend visible.

## Prochaines étapes

- Aucune tâche explicitement demandée en attente à la fin de cette session.
- Voir "Points en suspens" pour ce qui mériterait attention prochainement.

## Points en suspens

- **Bouton extinction non re-testé en réel** après le fix polkit (le test aurait réellement éteint
  la machine) — vérification faite uniquement via `pkcheck` (résultat `yes`). À confirmer par Chris
  depuis l'app à sa prochaine utilisation.
- **Heuristique de reset des quotas non vérifiée en conditions réelles prolongées** — la logique
  "reset complet après une fenêtre pleine sans appel" est un best-effort cohérent avec une fenêtre
  glissante, mais n'a pas été observée sur un vrai cycle minute/heure/jour en prod. À surveiller si
  Chris rapporte encore un écart.
- **Les deux clés Cerebras sont sur le tier gratuit** (5 req/min, 30k tokens/min chacune, confirmé
  par les vraies limites remontées dans l'UI) — la rotation double la marge mais ne résout pas le
  problème structurel. Si les 429 reviennent fréquemment malgré les 2 clés, la vraie solution est
  un tier payant côté Cerebras (décision business de Chris, pas un fix côté code).
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
