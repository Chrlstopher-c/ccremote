# STATE — ccremote
*Dernière mise à jour : 2026-08-03*

## ⚡ Chantier en cours — harness d'orchestration (depuis le 2026-07-22)

**Point d'entrée pour reprendre : `harness/REPRISE.md`.** Ne pas repartir de ce STATE pour le
détail du harness — REPRISE.md est plus précis.

**État au 03/08 (matinée)** : **1441 tests / 1441 verts**, typecheck propre, schéma du registre en
**version 23**. **TOUT EST DÉPLOYÉ ET VÉRIFIÉ COMME TEL** — le déploiement compare désormais
l'heure de démarrage du process au mtime des sources et échoue s'il sert du code périmé.

### `☠` 03/08 — LE CORRECTIF ÉTAIT SUR LE DISQUE, LE PROCESS TOURNAIT CELUI DE LA VEILLE

Le test des sous-agents en arrière-plan, armé le 02/08 au soir, a échoué au réveil exactement
comme le bug qu'il devait valider : notification à T+1 min, trois mots sur cinq. Il n'a rien
testé — le superviseur du VPS tournait **depuis le 01/08 16:25 UTC (`NRestarts=0`)** alors que le
correctif était sur son disque **depuis le 02/08 18:38**. Le rsync avait livré, le service n'avait
jamais redémarré.

Cause : `deploy-superviseur-vps.sh` faisait `systemctl --user enable --now`. **`--now` DÉMARRE un
service arrêté, il ne redémarre pas un service actif.** Deux moitiés d'un même système, une seule
mise à jour — le pitfall n°3 de `session-awareness.md`, à la lettre.

Ce qui le rend impossible à refaire : le déploiement fait un `restart` explicite, PUIS compare
`ExecMainStartTimestamp` au mtime le plus récent des sources (`find -newermt`). Une seule source
plus récente que le process ⇒ le déploiement **échoue bruyamment**. Vérifié dans les deux sens : un
`touch` sur un fichier suffit à faire sortir le contrôle en rouge.

`☠` **La leçon dépasse ce script** : « les fichiers sont à jour » et « le process exécute ces
fichiers » sont deux faits distincts, et seul le second compte. Aucun déploiement ne doit se
déclarer réussi sans avoir mesuré le second.

### `☠` 03/08 — LE TEST, REFAIT ET VERT

Deux exécutions réelles sur `/mnt/projects/bac-a-sable`, code corrigé chargé :

| Mesure | Attendu | Mesuré (5 sous-agents) | Mesuré (3 sous-agents) |
|---|---|---|---|
| Mots cités dans la synthèse | tous | 5/5 | 3/3 |
| Notifications de fin | UNE, à la vraie fin | 1, à T+10 min | 1, à T+2 min |
| Affichage pendant l'attente | jamais « au repos » | `en_cours`/`running` | idem, 4 relevés |
| Coût / plafond | sous plafond | 0,84 $ / 5 $ | 0,98 $ / 3 $ |

À comparer au run du matin sur la même infrastructure : notification à T+1 min, 3 mots sur 5.

**Deux parasites du protocole, découverts et neutralisés** — ils ne concernent pas le harness mais
tout mandat qui fait attendre un sous-agent : l'outil Bash **refuse un `sleep` nu** (forme acceptée :
`fin=$(( $(date +%s) + N )); until [ $(date +%s) -ge $fin ]; do sleep 2; done`) et **coupe à 120 s**
sauf `timeout` explicite à l'appel. Sans les deux, les sous-agents partent en `run_in_background` et
rendent « Waiting for background process to complete... » au lieu de leur résultat.

### `☠` 03/08 — LES SOUS-AGENTS ÉTAIENT INVISIBLES DEPUIS LA BASCULE MULTI-MACHINES

