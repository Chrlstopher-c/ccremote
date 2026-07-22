# Décisions opérateur — suite à revue du paquet

Complète `02-hypotheses.md`. Numérotation continue (H-50+).

---

## H-50 `[TERMINÉ]` — Plancher de déni générique, pas de segmentation par projet

Pas de secrets significatifs différenciés par projet au-delà des `.env` classiques. Pas de clés
globales système dédiées à Claude à protéger spécifiquement. **Conséquence** : la liste-cadre déjà
posée en C.1.3/G.2.2 (destruction hors worktree, réécriture d'historique git partagé, écrasement de
`.env`/secrets, désinstallation d'outillage système) suffit telle quelle. Pas d'inventaire
supplémentaire par projet à établir avant M-20.

**Déplacement du vrai garde-fou** : ce n'est pas une liste de règles Bash étendue qui protège, c'est
la qualité du mandat et du system prompt donné à l'équipe. Confirme la philosophie de H-41.

---

## H-51 `[TRANCHÉE]` — Composition d'équipe : les deux modes coexistent

Pas un choix binaire figé à l'architecture. Deux chemins valides, au cas par cas :
- l'orchestrateur maître compose directement l'équipe (liste de profils de sous-agents au dispatch) ;
- il délègue au team leader le choix de qui invoquer et quand (Agent Teams natif ou `agents`
  programmatique, à la main du lead une fois lancé).

Cohérent avec H-14 (Agent Teams optionnel par équipe) et F.3.3 (subagents programmatiques) — aucune
des deux branches n'a besoin d'être révisée, ceci confirme juste qu'aucun mode n'est exclu par défaut.

---

## H-52 `[NOUVEAU]` `[I]` — Contenu obligatoire du system prompt du lead

Le mandat (F.3.1) doit toujours porter, en plus du `but`/`critere_arret`/`perimetre` déjà spécifiés :

- rôle explicite **« team leader »** : responsable de A à Z sur son équipe — développement, tests,
  debug, **tests end-to-end avant de déclarer terminé**.
- obligation d'utiliser les MCP à disposition (Playwright, Log Watcher, pty-mcp, etc.) pour valider
  réellement, pas seulement lire du code — reprise directe de la pratique manuelle de l'opérateur
  (voir `CLAUDE.md` global, section "Dev autonomy").

**Motif** : dans un système sans supervision humaine continue, le lead *est* le "parent" au sens de
la règle de validation E2E — il n'y a personne d'autre en amont pour la faire. Le garde-fou n'est pas
une règle de permission supplémentaire, c'est la qualité et la fermeté de cette instruction dans le
system prompt.

---

## H-53 `[TRANCHÉE — VÉRIFIÉ EN RÉEL]` `[I]` — Isolation des comptes par `CLAUDE_CONFIG_DIR`

**Gap comblé** : aucune branche du paquet ne couvrait la bascule entre les deux comptes Claude Code
(OAuth, abonnement mensuel — **pas** l'API Anthropic facturée au token).

### Ce qui a été vérifié, comment

SDK `0.3.217` installé et lu (`sdk.d.ts`, 7096 lignes), plus **trois tests d'exécution réels** sur le
poste, le 2026-07-22 :

| Test | Méthode | Résultat |
|---|---|---|
| Isolation effective | `CLAUDE_CONFIG_DIR=<dir vide> claude -p "hi"` | **« Not logged in · Please run /login »** alors que `~/.claude/.credentials.json` est valide ⇒ les credentials sont lus **depuis `CLAUDE_CONFIG_DIR`**, pas depuis un chemin en dur |
| Auth sur compte isolé | copie de `.credentials_account1.json` dans un dir isolé, requête minimale | **Réponse normale.** `~/.claude/.credentials.json` (compte actif) **non modifié**, mtime inchangé |
| Quota temps réel | `--output-format stream-json` sur le compte isolé | événement `rate_limit_event` réel reçu (voir H-54) |

Copie de credentials détruite (`shred`) après test.

### Conséquence architecturale

**`CLAUDE_CONFIG_DIR` est réglable par worker via `Options.env`** (déjà dans la table de B.1.3). Donc :

> **N workers peuvent tourner simultanément sur N comptes différents, sur la même machine, sans
> jamais toucher au `.credentials.json` du poste.**

Le mécanisme historique de ccremote (écraser `.credentials.json` + kill/relaunch des sessions tmux —
mémoires `nightwatch-credentials-swap`, `ccremote` STATE) est **rendu obsolète pour le harness**. Il
reste valide pour le Claude Code interactif du poste, qui lui n'a qu'un seul compte actif à la fois.

**Le repli redouté « un seul compte actif pour tout le parc, bascule = redémarrage général » est
écarté : il n'est pas nécessaire.**

### Ce que ça impose

- Un répertoire de config **par compte**, hors du dépôt, permissions `600` sur les credentials.
- `☠ CASSE` — `env` **remplace** l'environnement (déjà signalé en B.1.3, panne #19 de la grille).
  Poser `CLAUDE_CONFIG_DIR` sans `...process.env` fait perdre `PATH`. Les deux vont ensemble.
- `☠` Le `CLAUDE_CONFIG_DIR` d'un worker reçoit **aussi les transcripts locaux** (JSONL) — c'est la
  « vérité » au sens de H.3.1. Ne pas le pointer vers `/tmp` sans avoir mesuré l'impact sur la
  rétention (H.3), sinon la source de vérité devient volatile.
- Le registre (E.1.3) stocke **le compte utilisé** par mission. Sans ça, impossible d'attribuer une
  consommation à un compte, ni de savoir quoi relancer ailleurs quand un compte sature.

### Politique de rotation `⊣ DÉLÉGUÉ`

Réactive sur saturation, transposée du pattern Cerebras déjà en place dans ccremote
(`agent/client.py`) : détection via `USAGE_LIMIT_ERROR_PREFIXES` (E.4.3) et/ou
`rate_limit_info.status === 'rejected'` (H-54), puis dispatch des missions **suivantes** sur le compte
disponible.

`⚠ HYP` — bascule d'une mission **en cours** d'un compte à l'autre : non spécifiée. Le compte est fixé
au spawn (comme tout le reste des options). Une mission qui sature attend le reset ou est redispatchée.
Suffisant tant que le régime est « missions courtes » (F2.0.1).

---

## H-54 `[TRANCHÉE — VÉRIFIÉ EN RÉEL]` `[R]` — Quota temps réel par compte, natif

**Le SDK est parfaitement adapté à l'usage par abonnement.** L'inquiétude « le SDK n'est fait que pour
l'API facturée » est infondée — plusieurs structures existent **spécifiquement** pour les comptes
claude.ai.

### Trois sources vérifiées

**1. `SDKRateLimitEvent` — poussé, temps réel, sans requête supplémentaire**

Type `rate_limit_event`, émis quand l'info change. Charge utile réellement reçue en test :

```json
{"type":"rate_limit_event",
 "rate_limit_info":{"status":"allowed","resetsAt":1784714400,
   "rateLimitType":"five_hour","overageStatus":"rejected",
   "overageDisabledReason":"org_level_disabled_until","isUsingOverage":false},
 "session_id":"..."}
```

`resetsAt` = epoch secondes (ici : 2026-07-22 12:00:00). Champs du type `SDKRateLimitInfo` :
`status` (`allowed` | `allowed_warning` | `rejected`), `resetsAt`, `rateLimitType` (`five_hour` |
`seven_day` | `seven_day_opus` | `seven_day_sonnet` | `overage`…), `utilization`, `overageStatus`,
`isUsingOverage`, `surpassedThreshold`.

`⚠` `utilization` est **optionnel** et **était absent** de l'événement réellement reçu (compte peu
sollicité au moment du test). Ne pas bâtir l'affichage du pourcentage sur ce seul champ.

**2. `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` — tiré, avec pourcentages**

Méthode sur `Query`. Retourne les données derrière la commande `/usage` : coût de session, tokens, et
`rate_limits` par fenêtre avec **`utilization` en 0-100** et `resets_at` en ISO 8601. Fenêtres :
`five_hour`, `seven_day`, `seven_day_oauth_apps`, `seven_day_opus`, `seven_day_sonnet`.

`⚠ ALPHA` — le nom de la méthode annonce lui-même l'instabilité. **À isoler derrière une couche
d'adaptation**, conformément à la règle générale du paquet. C'est la seule source fiable du
**pourcentage**, donc de ce qui est réellement demandé.

**3. `accountInfo()` — identité du compte d'une session**

Retourne `email`, `organization`, `subscriptionType`, `apiProvider`. Permet de **confirmer** sous quel
compte un worker tourne réellement, au lieu de le déduire du `CLAUDE_CONFIG_DIR` passé.

`⚠` Le message `init` porte aussi `subscription_type` / `rate_limits_available` / `rate_limits`, mais
en test ces champs sont revenus `null` sur ce binaire. **Ne pas s'appuyer sur l'init** — utiliser
`rate_limit_event` (poussé) et la méthode `usage` (tirée).

### Ce que ça permet dans l'UI

Par compte : type de fenêtre active, statut, date de reset, et pourcentage via la méthode `usage`.
C'est exactement l'analogue du dashboard quotas Cerebras déjà en place (`agent/usage.py`), mais avec
des données **poussées** par le SDK plutôt qu'un snapshot passif — le bug du snapshot figé rencontré
côté Cerebras (mémoire `ccremote`, fix `_effective_quotas()`) **ne se reproduit pas ici**, puisque
`resetsAt` est fourni et qu'un événement est émis à chaque changement.

Priorité : basse (cosmétique), mais la **collecte** doit être branchée tôt — c'est elle qui alimente
la décision de rotation de H-53, qui, elle, n'est pas cosmétique.

---

## H-56 `[TRANCHÉE]` `[I]` — V1 : une seule mission active par projet

**Décision opérateur explicite.** La v1 ne vise pas plusieurs équipes en parallèle sur un même
dépôt. Le critère de réussite est que **la chaîne complète fonctionne de bout en bout**, pas qu'elle
passe à l'échelle. Le parallélisme multi-missions sur un même projet est un upgrade ultérieur, qui
devra être testé en conséquence.

### Ce que ça simplifie immédiatement

| Élément | Statut en v1 |
|---|---|
| **F2.4 / branche H.1 — mission d'intégration** | **Sans objet.** Une seule branche par projet à la fois ⇒ aucune fusion multi-branches à arbitrer. La question « posture (a), (b) ou (c) » **ne se pose plus en v1** |
| **M-62** (mission d'intégration) | **Reporté.** Sort du périmètre v1 |
| F2.1.3 — vérification de disjonction des périmètres | Sans objet (rien à paralléliser sur un même projet) |
| H.1.4 — frontière conflit textuel / sémantique | Reporté avec M-62. Le risque résiduel principal de l'architecture (H.1.1) **disparaît de la v1** |
| F2.1.4 — notion de lot | Conservée, mais dégénérée : un lot = une mission. Garder la structure de données, elle sert au parallélisme futur |

**Reste vrai et inchangé** : plusieurs missions en parallèle sur **des projets différents**. C'est le
cœur du harness (N1) et ce n'est pas touché par cette décision.

`⚠` **À ne pas confondre** : « une mission active par projet » ≠ « une seule mission à la fois ».
Le parc reste multi-projets et concurrent.

### Ce que ça n'autorise pas à retirer

Le **fencing par epoch** (D.2.3, M-11) reste obligatoire. Il ne protège pas contre deux missions
concurrentes voulues — il protège contre **deux workers sur la même mission** après une coupure ou un
redémarrage du Pi. Ce scénario existe toujours en v1. `☠` Le retirer au motif « une seule équipe par
projet » serait un contresens : c'est la panne #2 de la grille de revue, celle qui ne produit
aucune erreur.

### À rouvrir plus tard

Quand le parallélisme multi-missions sur un même projet reviendra : rouvrir F2.4, trancher la posture
d'intégration, implémenter M-62, et tester spécifiquement la distinction conflit textuel / sémantique
sur un cas réel (repli documenté : escalader tout conflit non trivial).

---

## H-57 `[TRANCHÉE]` `[I]` — Deux boutons distincts : PAUSE GLOBALE et ARRÊT D'URGENCE

**Demande opérateur** : « un bouton genre power off, pas pour éteindre le PC, mais pour mettre en
pause absolument tout d'un seul coup, en cas de danger ou de surcharge, histoire de toujours avoir
une main dessus. »

`☠ CASSE` — G.4 spécifiait **un seul** mécanisme, dont la séquence finit par `close()`. Ce n'est
**pas** ce qui est demandé. Un bouton unique qui coupe les sessions quand l'opérateur voulait juste
reprendre la main détruit le contexte de N missions pour rien. Les deux besoins sont distincts et
doivent être **deux commandes séparées, deux boutons séparés, visuellement distincts**.

| | **PAUSE GLOBALE** (le besoin exprimé) | **ARRÊT D'URGENCE** (G.4 d'origine) |
|---|---|---|
| Intention | reprendre la main, réfléchir, reprendre | tout stopper, quelque chose déraille |
| Séquence | marquer `en_pause` **puis** `interrupt()` sur chaque worker, retenir les files d'entrée | pause globale **puis** `close()` propre, `kill` en dernier recours |
| Sessions | **vivantes** | fermées (`resume` possible mais nouveau process) |
| Contexte des missions | **préservé intégralement** | préservé sur disque, à recharger |
| Reprise | instantanée, lever le drapeau et relâcher les files | redispatch / `resume` |
| Usage attendu | **fréquent** — c'est un frein, pas un extincteur | rare |

**La pause globale est la primitive**, l'arrêt d'urgence l'appelle d'abord puis va plus loin.

### Règles communes, non négociables

- `☠` **Ne passent ni l'une ni l'autre par l'orchestrateur** (G.4.1 inchangé). Si l'orchestrateur
  déraille, sature ou boucle, c'est exactement le moment où le bouton doit marcher. Chemin direct
  téléphone → control plane → canal de contrôle (D.3) → superviseur.
- **Ne détruisent aucun travail non commité.** Worktrees intacts (F.2.3).
- Idempotentes, rejouables sans effet double (D.3.2). Appuyer deux fois n'aggrave rien.
- `☠` **Testées régulièrement, pas une fois à l'installation** (G.4.3). Un bouton d'urgence non
  déclenché depuis six mois a une probabilité élevée d'être cassé.

### Ce que la pause ne fait PAS — à afficher dans l'UI

`⚠` Honnêteté nécessaire, sinon le bouton donne une fausse sécurité :

- `interrupt()` avorte **le tour en cours**, y compris les outils en vol.
- Il **n'arrête pas** les processus enfants que l'agent a lui-même lancés en arrière-plan (serveur de
  dev, build, watcher). Ceux-là survivent à la pause. Les tuer relève du superviseur, et **ce n'est
  pas dans le périmètre de la pause** — le signaler dans l'UI plutôt que de le laisser croire.
- Les caveats du reçu d'interruption de B.4 s'appliquent intégralement : lire
  `still_queued` **avant** le `SDKResultMessage`, ignorer les UUID inconnus, ne pas renvoyer au
  redémarrage un message qui y figure (sinon tour dupliqué).

### Limite structurelle à assumer

`☠` Si le lien Pi↔PC est coupé, **aucun des deux boutons n'atteint les workers.** C'est inhérent :
le contrôle passe par le transport. Deux conséquences :

1. L'UI doit montrer **l'état du lien**, pas seulement l'état des missions. Un bouton grisé et
   expliqué vaut mieux qu'un bouton qui semble avoir marché.
2. Recours local sur le PC (arrêt du service superviseur) documenté comme **procédure manuelle de
   dernier ressort**. À ne pas automatiser : un dead-man's switch qui tuerait les missions à chaque
   micro-coupure réseau détruirait du travail légitime, exactement ce que D.2.1 demande d'absorber
   en silence.

---

## H-58 `[TRANCHÉE]` `[R]` — Plafond de parc : implémenté, désactivé par défaut

**Décision opérateur** : sur comptes perso à abonnement mensuel, un plafond en dollars n'a pas de
sens — il n'y a pas de facturation à l'usage à borner. Le vrai frein est H-57.

- `maxBudgetUsd` **par mission** (G.1.1) : **conservé**. Ce n'est pas un instrument de facturation
  mais un **anti-boucle** — il coupe une mission qui tourne en rond, ce qui reste utile même sans
  coût marginal. Valeur par défaut généreuse.
- Plafond de parc agrégé (G.1.3) : **codé, sans seuil par défaut** (désactivé). L'infrastructure
  existe, l'opérateur pose un chiffre le jour où le contexte change (compte API facturé, usage
  client, machine partagée).
