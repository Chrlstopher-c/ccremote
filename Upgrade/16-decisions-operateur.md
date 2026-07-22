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

## H-60 `[CORRECTION DE SPEC]` `[I]` — A.1.3 ne couvrait qu'un sens sur deux

**Remontée par l'agent M-02 en cours d'exécution (2026-07-22), retenue comme correction.**

A.1.3 formule le risque uniquement côté **producteur** : « le générateur d'entrée doit rester ouvert,
ne pas le fermer pendant que Claude travaille ». C'est incomplet.

Le SDK est le **consommateur** du flux. Si sa boucle interne fait un `break` ou propage une exception,
il appelle `return()` / `throw()` sur l'itérateur — **et le flux meurt sans que le harness ait rien
fait de mal.** Le symptôme est identique (`canUseTool` et les hooks cessent d'être appelés, le reste
continue), mais la cause est hors de portée de la règle telle qu'elle était écrite. Aucune ligne du
paquet ne couvrait ce sens.

**Conséquence retenue** : ne pas se contenter de « ne pas fermer ». L'itérateur est implémenté à la
main (`next`/`return`/`throw`) plutôt qu'en `async function*`, précisément pour **intercepter** la
fermeture venue du consommateur. Trois états distincts : `ouvert` / `ferme` (explicite, légitime) /
`ferme_implicitement` (subie, anormale).

`☠` **On ne peut pas empêcher un consommateur de partir. On peut refuser que ça reste muet.** Une
fermeture non sollicitée déclenche un log `error` et un rappel `surFermetureImprevue`. C'est ce qui
transforme la panne #1 de la grille — silencieuse par nature — en panne bruyante.

**À répercuter** : la mission M-41 (session orchestrateur) doit brancher `surFermetureImprevue` sur
une alarme réelle, pas l'ignorer. Sans ça, l'instrumentation existe mais ne sert à rien.

---

## H-61 `[TRANCHÉE]` `[I]` — Le goulot humain est au DISPATCH, pas aux permissions d'outils

**Précision majeure de l'opérateur (2026-07-22), qui ne contredit pas H-40 mais en déplace le point
d'application.** Les deux règles cohabitent et il faut les tenir ensemble :

| Niveau | Qui décide | Règle |
|---|---|---|
| **Créer une équipe / dispatcher une mission** | **L'humain, explicitement** | H-61 — l'orchestrateur maître **ne peut jamais** lancer une équipe de sa propre initiative. Il propose, l'opérateur clique. |
| Permissions d'outils **à l'intérieur** d'une mission | Le lead (`permissionMode: 'auto'`) | H-40 — inchangé. L'opérateur n'arbitre pas les invites d'outils. |

Formulation opérateur : « à partir du moment où l'orchestrateur master crée une team, ou envoie un
team leader le faire, ça doit nous demander une autorisation. Il ne faut pas qu'il puisse le faire
automatiquement sans qu'on clique dessus. »

**Pourquoi c'est cohérent et non contradictoire** : une mission est coûteuse, longue et modifie du
code ; une invite d'outil est fréquente et locale. Mettre l'humain sur la seconde le noie et le rend
inutile sur la première. **Un seul point de contrôle humain, placé là où la décision est
structurante.**

`☠ CASSE` — un orchestrateur qui dispatche seul retire le dernier point de contrôle humain du
système. Avec H-40 (le lead arbitre ses propres outils) et H-41 (le lead peut tout faire), le
dispatch **est** le garde-fou. Une mission d'implémentation qui rend le dispatch automatique
« pour fluidifier » doit être refusée.

**Conséquence sur A.2.2** : l'outil `creer_equipe` ne crée rien directement. Il retourne
`effet: 'differe'` avec une **proposition de mandat** que l'UI présente à l'approbation. La création
effective part du clic de l'opérateur, pas du tour de l'orchestrateur.

`⊣ HORS-PÉRIMÈTRE — futur` : les sessions planifiées (« toutes les nuits, vérifier tel projet »)
exigeront une autorisation pré-accordée par récurrence. Explicitement écarté du périmètre actuel par
l'opérateur. **Ne pas concevoir pour ça maintenant**, mais ne pas non plus rendre l'approbation
impossible à automatiser plus tard : le point d'approbation doit être une **fonction identifiable**,
pas du code fondu dans un gestionnaire de clic.

---

## H-62 `[TRANCHÉE]` `[I]` — L'orchestrateur maître : ce qu'il doit être

Formulation opérateur : « c'est notre bras droit, il doit être absolument irréprochable. »

C'est **la** conversation dans l'app — celle avec qui Chris parle. Exigences :

- **Modèle Opus par défaut** (confirme H-23).
- **Autonome sur son propre contexte.** Autocompaction en cas de surcharge, réflexe de garder
  l'essentiel, de prendre des notes. L'opérateur **ne doit pas avoir besoin** de compacter à la main.