Le CLI range les transcripts de sous-agents sous la clé du chemin **réel** ; le harness les
cherchait sous celle du chemin du mandat. Sur le VPS, `/mnt/projects` est un lien vers `~/dev` : la
clé calculée (`-mnt-projects-bac-a-sable`) n'existait sur aucune machine. **Zéro sous-agent remonté,
en silence, depuis le 01/08.** Mesuré : sept transcrits sur le disque, « sous-agents : aucun » à
l'écran pendant dix minutes. Les deux clés sont désormais essayées.

Dans la foulée, deux lacunes que l'orchestrateur a nommées lui-même : `etat_equipe` n'exposait
AUCUN champ sous-agents (« je ne peux pas dire que le harness en voit zéro, je peux dire que mon
outil ne remonte pas l'information » — refus de conclure exemplaire), et le compteur d'actifs
restait figé après la clôture. Le total est conservé, les actifs sont **dérivés** de l'état de
l'équipe — la règle du 02/08, appliquée à un second champ.

### Les cinq autres défauts fermés le 03/08

| Défaut | Ce qui se passait | Ce qui a changé |
|---|---|---|
| Plafond de dépense | `definir_budget` n'existe qu'après démarrage : une mission d'une minute finit avant tout réveil | `creer_equipe` accepte `budgetMaxUsd`, posé au mandat |
| Mandat remplacé | aucun moyen de le retirer ; `arreter_equipe` sur un id de proposition répondait « mission introuvable », lu comme une suppression — c'est ce mandat-là qui a été autorisé le lendemain, sur le mauvais projet | `retirer_mandat` (23ᵉ outil), et le refus nomme la bonne cause |
| `arreter_equipe` | marquait `annulee` une équipe qui avait rendu son rapport — or la notification de fin ORDONNE de l'appeler. 43 missions « annulées » au registre, la plupart réussies | un état terminal est conservé ; seule une équipe vivante est annulée |
| `rechercher_projets` | `rg` absent du VPS et du Pi ⇒ `occurrences: []` + une note, qui se lit « rien trouvé » | ripgrep installé, repli `grep`, et un échec porte un drapeau `echec` |
| `lister_projets` | « aucun projet valide » quand `explorer_projets` voyait trois dépôts | dit QUEL registre est vide et renvoie vers `explorer_projets` |

### `☠` 02/08 (soir) — « TERMINÉE » ALORS QUE TROIS SOUS-AGENTS TRAVAILLAIENT ENCORE

Le motif le plus cher de la journée, et le plus instructif : **un message du SDK dont on avait
détourné le sens.**

Un lead lance quatre sous-agents en arrière-plan et rend la main. Le harness sait déjà ne pas
conclure sur ce `result`-là — il compte les tâches de fond annoncées par `background_tasks_changed`,
et la garde a tenu (journal du VPS, 16:34:14, quatre tâches vues). Mais le collecteur remettait ce
compteur à zéro sur chaque message `init`, en croyant qu'un `init` signale le (re)démarrage du
process CLI. **Le SDK en émet un à CHAQUE REPRISE DE TOUR**, notamment juste après la notification
d'un sous-agent terminé. Le premier agent notifie à 16:37:48 → l'`init` de reprise efface les trois
autres → le `result` de 16:37:51 passe pour une fin de mission. À 16:37:53, les trois derniers
sous-agents rendaient leur travail dans une session déjà close : leurs notifications sont dans le
transcript, enfilées, jamais livrées. Mission `ab7183f0`, **7,72 $ perdus**.

Deux équipes sur six touchées ce jour-là (`ab7183f0` 7,72 $ et la vague 2 de Plume 14,02 $) — ce
sont exactement les deux qui ont lancé des sous-agents en arrière-plan, et les deux seules dont le
transcript se termine sur des notifications en attente. L'orchestrateur en annonçait trois : sa
comptabilité était fausse, comme son diagnostic.

**Ce que ça a corrigé, au-delà de la mort prématurée** — le même défaut alimentait trois symptômes
qu'on croyait distincts : la notification « équipe terminée » envoyée à l'orchestrateur alors que
l'équipe travaillait, l'affichage « au repos » dans le Parc, et la clôture automatique qui fermait
le projet quinze minutes plus tard. Tous trois découlaient de `etatSdk = 'idle'` posé au `result`.

Trois règles qui en sortent, valables bien au-delà de ce fichier :

1. **Un événement de cycle de vie appartient à celui qui le PROVOQUE.** La remise à zéro est
   désormais dite par le superviseur (`ouvrir`, `reinitialiserTachesFond` appelé par `relancer`),
   jamais déduite d'un message du flux dont ce n'est pas le sens.
2. **« A fini de parler » n'est pas « a fini ».** `etatSdk` est maintenant DÉRIVÉ à la lecture
   (`etatSdkEffectif`), une seule source. Deux écritures indépendantes du même champ finissent
   toujours par diverger — c'est exactement comme ça que la panne est née.
3. **Ne pas troquer une panne contre son opposé.** Une borne de patience de 20 min empêche un
   `bun run dev` détaché de rendre une équipe immortelle, projet verrouillé à vie.

`☠` **Le diagnostic de l'orchestrateur était faux, et il allait l'écrire dans ses mandats.** Il
avait conclu que le piège était « le réflexe des leads à déléguer en arrière-plan puis rendre la
main » et prévoyait d'interdire le mécanisme. Le mécanisme n'était pas fautif : le compteur l'était.
Ses trois derniers mandats portaient une clause d'interdiction — elle a été retirée après
confrontation aux journaux. Il garde l'interdiction de l'ATTENTE PASSIVE, ce qui est le bon
arbitrage. Une inférence plausible posée comme une cause établie, sans accès à l'artefact qui
l'aurait réfutée : c'est la même famille d'erreur que l'anti-narratif de `session-awareness.md`,
mais commise par un agent du système plutôt que par le harness lui-même.

### `☠` 02/08 — LES SIX OUTILS SUR LESQUELS L'ORCHESTRATEUR NE POUVAIT PAS COMPTER

Journée entièrement consacrée à un seul motif : **un outil qui répond autre chose que ce qui s'est
réellement passé**. L'orchestrateur en a dressé la liste lui-même, après une session où il a vu ses
équipes déraper sans pouvoir leur parler. Détail complet et mesures dans `TODO.md`.

| Outil | Ce qu'il répondait | Ce qui se passait vraiment |
|---|---|---|
| `envoyer_a_equipe` | « équipe introuvable ou plus vivante » | port jamais câblé — refus CONSTANT |
| `interrompre_equipe` | idem | idem |
| `creer_equipe` | « équipe lancée » | dispatch en `void`, parfois échoué |
| `definir_budget` | « plafond fixé » | valeur écrite, comparée à rien |
| `relancer_equipe` | « relance transmise » | worker déjà vivant, aucun effet |
| `arreter_equipe` | « libération en cours » | machine déjà confirmée, projet libre |

Deux causes racines, à retenir au-delà de ces six cas :

1. **Un port satisfait par une implémentation qui refuse tout** passe tous les tests d'unité et ne
   se voit qu'en assemblage. C'est la 12ᵉ occurrence de « écrit, testé, branché sur rien » — et la
   première où le refus était *honnête* mais *mal nommé* : « introuvable ou plus vivante » a fait
   conclure à l'orchestrateur que ses équipes étaient mortes.
2. **Un choix implicite non écrit devient une panne dès que le contexte change.** Un fil ouvert
   PC éteint n'avait pas de machine ; le routage tranchait seul, jusqu'à l'allumage du PC. Ce qui
   marchait le matin ne marchait plus l'après-midi, sans qu'aucune action ne l'explique.

Ajouté au passage, parce que c'est le fait qui manquait le plus : le harness relève désormais
l'**état git** du dépôt d'une équipe quand elle rend la main (migration 23). « Terminée » ne veut
plus dire « a fini de parler » — la notification, le Parc et `etat_equipe` distinguent maintenant
*non commité*, *propre*, et *jamais relevé*.

### `☠` DEUX MACHINES DE TRAVAIL SIMULTANÉES — le changement structurant du 01/08

Le lien Pi↔machine ne tenait qu'UN emplacement : toute connexion authentifiée évinçait la
précédente, d'où qu'elle vienne. C'était aussi la cause de la **dette n°6** (1268 évictions au banc
du 22/07), et la raison pour laquelle le PC devait être ÉTEINT pour laisser vivre le VPS.

