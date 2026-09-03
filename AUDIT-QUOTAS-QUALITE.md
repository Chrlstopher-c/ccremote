# Audit — « ça bouffe les quotas, ça rate-limit vite, qualité moindre qu'une session CC »

*Audit en lecture seule, 2026-09-03. Aucun fichier de code ni de config modifié, système non exécuté.*
*Portée : `/mnt/projects/ccremote`, système 2 (harness). Grief du propriétaire, mot pour mot :*
*« ça bouffe à mort les quotas, ça rate-limit super vite, et la qualité est moindre que si j'utilisais*
*une session Claude Code normale ».*

Le grief est partiellement déjà consigné dans le dépôt : `SYNTHESE-CHANTIER.md` groupe A
(autoconnaissance de coût), groupe D (réglages jamais mesurés) et groupe J (fiabilité SDK/transport).
Cet audit remonte aux mécanismes de code qui les produisent.

Chaque cause = mécanisme (fichier + fonction + extrait), impact, gravité. Classement final en fin de
document.

---

## Cause 1 — N sessions orchestrateur indépendantes, chacune rejouant son historique complet à chaque tour

**Fichier** : `harness/control-plane/orchestrateur/gestionnaire-conversations.ts`
**Mécanisme** : chaque conversation opérateur est une **session Agent SDK distincte et persistante**,
maintenue vivante tant qu'elle n'est pas fermée. L'en-tête du fichier le pose noir sur blanc (lignes 19-21) :

> `☠` Un fil = une session, mais chaque session peut piloter le parc […]. **N sessions = N contextes
> et N× quota : c'est le prix du modèle « conversations indépendantes ».**

Et lignes 7-9 :

> Une session consomme du quota en continu ; on n'en allume une que lorsque l'opérateur écrit dans SA
> conversation.

Le démarrage lazy (`#assurerSession`, l.618-626) limite le nombre de sessions *allumées*, mais dès qu'un
fil est actif, il porte sa propre session SDK complète. Le mécanisme d'une session Claude Code est de
**renvoyer au modèle tout le transcript à chaque tour** : plus la conversation est longue, plus chaque
tour coûte cher. Le mandat de l'orchestrateur le reconnaît explicitement (`processus/mandat.ts`, l.39-41) :

> Ajouter ici un paragraphe qui n'est utile qu'une fois sur vingt, c'est **le faire repayer à tous les tours**.

Il n'existe aucune compaction automatique de la session orchestrateur : `compacter_mon_contexte`
(`gestionnaire-conversations.ts` l.468, `mandat.ts` l.282-287) **ne s'appelle jamais de la seule
initiative** de l'orchestrateur — uniquement quand Chris le demande ou accepte une proposition. Une
conversation longue laissée telle quelle voit donc son coût par tour croître sans borne jusqu'à
saturation, moment où la boucle de lecture bascule (`#lire`, l.697-716) sur le compte de repli.

**Impact** : tokens (coût par tour croissant, historique rejoué), et rate-limit (chaque fil actif
= une charge continue sur le pool de comptes partagé). C'est le poste de consommation structurel :
il s'ajoute à **toute** la consommation des équipes, sur les mêmes comptes.

**Gravité** : HAUTE. C'est le coût de conception assumé du modèle « conversations indépendantes façon
ChatGPT », et rien dans le code ne le plafonne côté orchestrateur.

---

## Cause 2 — Le parc se concentre sur un seul compte ; aucun plafond de parc actif par défaut

**Fichiers** : `harness/control-plane/orchestrateur/dispatch-mandat.ts` (`choisirCompteEquipe`, l.695-723)
et `harness/budgets/plafond-parc.ts` (`deciderCreationMission`, l.24-56).

**Mécanisme** — deux moitiés qui se combinent :

1. **Choix du compte** : hors préférence verrouillée, `dispatcherMandat` prend `disponibles[0]`
   (l.717) — le **premier** compte non saturé. `listerDisponibles()` n'écarte un compte que lorsqu'il
   est marqué `rejected`, c'est-à-dire à **100 %** d'utilisation de fenêtre (`balayage-quotas.ts`,
   `appliquer`, l.90 : `statut: f.utilisation >= 100 ? 'rejected' : …`). Tant que le compte-a est sous
   100 %, **toutes** les équipes lancées y vont — l'orchestrateur (Cause 1) inclus si le pool est le
   même. La rotation ne se déclenche donc qu'une fois le compte-a **déjà saturé** (l.719-722 :
   « rotation de compte : le précédent est saturé »).