- **Mais le bouton de compaction manuelle existe quand même** — « on doit pouvoir », pas « on doit
  devoir ». Disponible sans être nécessaire.
- Jamais bloquant (invariant de `03` inchangé), jamais de flux brut dans son contexte (H-45).

**Prise de notes** : le réflexe de consigner ce qui doit survivre à une compaction est une exigence
de comportement, à porter dans son prompt système — pas une fonctionnalité à coder. Le support existe
déjà (registre, lots, mandats).

---

## H-63 `[TRANCHÉE]` `[R]` — Trois jauges temps réel, dont une nouvelle

L'UI doit afficher en permanence, pour la session de l'orchestrateur maître :

1. **Contexte utilisé** — via `getContextUsage()` (E.4.1). Mesuré, jamais estimé.
2. **Fin de la fenêtre de rate limit** — `resetsAt` de `rate_limit_info` (H-54).
3. **Dollars consommés dans la fenêtre de rate limit courante** — `[NOUVEAU]`.

Le troisième point est une demande explicite de l'opérateur, et son raisonnement est juste :

> « la fenêtre est partagée par toutes les instances à partir du moment où elles fonctionnent sur le
> même compte. Si j'ai 400 $ pour une fenêtre de 5 h et qu'on est sur un modèle Sonnet, c'est possible
> qu'on soit à la limite dans pas longtemps. Je pourrai, en fonction de ces informations, gérer la
> suite. »

**Ce que ça impose** : le coût doit être agrégé **par compte et par fenêtre de rate limit**, pas par
mission. Toutes les missions tournant sur un même compte partagent le même plafond — une jauge par
mission ne dit rien du risque réel de saturation.

Source : `total_cost_usd` / `modelUsage` des `SDKResultMessage`, sommés sur toutes les missions du
compte depuis le début de la fenêtre courante, la fenêtre étant délimitée par `resetsAt`.

`⚠` `total_cost_usd` est une **estimation côté client** (E.4.2). C'est un instrument de pilotage, pas
une facture. L'afficher comme tel — un ordre de grandeur qui aide à décider, pas un montant exact.

`☠` Remise à zéro de l'agrégat au franchissement de `resetsAt`, **jamais** au redémarrage d'un
process. Une jauge qui repart de zéro parce qu'un service a redémarré ment sur la consommation réelle
de la fenêtre — c'est exactement le bug déjà vécu sur les quotas Cerebras (snapshot vidé au restart).

---

## H-64 `[CORRECTION UI]` `[I]` — Les permissions se lisent dans le fil de la mission

**Défaut constaté par l'opérateur sur la maquette v2** : elle présentait une **file d'escalade** comme
surface principale d'arbitrage. C'est en contradiction avec H-40 — l'opérateur n'arbitre pas les
permissions d'outils, le lead le fait.

Formulation opérateur : « c'est le leader qui gère et c'est en aucun cas l'utilisateur. C'est toujours
bien de logger absolument toutes les autorisations qui ont été faites, même si ça peut spammer à
force, mais il faudrait plutôt les logger quand on affiche la discussion en question et qu'on voit
correctement ce qui se passe en temps réel. »

**Modèle retenu** :

| Surface | Contenu | Nature |
|---|---|---|
| **Fil de la mission** | **toutes** les autorisations, y compris auto-résolues par le lead, en flux temps réel, au milieu de l'activité | observation — c'est le chemin normal |
| **Vue escalade** | uniquement ce que le classifieur a **refusé** et qui remonte vraiment | action — rare, doit rester rare |

`☠` Le volume assumé (« ça peut spammer ») est **voulu** : c'est la trace d'audit de C.5.2, celle qui
répond à « le classifieur a-t-il autorisé quelque chose que je n'aurais pas autorisé ». La déplacer
hors du fil la rendrait invisible en pratique. Prévoir un **filtre** dans le fil, pas une vue séparée.

Source technique : hook `PreToolUse` pour l'exhaustivité (C.1.1) — `canUseTool` ne voit que l'étage
d'invite et donnerait une fausse impression de couverture.

---

## H-65 `[EXIGENCE DE LIVRABLE]` — Une maquette se navigue, sinon elle ne prouve rien

**Retour direct de l'opérateur sur la v1 de la maquette** : direction artistique jugée juste et
fidèle, mais « je ne peux interagir avec rien », « je ne peux pas cliquer sur les discussions », le
bouton de coupure du lien Pi « ne fait rien du tout ». Verdict : « c'est plus une vitrine qu'autre
chose ».