| Machine | Identité | Rôle | Projets |
|---|---|---|---|
| Pi (`pi.exemple`) | — | Control plane, héberge le lien | — |
| PC de Chris | `trinityarch` | Machine de travail | tous sauf `stockiop` |
| VPS OVH | `vps-e411b5c7` | Machine de travail | `stockiop` (`/mnt/projects` → `~/dev`) |

Chaque machine s'annonce par l'en-tête `x-ccremote-machine` et possède **son propre lien** : le
supersede ne joue plus qu'à identité ÉGALE (deux process d'une même machine — reprise après crash,
voulu). Identité absente ⇒ **4403 terminal**, jamais un nom de repli.

`☠` **ORDRE DE DÉPLOIEMENT NON NÉGOCIABLE** : les MACHINES DE TRAVAIL d'abord, le Pi ensuite. Un Pi
neuf refuse en 4403 tout client qui n'envoie pas encore l'en-tête.

**Preuve mesurée, pas déduite** : `2272d6f2` (trinityarch · vitrail) et `41e06128` (vps · stockiop)
ont eu **3 s d'exécution en parallèle**, de 13:09:15 à 13:09:18. Zéro supersede depuis la bascule.

### `☠` LA MÉMOIRE SÉMANTIQUE EST DISTANTE, ET EN LECTURE SEULE POUR LE HARNESS