2. **Aucun garde-fou de parc actif** : `plafond-parc.ts` est **désactivé par défaut**
   (l.10-11, `deciderCreationMission` l.39-41) —

   > Désactivé par défaut […] `seuilUtilisationPct` non défini ⇒ toujours autorisé.

   Le seul blocage restant est le `rejected` dur à 100 % (l.31-37). Donc rien n'empêche d'empiler des
   équipes sur un compte qui monte vers la saturation à 80, 90, 99 %.

C'est exactement le motif que le code lui-même a documenté ailleurs comme pathologique
(`balayage-quotas.ts`, `tourSuivant`, l.104-108, `VÉCU DU 25 AU 31/07`) :

> Sur un endpoint qui rationne, deux comptes en concurrence signifient un gagnant et un perdant
> **TOUJOURS LES MÊMES**.

Le balayage de quotas a été corrigé par la rotation « un compte par passe » ; **le dispatch d'équipes,
lui, n'a pas l'équivalent** : il charge `disponibles[0]` jusqu'à le saturer au lieu de répartir. La
concurrence (plusieurs équipes + orchestrateur) contre une ressource rationnée produit donc un
rate-limit **systématique**, pas aléatoire — un compte grillé pendant que l'autre reste sous-utilisé.

Concurrence maximale possible : `PLAFOND_EQUIPES_PROJET_GIT_DEFAUT = 4` par projet git
(`dispatch-mandat.ts` l.116), sans plafond agrégé de parc. Plusieurs projets git → 4 × N équipes
simultanées, toutes sur le même premier compte disponible.

**Impact** : rate-limit rapide et systématique sur un compte, alors que la capacité globale du parc
n'est pas épuisée. C'est le cœur du « ça rate-limit super vite ».

**Gravité** : HAUTE.

---

## Cause 3 — Retry watchdog non borné et relance/dispatch sur compte saturé qui bascule en payant

**Fichiers** : `harness/budgets/garde-retry-watchdog.ts` ; `processus/mandat.ts` (bloc CARBURANT,
l.255-262) ; `workers/options-composition.ts` (`buildWorkerEnv`, l.50-59).

**Mécanisme** :

- `CLAUDE_CODE_RETRY_WATCHDOG=1` **retente les erreurs de capacité indéfiniment**
  (`garde-retry-watchdog.ts`, l.6-10) :

  > `CLAUDE_CODE_RETRY_WATCHDOG=1` retente les erreurs de capacité indéfiniment (G.1.4) : sur
  > abonnement […] une **consommation de quota non bornée**, qui peut saturer le compte pendant la nuit.

  Le seul garde-fou est qu'un **budget soit actif** (`budgetEstActif`, l.23-25 : fini et > 0). Or le
  budget par défaut d'une équipe est **250 $** (`dispatch-mandat.ts` l.108 →
  `PLAFOND_EQUIPE_USD`, et `mandat.ts` l.213-214 : « Laissé vide, c'est 250 $ »). 250 $ est « actif »,
  donc le watchdog est **autorisé** et retente les erreurs de capacité jusqu'à 250 $ de quota consommé
  par équipe. La borne existe mais elle est très haute.

- La relance/le dispatch sur compte saturé **ne coupe pas proprement, il bascule en surcoût payant**
  (`mandat.ts`, bloc CARBURANT, l.260-261) :

  > Ne réessaie pas en boucle : un dispatch sur un compte saturé **bascule en surcoût payant, il
  > n'échoue pas proprement**.

  C'est une consigne au modèle, pas un verrou de code. Rien dans `dispatcherMandat` ne refuse un
  dispatch sur un compte à 99 % (voir Cause 2) : le garde-fou dépend du jugement de l'orchestrateur,
  qui n'a même pas d'outil de coût temps réel fiable (`SYNTHESE-CHANTIER.md` groupe A, point 1 : « Pas
  d'outil de coût temps réel pour l'équipe »).

**Impact** : sur erreur de capacité (donc précisément quand le quota est tendu), le watchdog relance et
aggrave la consommation ; le dispatch sur compte quasi-saturé bascule en overage payant au lieu de
s'arrêter. Amplifie Cause 2 : le rate-limit ne freine pas la conso, il la transforme en surcoût.

**Gravité** : MOYENNE-HAUTE (borne à 250 $ existante mais lâche ; dépend du jugement du modèle).

---

## Cause 4 — Modèles chers par défaut, sous-agents héritant d'Opus, budget par défaut à 250 $