- **Le vrai bornage en v1 est le rate limit du compte**, pas le dollar. D'où l'importance de H-54 :
  c'est la jauge qui compte réellement, et elle est native.

`☠` Rappel de G.1.4, toujours valable : `CLAUDE_CODE_RETRY_WATCHDOG=1` retente **indéfiniment** les
erreurs de capacité. Sans budget actif, c'est une dépense non bornée — sur abonnement, c'est surtout
une **consommation de quota non bornée**, qui sature le compte pendant la nuit. Les deux vont
ensemble ou aucun. Avec le plafond de parc désactivé, `maxBudgetUsd` par mission devient le seul
garde-fou restant : **ne pas le désactiver aussi.**

---

## H-59 `[TRANCHÉE]` `[R]` — Notifications : Web Push, avec Discord en filet

Contrainte posée par l'opérateur : c'est une **web app** servie depuis son domaine sur le Pi
(`ccremote.exemple.com`, Cloudflare Tunnel). Pas d'app native, donc pas d'APNs direct.
Choix laissé à l'implémentation.

### Retenu : Web Push (VAPID) en primaire

Motifs : standard W3C, pas de dépendance à un service tiers propriétaire, fonctionne app fermée,
HTTPS déjà en place. **Bon pour la souveraineté** : les charges utiles Web Push sont chiffrées de bout
en bout (`aes128gcm`) — le service de push relaie sans pouvoir lire. Le contenu du résumé de demande
(C.4.2) ne fuite pas.