Elle vit sur le Pi (`memoire.exemple.com`). **Tout ccremote lit, rien n'écrit** —
orchestrateur compris (décision de Chris, H-66 : la parole d'une équipe n'est pas la sienne).

`☠` Le piège : `resoudreMcpEquipe()` lit le `~/.claude.json` DU POSTE, qui sur le PC est la config
personnelle de Chris avec le jeton COMPLET. Le harness **impose** le point d'accès en lecture depuis
`CCREMOTE_MEMOIRE_URL_LECTURE` / `_JETON_LECTURE` ; sans elles, la mémoire est RETIRÉE de la boîte à
outils plutôt que passée en écriture.

### Autres correctifs du 01/08 (soir)

- **Fausse saturation de compte** : `annonceSaturation` s'appliquait au texte que le modèle produit
  lui-même. L'orchestrateur écrivant « Production readiness bouclée (rate limiting…) » se déclarait
  saturé, sur un compte à 35 %. `/rate limit/i` retiré (motif spéculatif), portée bornée à
  400 caractères, signature machine `cc_cli_limit_message` qui court-circuite.
- **Comptes découverts sur le disque** : `CCREMOTE_PC_COMPTES` figeait la liste au déploiement — un
  compte authentifié plus tard restait inutilisable (pré-vol en échec). Le superviseur scanne
  désormais `~/.claude-comptes` au démarrage.
- **H-44 rendue effective** : le Pi envoyait au VPS les CHEMINS de comptes du PC. Seule l'identité
  traverse, la machine réécrit le chemin.
- **Métriques par machine** : « État du système » affiche une carte par machine (CPU, mémoire,
  disque, GPU, équipes portées), via le lien du harness et non plus un WebSocket LAN propre au PC.
  La température venait de `thermal_zone0` = `acpitz` : **16,8 °C affichés pour un CPU à 72,75 °C**.
- **Pied de sidebar** : il affichait « PC en ligne » EN DUR (`hApplyLinkVisuals(true)` au
  chargement, jamais rebranchée). Il sonde maintenant `/machines` toutes les 10 s.

### Ce qui a changé le 01/08 — le harness devient réellement autonome

La journée du 31/07 avait supprimé les autorisations action par action. Celle du 01/08 supprime
l'attente : le harness peut désormais travailler sans que personne ne regarde.