**Fichiers** : `harness/control-plane/orchestrateur/dispatch-mandat.ts` (`MODELE_LEAD_DEFAUT`, l.128) ;
`harness/shared/modeles-claude.ts` (catalogue) ; `dispatch-mandat.ts` (`BLOC_DIMENSIONNEMENT`, l.311-357).

**Mécanisme** :

- **Lead par défaut = Opus 5, effort high** (`MODELE_LEAD_DEFAUT = 'claude-opus-5'`,
  `EFFORT_LEAD_DEFAUT = 'high'`, l.128-129). L'orchestrateur lui-même tourne sur le défaut SDK,
  Opus 5 (`mandat.ts` l.19 : « Opus 5 au SDK 0.3.220 »).
- **Les sous-agents héritent du modèle du parent s'il n'est pas précisé** — mesuré et documenté
  (`BLOC_DIMENSIONNEMENT`, l.312-319) :

  > `AgentInput.model` est OPTIONNEL et « if omitted, inherits from the parent ». Un lead Opus 5 qui
  > lance trois sous-agents sans rien préciser lance donc **trois Opus 5** […]. Le site lumen a coûté
  > **52,93 $ en six vagues**. Moyenne mesurée : **6,40 $ par mission Opus contre 0,67 $ par mission
  > Sonnet**.

  La parade est **une consigne dans le mandat système** (« ton défaut est `sonnet` »), pas un défaut
  de code : si le lead omet `model` sur un `Task`, le SDK applique l'héritage Opus. Le garde-fou est un
  texte que le modèle doit suivre, pas un verrou.
- **Budget par défaut 250 $** (Cause 3) : ne borne rien en pratique pour une mission normale.

**Impact** : facteur ~10 sur le coût par équipe (6,40 $ vs 0,67 $) dès qu'un lead Opus oublie de
dimensionner ses sous-agents. C'est la source du « ça bouffe à mort ». Un modèle cher est aussi ce qui
sature une fenêtre de quota le plus vite.

**Gravité** : HAUTE sur le coût ; le défaut Opus est justifié pour la qualité mais l'héritage
non-verrouillé le rend imprévisible.

---

## Cause 5 — Qualité moindre qu'une session CC : handoffs à perte et contexte fragmenté

Ce n'est pas un modèle trop faible (les défauts sont Opus/Sonnet high, corrects). La dégradation vient
de la **structure multi-agents** : là où une session CC unique garde tout le contexte, ccremote découpe
en orchestrateur → lead → sous-agents, chaque frontière étant une transmission qui perd de l'information.

Mécanismes ancrés :

1. **`rapport_equipe` ne rend que le dernier bloc de texte du lead, tel quel**
   (`dispatch-mandat.ts`, `BLOC_RAPPORT`, l.184-202) :

   > `rapport_equipe` ne rend PAS une synthèse construite : il rend le **DERNIER BLOC TEXTE** que le
   > lead a produit, tel quel. Et depuis que la fin d'une équipe notifie l'orchestrateur, ce bloc est
   > lu **automatiquement pour décider de la suite** […] souvent sans qu'un humain le relise.

   Toute la mission d'une équipe est réduite, en remontée, à son dernier message. L'orchestrateur décide
   d'enchaîner/relancer sur cette seule vue → décisions sur information partielle, relances « pour rien ».

2. **L'orchestrateur ne voit jamais le flux brut d'une équipe** (`mandat.ts`, l.277-280) — seulement un
   échantillon borné via `suivre_equipe`. Et depuis un changement de défaut du CLI embarqué, il ne voit
   même plus la **réflexion** des équipes (`options-composition.ts`, l.164-171) :

   > `activite_mission` porte 336 réflexions du 23/07 au 03/08, **puis PLUS AUCUNE** […] le défaut de
   > `display` du CLI est passé à `omitted` sous nos pieds. Le modèle raisonne toujours, mais son
   > raisonnement n'entre plus dans le flux — l'orchestrateur surveille une équipe dont il ne voit plus
   > la réflexion.

3. **Compaction à perte des deux côtés** :
   - Orchestrateur : un résumé dense **remplace tout l'historique**, le reste est perdu (`mandat.ts`
     l.287 ; `gestionnaire-conversations.ts`, `amorceApresCompaction` l.78-85).
   - Worker : `autoCompactEnabled: true` (`options-composition.ts` l.152) ; le lead perd son premier
     message à la compaction — mitigé en plaçant le cadre dans le `systemPrompt`
     (`dispatch-mandat.ts` l.456-474), mais le contexte de travail intermédiaire, lui, est bien compacté
     en cours de mandat long.