`⚠ CONTRAINTE iOS, vérifiée et structurante` — l'opérateur est sur iPhone (Safari iOS, confirmé lors
du fix `100dvh`). Sur iOS, Web Push exige **iOS 16.4+ ET que le site soit ajouté à l'écran d'accueil
comme PWA**. Une page ouverte dans Safari **ne reçoit rien**. Conséquences :

- Il faut un manifeste PWA + service worker (la SPA actuelle n'en a pas). **À produire.**
- L'ajout à l'écran d'accueil est une **action manuelle de l'opérateur**, à faire une fois.
  **Accepté explicitement par l'opérateur (2026-07-22)** : « je suis sur iPhone donc je devrais
  pouvoir mettre l'app sur mon bureau. » La contrainte est levée côté décision, elle reste une
  **étape d'installation à documenter** dans le README.
- Si la PWA est désinstallée, les notifications s'arrêtent **silencieusement**. L'UI doit afficher
  l'état de l'abonnement push, pas le supposer. C'est ce mode de panne muet qui justifie le filet
  Discord ci-dessous.

### Filet : Discord

`discord-control` est déjà en place et opérationnel (MCP actif toutes sessions). Un DM sur escalade
critique donne une notification mobile native, sans contrainte PWA, téléphone verrouillé.

Motif de la redondance : avec H-40, une escalade est **rare mais importante** — c'est le seul moment
où une mission est réellement bloquée en attente. Un canal unique avec des modes de panne silencieux
(PWA désinstallée, permission révoquée par iOS) n'est pas suffisant pour ce signal-là.

`⚠ HYP` — Discord en **complément sur escalade uniquement**, pas en doublon systématique de tout.
Sinon les deux canaux deviennent du bruit et l'opérateur les coupe tous les deux.

### Règles de C.4.4, inchangées et applicables aux deux canaux

Déclenchées par la **transition** vers `requires_action`, jamais par sondage · groupées (dix demandes
d'une même mission = une notification) · rappel si `[en_attente]` dépasse un seuil · **silencieuses
pour ce que le lead a résolu seul**, sinon H-40 ne sert à rien.

---

## H-55 `[OUVERTE]` — Conteneurisation des team leaders (G.3)

Pas demandée par défaut. L'opérateur n'exclut pas l'option si le risque le justifie plus tard.
**Confirme la posture déjà actée en G.3** : évaluer le coût de friction sur cas réel avant d'adopter,
ne pas conteneuriser préventivement. Contrainte à respecter si un jour retenue : rester compatible
avec l'authentification OAuth locale du compte Claude Code (pas de conteneur qui casse l'accès aux
credentials du poste).

---

## Confiance déclarée par l'opérateur

Plusieurs semaines d'usage quotidien (dev, modding GTA, autres) sans casse : chaque fois qu'il y avait
un risque réel, l'agent s'est abstenu et a demandé plutôt que d'agir. Fondement explicite de H-41 (le
lead peut tout faire, plancher limité à l'irréversible) — la confiance porte sur le jugement exercé
dans le system prompt, pas sur une supervision de règles étendue.