1. **Le canal asynchrone (migration 14).** Rien ne pouvait parler à l'orchestrateur : sa
   conversation est un aller-retour amorcé par l'opérateur, et la fin d'une équipe n'existait comme
   événement nulle part — `terminee` n'était posé qu'à la mort du worker, par la réconciliation,
   sous le nom « fantôme ». Détection sur la transition `running → idle`, notification persistée
   AVANT toute remise, réveil d'une session endormie seulement sur demande explicite (le quota).
   Page Notifications + badge, clic → le fil d'origine.
2. **L'autonomie de fil (migration 15).** H-61 exigeait un clic par équipe : intenable sur une
   plage de travail. Le PREMIER mandat d'une conversation s'autorise à la main, les SUIVANTS
   partent seuls. Une fenêtre datée (début/fin/objectif) dispense même du premier, et son échéance
   sert de deadline à l'orchestrateur. Plafond de 40 lancements sans clic contre la boucle.
3. **Ses yeux et son carburant.** `suivre_equipe` (10 lignes par défaut, 200 max) — il voyait
   l'état d'une équipe et son rapport de fin, rien entre les deux. `carburant_parc` — il pouvait
   lancer 40 équipes sans savoir qu'il était à 95 % de sa fenêtre 5 h. `rechercher_projets` — il
   pouvait lister et lire, jamais trouver.

4. **Le team leader reçoit enfin son mandat.** `mandate` — le champ qui devient son
   `systemPrompt`, seul survivant de sa compaction — ne portait qu'une ligne d'objectif ; tout le
   cadre vivait dans le premier message, donc s'évaporait sur les mandats longs. Et les
   CLAUSES_FIXES (H-52 validation réelle, H-66 attribution) ne partaient qu'à l'AFFICHAGE de la
   carte d'autorisation, jamais au worker : dixième occurrence du motif « écrit, testé, branché
   sur rien », cette fois sur deux règles H.

`☠` **Réflexes hérités, à ne pas réapprendre :**
- Le déploiement a DEUX moitiés — redémarrer `ccremote-pc` après toute modification du canal, du
  SDK ou des options de worker.
- Le system prompt de l'orchestrateur est une SURFACE À DÉPLOYER : toute capacité ajoutée ou
  retirée à sa surface MCP s'y répercute le même jour, sinon il annonce des outils morts et ignore
  les neufs.
- Éprouver un outil sur le VRAI disque avant de le croire : la recherche a rendu deux défauts que
  ses tests unitaires ne pouvaient pas voir (timeout pris pour une absence de ripgrep ; racine
  entière infouillable, > 2 min).
- Un test d'assemblage part du handler réellement invoqué, jamais de la fonction.
- Ce qui doit rester vrai au tour 50 va dans le `systemPrompt`, jamais dans le premier message :
  les workers compactent, et un premier message ne survit pas.

## Résumé de l'état actuel (app v1, en production)

ccremote est un panneau de contrôle personnel : un serveur websocket tourne sur le PC principal
(TrinityArch, `pc.exemple:8765`) et expose tmux (sessions Claude Code) + métriques système ;
une app FastAPI (`pi-web`) tourne sur un Raspberry Pi et sert une SPA exposée publiquement via
Cloudflare Tunnel (`ccremote.exemple.com`). Un agent IA (Cerebras, tool-calling) pilote
le tout en langage naturel : statut PC, sessions tmux, métriques, comptes Claude Code, extinction.

Design "Anthropic-style" (cream/serif/orange) repris d'un mockup fourni par Chris, entièrement
re-câblé sur le vrai backend (aucune donnée fictive). Mobile-first, streaming SSE, markdown stylisé,
conversations persistantes en localStorage. Déployé et vérifié fonctionnel en prod.

## Ce qui a été fait — session du 2026-07-31 (harness)

Seize commits. Six correctifs le matin (voir `harness/REPRISE.md`), puis deux chantiers de fond.