**Règle pour tout livrable de maquette sur ce projet** : une maquette statique ne permet pas de juger
un produit dont l'essentiel est le **comportement dans le temps** — flux temps réel, transitions
d'état, coupure de lien, arrivée d'une demande d'approbation.

Exigence : navigation réelle entre les vues, ouverture d'une mission et de son fil, simulation
déclenchable des événements qui comptent (perte du lien, mission qui passe en `requires_action`,
autorisation loggée en direct, saturation de quota). Données fictives, **comportement réel**.

Ce n'est pas une demande de production : c'est ce qui distingue une maquette évaluable d'une image.

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

---

## H-66 `[TRANCHÉE]` `[I]` — Attribution de l'émetteur : un lead sait toujours qui lui parle

**La décision la plus importante de cette série, parce qu'elle porte sur la véracité de ce que
croient les agents.**

### L'interdit

`☠ CASSE` Formulation opérateur : « c'est hors de question de voir dans des transcripts ou dans des
chats "alors Chris m'a demandé de faire ça", alors qu'en fait ce n'est pas moi du tout et je ne
savais même pas que la session existait. »

Un lead qui attribue à l'opérateur une instruction venue de l'orchestrateur **corrompt le transcript**
— et le transcript est la trace d'audit. Le défaut est silencieux par nature : rien ne plante, le
travail avance, et une décision que **personne d'humain n'a prise** se retrouve justifiée par
« l'utilisateur l'a demandé ». Tout raisonnement bâti dessus est faux, y compris celui d'un autre
agent qui relira le transcript plus tard.

### La règle

**Tout message entrant dans une session d'équipe porte son émetteur, explicitement et de façon non
ambiguë.** Deux origines, jamais confondues :

| Émetteur | Nature | Ce que le lead doit en faire |
|---|---|---|
| `orchestrateur` | dispatch, relance, instruction, arrêt — le chemin **normal** | l'autorité qui l'a mandaté |
| `operateur` (Chris) | intervention **directe** de l'humain, hors chaîne | prime sur l'orchestrateur ; c'est la voix de l'opérateur lui-même |

Véhicule : un préfixe **structurel** dans le message — pas une convention de rédaction, le modèle
doit le voir dans tous les cas — plus le champ correspondant dans le registre et le transcript.

`⚠` Ne jamais laisser un agent **déduire** l'émetteur du ton ou du contenu. C'est exactement le genre
d'inférence qui produit l'erreur qu'on cherche à interdire.

### Ce que le mandat doit dire au lead (complète H-52)

Le system prompt du lead l'informe de trois faits sur sa propre situation :

1. Il est **une équipe parmi d'autres**, parfois en parallèle, toutes dirigées par le même
   orchestrateur maître.
2. Ses instructions viennent **normalement de l'orchestrateur**, pas de l'humain.
3. L'**opérateur peut lui parler directement**, et ces messages-là sont identifiés comme tels.

Sans le point 1, un lead peut se croire seul et raisonner faux sur l'état du dépôt. Sans les points 2
et 3, il ne peut pas pondérer une instruction contradictoire.

---

## H-67 `[TRANCHÉE]` `[R]` — Sidebar arborescente et messages en file

### Arborescence

La sidebar présente le **chat principal** (l'orchestrateur maître) et, **en sous-niveau**, les
sessions d'équipes qu'il pilote actuellement. L'arborescence rend visible ce qui est autrement
abstrait : ces sessions **existent parce que** l'orchestrateur les a dispatchées.

Cliquer sur une équipe ouvre son fil (H-64) et permet de lui **écrire directement** (message marqué
`operateur`, H-66).

`⚠ HYP` — arborescence à **deux niveaux**. Les sous-agents d'une équipe apparaissent dans son **fil**
(arbre d'exécution, E.2.2), pas dans la sidebar : ils sont nombreux, éphémères, et les y remonter
noierait la navigation.

### Messages en file — comportement calqué sur Claude Code

Formulation opérateur : « faire un peu comme Claude Code le permet — lancer une tâche et derrière
renvoyer un message, et dès que l'agent est disponible, il lit le message et il répond. »

Écrire à une équipe occupée **ne l'interrompt pas**. Le message est mis en file et lu au tour suivant.
Déjà supporté : le générateur d'entrée persistant (M-02) est précisément la pièce qui le permet.

`☠` Ne **pas** confondre avec `interrupt()` (B.4). Écrire = mettre en file. Interrompre = un geste
distinct et explicite. Une UI qui interrompt sur simple envoi de message rend impossible le cas
d'usage demandé.

`⚠` L'UI doit montrer qu'un message est **en attente de lecture** plutôt que délivré — sinon
l'opérateur croit l'équipe sourde et le renvoie. Les messages en file survivent à une interruption
(`still_queued`, B.4) : ne pas les rejouer au redémarrage, ça produirait un tour dupliqué.