4. **Sous-agents Sonnet par défaut, sans relecture Opus systématique** (`BLOC_DIMENSIONNEMENT`,
   l.351-357) : arbitrage coût/qualité explicite —

   > `sonnet` […] déclare plus souvent terminé un travail qu'il n'a pas vérifié.

   La parade retenue est « preuve mécanique », pas une relecture — choix défendable pour le coût, mais
   qui, mal appliqué par le lead, laisse passer du travail non vérifié qu'une session CC pilotée par
   Chris aurait rattrapé.

5. **Frontière opérateur↔orchestrateur↔équipe** : Chris ne parle pas au lead, il parle à l'orchestrateur
   qui **reformule** le mandat (`composerMandatSysteme`, l.475-506). L'intention passe par deux
   reformulations (Chris → orchestrateur → mandat système → lead) avant d'atteindre l'exécutant. Une
   session CC reçoit l'intention de Chris en direct, sans intermédiaire.

**Impact** : qualité perçue inférieure à une session CC unique, non pas par modèle plus faible mais par
perte d'information à chaque frontière (mandat reformulé, rapport = dernier bloc, réflexion invisible,
compaction, sous-agents non relus).

**Gravité** : HAUTE sur la qualité perçue ; c'est le cœur du troisième volet du grief.

---

## Ce qui n'est PAS une cause (vérifié)

- **Le juge anti-boucle** (`anti-boucle/`, `superviseur/anti-boucle-workers.ts`) : tourne sur **Haiku**
  (`MODELE_JUGE_PAR_DEFAUT`, `anti-boucle/index.ts` l.13), et seulement au **franchissement d'un palier
  de coût** (`verifierEtJuger`, l.206-241), sur des signaux déjà lus (jamais de relecture de transcript,
  l.183). Coût marginal, et il est de surcroît **non câblé en production** par construction
  (`index.ts` l.6-8, `anti-boucle-workers.ts` l.10-17). Ce n'est pas un poste de consommation.
- **Le balayage de quotas** (`balayage-quotas.ts`) : ne coûte **ni token ni process** (endpoint OAuth,
  l.7-9), et a déjà été rationné (1 req/min, rotation un compte par passe). Corrigé, pas un problème.
- **Les retries du balayage** : `enCours` empêche deux passes concurrentes (l.161-163). Sain.

---

## Classement des causes, de la plus coûteuse à la moindre

| # | Cause | Fichier / mécanisme probant | Volet du grief | Gravité |
|---|---|---|---|---|
| 1 | **N sessions orchestrateur indépendantes, historique rejoué à chaque tour, aucune compaction auto** | `gestionnaire-conversations.ts` l.19-21 (« N sessions = N contextes et N× quota »), `mandat.ts` l.39-41 | quotas + rate-limit | HAUTE |
| 2 | **Concentration du parc sur `disponibles[0]` + plafond de parc désactivé par défaut** | `dispatch-mandat.ts` `choisirCompteEquipe` l.695-723 ; `plafond-parc.ts` l.39-41 ; motif « perdant toujours le même » `balayage-quotas.ts` l.104-108 | rate-limit systématique | HAUTE |
| 3 | **Modèle Opus par défaut + sous-agents héritant d'Opus (non verrouillé) + budget défaut 250 $** | `dispatch-mandat.ts` l.128, `BLOC_DIMENSIONNEMENT` l.312-319 (52,93 $ mesuré ; 6,40 $ vs 0,67 $) | quotas (coût) | HAUTE |
| 4 | **Qualité : handoffs à perte (rapport = dernier bloc), réflexion invisible, compaction, double reformulation du mandat** | `dispatch-mandat.ts` `BLOC_RAPPORT` l.184-202 ; `options-composition.ts` l.164-171 ; `mandat.ts` l.277-287 | qualité moindre | HAUTE |
| 5 | **Retry watchdog non borné (borne = budget 250 $) + dispatch sur compte saturé bascule en payant** | `garde-retry-watchdog.ts` l.6-10 ; `mandat.ts` l.260-261 | quotas (amplificateur) | MOYENNE-HAUTE |

**Lecture d'ensemble** : les trois premières causes se cumulent sur **le même pool de comptes** —
l'orchestrateur (Cause 1) et toutes les équipes (Cause 2) tapent le premier compte disponible, avec des
modèles chers (Cause 3), et quand ce compte sature, le watchdog et le dispatch en payant (Cause 5)
prolongent la conso au lieu de la stopper. Le « rate-limit super vite » est la conséquence directe de la
concentration (Cause 2) ; le « bouffe les quotas » de Causes 1+3 ; la « qualité moindre » de Cause 4,
indépendante des trois autres.