**Les droits d'une équipe deviennent réels** (`ef2524f`, `a34cfef`) — `shared/acces-mandat.ts`
devient la source unique : `acces` s'énumère (`lecture` | `ecriture`), se valide, et se traduit en
refus d'outils POSÉS sur le worker. Migration 13. Deux défauts distincts fermés du même coup : le
plancher de déni n'était branché sur aucun chemin de production (`?? []` rendait un tableau vide,
donc rien n'interdisait d'écraser `~/.ssh` ou les identifiants OAuth du poste — 9ᵉ « écrit, testé,
branché sur rien »), et `perimetre` était un texte libre qui ne partait que dans le prompt du lead.
Le system prompt de l'orchestrateur apprend ce droit et comment choisir.

**Autonomie totale** (`df0e351`, `b60b371`) — le bus d'escalade est retiré : câblé de bout en bout
(port distant, canal bidirectionnel, machine à états, outils MCP, routes, UI) et structurellement
mort, son unique producteur `canUseTool` n'étant jamais appelé en `permissionMode: 'auto'`. Les
workers passent en `bypassPermissions` (renversement assumé de H-40/H-42, dont le test garde-fou est
réécrit avec son motif), `AskUserQuestion` leur est refusé, et le prompt initial dit au lead qu'il
décide seul et que ses questions vont dans son rapport final.

**La suite de tests redevient un signal** (`0383baa`) — les 31 rouges « préexistants » ne l'étaient
pas : ils codaient en dur le scratchpad d'une session Claude Code disparue et validaient des
répertoires créés à la main dedans. `test-harness/racine-temporaire.ts` : un test crée ce qu'il
valide, sous `os.tmpdir()`. **1039 tests, 0 échec.**

**Vérifié en production, sur artefact** — deux mandats réels sur Vela, `acces=lecture` puis
`acces=ecriture` relus en base ; l'orchestrateur choisit de lui-même, l'annonce, et adapte objectif
et critère d'arrêt au changement de droits.

## Décisions prises

| Décision | Raison | Date |
|----------|--------|------|
| `acces` obligatoire dans `creer_equipe`, deux valeurs | Un droit s'énumère et se valide ; la sortie d'un LLM passée à un exécutable est une entrée utilisateur | 2026-07-31 |
| `Bash` reste ouvert en accès `lecture` | Décision Chris : « lecture seule » borne l'écriture de FICHIERS, pas l'exécution de commandes. Un agent d'exploration travaille au shell — l'en priver le rend infirme, pas sûr. Écrire via `sed -i` reste possible mais jamais ACCIDENTEL, et le plancher couvre le catastrophique | 2026-07-31 |
| Retrait complet du bus d'escalade | Câblé de bout en bout, zéro demande depuis le premier jour (`canUseTool` jamais appelé en mode `auto`). Une catégorie vide affirme une protection inexistante | 2026-07-31 |
| Workers en `bypassPermissions` | Renversement de H-40/H-42. Le mode `auto` était un client silencieux du bus supprimé : un refus du classifieur ne menait plus nulle part et l'équipe aurait attendu un verdict que personne ne peut rendre | 2026-07-31 |
| `AskUserQuestion` refusé à toute équipe | Exception C.1.2 atteignant `canUseTool` même sous une règle d'allow. Personne ne lit le flux d'une équipe qui travaille — le lead y perdait un tour | 2026-07-31 |
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

### `☠` Mise à jour automatique d'une interface — jamais le DOM complet (23/07)

Toute vue qui se rafraîchit seule ne réécrit **jamais** `innerHTML` sur un conteneur entier :
les nœuds sont détruits et recréés, ce qui efface la saisie en cours, referme les `<details>`,
annule la sélection de texte et rejette le défilement en bas. Forme correcte : empreinte des champs
volatils → écriture ciblée par `data-maj` → **append** des seuls éléments neufs → une seule
minuterie liée à la vue visible, suspendue sur `document.hidden`, non réentrante. Un rendu complet
n'est légitime que **sur action de l'utilisateur**. Détail : `pi-web/CONTRAT-API-HARNESS.md`,
section « RÈGLE ABSOLUE ».

### Faits mesurés sur le contexte et les quotas (23/07)

- Le **socle** d'une session pèse ~24 K tokens avant le moindre échange (prompt système, outils,
  CLAUDE.md, skills). Un « 10 % » précoce n'est donc pas forcément anormal.
- Les postes **différés** (`isDeferred`) ne comptent PAS dans `totalTokens`.
- **`maxTokens` n'est pas comparable d'un modèle à l'autre** : 967 000 (Sonnet) vs 1 000 000
  (Opus), soit exactement les 33 000 du buffer d'autocompact. Deux jauges à « 10 % » ne désignent
  pas la même marge.
- **`reset_a` est en millisecondes epoch**, normalisé au point d'écriture. Une seule convention.


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

## Ce qui a été fait — session du 2026-07-23 (harness)

*Détail complet, faits mesurés et pièges : `harness/REPRISE.md`, section « SESSION DU 23/07
(journée) ». Ce résumé ne le remplace pas.*

- **Fil de la mission** — il était rendu VIDE « par honnêteté » alors que deux sources persistées
  existaient déjà (transitions d'état, permissions). Enrichi ensuite des activités du lead :
  le collecteur ne lisait que les blocs `text` d'un message assistant et **jetait** `thinking` et
  `tool_use`. Migrations 7 et 8.
- **Équipes terminées retrouvables** — `listerEquipes` n'appelait que `listerActives()` : une équipe
  sortait de la vue de l'orchestrateur à la seconde où elle finissait. Désignation par id, nom,
  projet ou fragment ; ambiguïté refusée avec ses candidats ; identifiant copiable dans l'UI.
- **Contexte ventilé par poste** (migration 6) — le SDK rendait une ventilation qu'on jetait.
- **Mort d'un worker détectée** — `reconcilier()` ne tourne qu'au démarrage et au rattachement ;
  un worker mort en cours de route n'était vu par personne. Le balayage télémétrie le déclenche.
- **État d'affichage honnête** — `en_cours` + `etatSdk=idle` s'affichait « running ».
- **`rapport_equipe`** — rend le dernier TEXTE du lead, entier, jamais tronqué.
- **Jauges de rate limit** — `releverQuota()` n'était appelé QUE pour marquer une saturation ;
  l'usage courant n'était jamais mesuré. Sonde réelle côté PC, cache 10 min.
- **Rafraîchissement temps réel de l'UI** — aucune vue du parc ne se rafraîchissait. Diff ciblé +
  append, sans jamais reconstruire le DOM (règle posée, voir ci-dessous).
- **Sidebar scrollable** en vue mobile.

## Prochaines étapes

**Liste tenue à jour dans `TODO.md`** (section « EN COURS »), plus précise que celle-ci.

1. **Chris envoie ses notes d'idées** prises il y a quelques jours — cas d'usage et améliorations à
   tester. C'est le point de reprise convenu en fin de session du 31/07.
2. **Exercer le mode rapide et ultracode** — `fastMode` est exposé par `/modeles` (seul Opus 5 le
   déclare), les cases existent à l'écran, leur effet réel n'a jamais été vérifié.
3. **(D) Élucider l'écart de ~4 K tokens** entre `totalTokens` et la somme des postes chargés.
4. **(E-bis) Revoir les autres opt-in de `deploy-harness-pi.sh`** — le script réécrit `.env` en
   entier ; un seul opt-in a été vérifié.
5. **Dettes** : `superviseur-workers.ts` à 710 lignes · index de rotation du master en mémoire ·
   `harness-orchestrateur.js` au-delà de 500 lignes · `BUDGET_MANDAT_DEFAUT_USD` codé en dur à 12 $,
   non réglable depuis l'orchestrateur ni l'interface.

## Points en suspens

- `🎯` **LE POINT DE REPRISE DU 03/08 — un mandat de test attend le clic de Chris.** Proposition
  `42f3a52f` (projet `/mnt/projects/bac-a-sable` sur le VPS, accès écriture) : cinq sous-agents en
  arrière-plan lancés dans un seul message, `sleep` de 20/35/170/195/480 s, un mot chacun (ALPHA,
  BRAVO, CHARLIE, DELTA, ECHO). Le lead rend la main immédiatement, puis **après chaque
  notification** — c'est le geste qui tuait les équipes, reproduit cinq fois. `⚠` Deux autres
  propositions traînent en attente (`c33f391b`, `8593870b`, stockiop en lecture) : ce sont les
  tentatives d'avant le bac à sable, **à rejeter**.
  **Résultat attendu** : équipe vivante 8–10 min · UNE seule notification de fin, à la vraie fin ·
  jamais affichée au repos pendant l'attente · les cinq mots dans la synthèse · aucune clôture auto.
  **Signature d'échec** : notification au bout d'une minute, un ou deux mots sur cinq.
  L'orchestrateur doit aussi abaisser le plafond de 250 $ à 5 $ au démarrage via `definir_budget` —
  second test gratuit de l'outil réparé le matin même : une BAISSE doit répondre `applique`.
- **Deux surfaces mortes repérées le 31/07, non traitées** (signalées à Chris, hors scope du jour) :
  l'audit `PreToolUse` est branché sur un `CollecteurAuditPermissions` créé neuf à chaque worker,
  jeté à la fin, que personne ne lit — même famille de défaut que le bus d'escalade · le formulaire
  manuel de mandat dans l'UI est un mock (`proposeMandate` empile une proposition locale et ne
  dispatche rien), il ne porte donc pas l'accès.
- **L'étage « lead → orchestrateur » n'existe pas.** L'organisation voulue est « sous-agents → lead
  → orchestrateur → humain ». Les deux premiers étages sont natifs du SDK, le troisième est absent —
  et ce n'est PAS du bus de permissions : c'est un canal de conversation remontante (le lead a une
  QUESTION et attend). Aujourd'hui l'orchestrateur peut lire une équipe et lui pousser un message,
  l'inverse n'existe pas.
- **`STATE.md` dépasse largement la limite de 300 lignes** (390) : il couvre deux produits, l'app v1 et
  le harness. À scinder si la limite devient gênante.
- **Quotas** : compte A à 27 % / 3 %, compte B à 12 % / 76 % (mesuré le 31/07 au matin). La sonde
  tourne à 60 s par compte en rotation, le 429 chronique est résorbé.
- **Écart de ~4 061 tokens** entre `totalTokens` et la somme des postes chargés, sur une mission
  réelle, alors que la somme tombait au token près en mesure locale. Hypothèse non prouvée : total
  calculé en direct, catégories issues d'un état antérieur. **Le total reste la référence.**
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

### Sessions du 2026-07-06 (app v1) — archivé le 31/07
Deux sessions consacrées à l'app v1 (chat Cerebras + pilotage du PC), avant l'existence du harness.
Livré : agent IA avec tool-calling, refonte frontend d'après mockup, page de login, passe
mobile-first, bascule multi-comptes Claude Code par snapshots de `.credentials.json`, bouton
d'extinction du PC, fix `100dvh` pour Safari iOS, conformité aux standards projet (README,
ARCHITECTURE, start/stop/restart, `.env.example`). L'app v1 reste en production et fonctionne —
le harness est un ajout, pas un remplacement. Détail complet dans l'historique git (juillet 2026).

### Sessions précédentes (avant 2026-07-06)
- Mise en place initiale : repo GitHub privé, checkpoint stable
- Agent IA ajouté (tool-calling Cerebras) avec vérification live des modèles disponibles sur la clé
- Mot de passe UI déplacé en `.env`, changé sur demande
- Refonte complète du frontend à partir d'un mockup fourni (design "Anthropic-style"), 100% du
  JS fictif du mockup remplacé par du vrai câblage backend
- Page de login refaite deux fois (mockup corrigé par Chris), remember-me retiré
- Passe mobile-first complète + panneau droit redimensionnable en drag
