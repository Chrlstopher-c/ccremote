# v1 en production ↔ maquette v2 — ce qui change et pourquoi

Référence v1 : `pi-web/templates/index.html` + `pi-web/static/*.js`.
Référence v2 : `design-v2/index.html`.
Autorité domaine : `Upgrade/03-couche-1.md`, `Upgrade/16-decisions-operateur.md`.

Bascule de nature : la v1 pilote **un PC** (sessions tmux, métriques machine, un agent conversationnel).
La v2 pilote **un parc de missions sur N projets**, avec un humain en boucle asynchrone sur les permissions.

---

## 1. Repris tel quel

| Élément | Pourquoi conservé |
|---|---|
| Palette cream / `--ink` / accent orange, serif titres + mono données | Identité déjà tenue, aucune raison domaine de la casser ; la v2 réutilise les mêmes tokens |
| Shell sidebar + vues commutées, `.nav-item.active::before` (barre accent) | La navigation par vues résiste au passage de 5 à 6 vues ; rien à réinventer |
| `100dvh` + `env(safe-area-inset-*)`, drawer sidebar sous 1024 px | Contrainte Safari iOS déjà payée une fois (mémoire `echoos-landing`) — la v2 est consommée majoritairement au téléphone |
| Mobile-first, cartes empilées, `hide-sm` sur les libellés de boutons | L'opérateur arbitre depuis l'iPhone ; c'est le cas d'usage nominal, pas le cas dégradé |
| Chat orchestrateur (bulles, composer, `tool` inline) | La v1 avait déjà le bon objet : une conversation avec appels d'outils visibles. Seuls les outils changent (contrôle de parc au lieu de contrôle de PC) |
| Modales `confirmAction`, toasts, switches | Vocabulaire d'interaction stable, réutilisé pour pause / refus / arrêt |

---

## 2. Modifié — et la contrainte domaine qui le force

| Écran v1 | Devient | Contrainte qui l'impose |
|---|---|---|
| **Sessions Claude Code** (liste de sessions tmux d'un PC) | **Parc** (missions groupées par état : `requires_action` → `running` → repos/arrêtées) | [E] n'a que trois états et le troisième déclenche une notification. Trier par ancienneté de session n'a plus de sens : ce qui compte est *qui attend l'humain*. Une session tmux était un contenant ; une mission est un contrat (mandat + critère d'arrêt + worktree + compte) |
| **Agent IA** (outils : `wake_pc`, lancer tmux, lire les températures) | **Orchestrateur** (outils : `parc_etat()`, `mission_lancer()`) | Frontière A↔B inexistante (03-couche-1) : l'orchestrateur ne parle jamais aux workers, il passe par le MCP de contrôle. La v1 exécutait des commandes machine ; la v2 exprime des intentions sur le parc et rend la main immédiatement (invariant de non-blocage) |
| **Carte pied de sidebar : CPU / RAM du PC** | **Carte état du lien Pi↔PC** (nœuds PI/PC, seq, dernier battement) | H-57, limite structurelle : lien coupé ⇒ *aucun* bouton de sûreté n'atteint les workers. L'information la plus critique en permanence n'est plus la charge de la machine, c'est la vivacité du canal de contrôle |
| **Paramètres → quotas Cerebras** (snapshot tiré, bug du snapshot figé) | **Comptes & quotas** (vue de premier niveau, par compte Claude Code, poussé par `rate_limit_event`) | H-54 : la donnée est native et poussée, `resetsAt` fourni. H-53 : N comptes tournent en parallèle via `CLAUDE_CONFIG_DIR`. Un quota agrégé unique ne décrit plus rien — il faut la ventilation par compte, plus l'affectation mission→compte, qui pilote la rotation |
| **Paramètres → bascule de compte** (écrase `.credentials.json`, redémarre les sessions tmux) | Supprimé, remplacé par l'affichage « missions par compte » + rotation automatique des **prochains** dispatchs | H-53 rend le mécanisme obsolète : plus rien à basculer globalement, le compte est fixé au spawn par mission |
| **Paramètres** (préférences navigateur, hôte, MAC) | **Paramètres** (abonnement push, projets du parc, santé de la sûreté, recours de dernier ressort) | H-59 (état d'abonnement à afficher, pas à supposer), H-57 (test régulier des boutons), [F] (ajouter un projet ne touche aucun autre composant) |

---

## 3. Entièrement nouveau

| Élément v2 | À quoi ça sert | Pourquoi impossible avant |
|---|---|---|
| **Vue Parc** | Une lecture, un verdict : combien attendent l'arbitrage, combien tournent, combien sont mortes | En v1 il n'y avait qu'une machine et des sessions interchangeables. Le parc n'existe qu'à partir du moment où [F] matérialise projet ↔ worktree ↔ équipe |
| **Détail de mission + arbre d'exécution** (lead → n2 → n3, reconstruit via `parent_tool_use_id` / `parent_agent_id`) | Savoir *qui* dans l'équipe est bloqué, et sur quoi | En v1 une session était un terminal opaque : pas de hiérarchie d'agents à représenter. L'arbre n'a de sens que parce que N2/N3 sont natifs à l'intérieur de la session (frontière harness ↔ intérieur de session) |
| **Deux boutons de sûreté distincts** (PAUSE GLOBALE fréquente, ARRÊT D'URGENCE armé par maintien 1,5 s) | Reprendre la main sans détruire de contexte / tout stopper quand ça déraille | H-57 `☠ CASSE` : G.4 ne prévoyait qu'un mécanisme finissant par `close()`. En v1, un seul PC et une supervision continue : le frein n'était pas nécessaire |
| **Encart « ce que la pause ne fait pas »** dans la modale | Les processus enfants lancés par les agents (serveurs de dev, builds, watchers) survivent à la pause | Exigé explicitement par H-57 : sans ça le bouton donne une fausse sécurité |
| **Comptes & quotas par compte Claude Code** | Voir quel compte sature, quelles missions y sont attachées, quand ça reset | H-53/H-54 : l'isolation multi-comptes et le quota temps réel natif n'étaient ni vérifiés ni exploitables avant |
| **État du lien Pi↔PC** (carte + bandeau global + boutons grisés) | Distinguer « rien ne se passe » de « je ne sais plus ce qui se passe » | Architecture à deux plans (Pi control plane / PC exécution). En v1, le Pi appelait le PC en direct : soit ça répondait, soit ça échouait sur l'appel |
| **File d'escalade de permissions** (outil, phrase, `decisionReason`, chemin visé, refus motivé) | Le chemin critique du système : un agent bloqué, un humain à latence indéterminée, un verdict réinjecté par `requestId` | [C] n'existait pas. En v1 les permissions se réglaient dans le terminal tmux, en présence |
| **État de l'abonnement push** (Web Push, PWA détectée, permission navigateur, filet Discord) | Prouver que le canal de notification est vivant | H-59 : sur iOS la PWA désinstallée coupe les notifications **en silence**. C'est le seul mode de panne qui rend le système inutilisable sans erreur visible |
| **Réconciliation registre ↔ PC** et **âge du dernier test de sûreté** | Détecter fantômes/orphelins, et un bouton d'urgence pourri | Système sans surveillance humaine continue — personne d'autre ne le remarquera |

---

## 4. Devenu obsolète

À supprimer franchement, pas à porter par nostalgie :

- **Vue « État du PC »** (CPU, RAM, temp CPU, GPU util/mém, réseau up/down). Quatre grosses tuiles de télémétrie qui n'informent aucune décision opérateur : quand une mission est bloquée, le pourcentage GPU ne dit rien. Le contexte et le quota, si. *Réserve en Tensions.*
- **Wake-on-LAN / extinction du PC** dans la barre d'actions. Actions de type « je pilote ma machine » ; le harness pilote des missions. *Réserve en Tensions — la v2 les a supprimées sans les remplacer.*
- **Sessions tmux comme objet de premier niveau**, y compris « Nouvelle session » et le nom de session. tmux devient un détail d'implémentation du superviseur [B], qui « n'a pas d'opinion » : l'exposer dans l'UI recrée la frontière A↔B que 03-couche-1 interdit.
- **Tiroir terminal redimensionnable + champ « envoyer une instruction »** vers une session. Injecter du texte brut dans une session court-circuite [C] et [E] : le harness ne saurait plus ce qui a été demandé ni par qui. *Le besoin sous-jacent reste — voir Tensions.*
- **Bascule de compte par écrasement de `.credentials.json` + kill/relaunch tmux**. Rendu obsolète par H-53 (vérifié en réel). Reste valide pour le Claude Code interactif du poste, hors périmètre harness.
- **Dashboard quotas Cerebras**. L'agent conversationnel v1 tournait sur Cerebras ; l'orchestrateur v2 est une session Agent SDK sur compte Claude Code. Les fenêtres à afficher sont `five_hour` / `seven_day*`, pas des requêtes/minute par clé API.
- **Vue « Historique »** (actions exécutées via l'agent, stockées en `localStorage`). Remplacée par l'historique d'événements *par mission*, servi par [E]. Un journal côté navigateur ne survit pas à un changement d'appareil et n'est pas la source de vérité (H.3 : la vérité, ce sont les transcripts JSONL du `CLAUDE_CONFIG_DIR` du worker).
- **Liste « Conversations »** en sidebar. Une seule session orchestrateur persistante, avec sa propre jauge de contexte — pas un historique de fils à collectionner.

---

## Tensions

Cinq points où le domaine et l'ergonomie actuelle se contredisent réellement. Ils demandent un arbitrage, la maquette a tranché seule.

**1. Le PC éteint n'est pas le lien coupé — et la v2 n'a plus de bouton pour l'allumer.**
Le WOL a disparu au profit de la carte « lien Pi↔PC ». Mais tout le parc dépend d'un PC allumé : si l'opérateur éteint son poste le soir, aucune mission ne tourne la nuit, et l'UI affichera seulement « lien coupé » sans offrir le geste qui corrige. Trois sorties : (a) réintégrer un réveil discret dans la carte lien, (b) réveil automatique par le Pi au dispatch d'une mission, (c) assumer que le PC reste allumé en permanence et documenter. À trancher, la maquette a implicitement choisi (c).

**2. Aucun chemin pour parler à une mission en cours.**
La v1 avait un champ d'entrée direct vers la session tmux. La v2 l'a retiré — à raison : l'orchestrateur n'a pas le droit de parler aux workers (frontière A↔B), et une injection brute rendrait [E] aveugle. Mais il n'existe aucun remplaçant : le bouton « Ouvrir le flux brut » du détail de mission ne mène nulle part dans la maquette. Or corriger un lead qui part de travers sans arrêter la mission est un besoin réel, et le seul canal spécifié aujourd'hui est le refus motivé d'une permission — qui suppose que l'agent demande quelque chose. **C'est le trou le plus concret de la maquette.** Il faut soit un « message à la mission » qui transite par le MCP de contrôle et est journalisé dans [E], soit assumer que la seule correction possible est pause → nouveau mandat.

**3. Les boutons de sûreté sont absents de la vue Orchestrateur.**
La barre de sûreté est injectée dans Parc / Mission / Escalades / Comptes, pas dans Orchestrateur ni Paramètres — sur Orchestrateur, le composer occupe le bas de l'écran. H-57 insiste : le bouton doit marcher *précisément* quand l'orchestrateur déraille ou boucle. Fonctionnellement le chemin ne passe pas par lui, mais visuellement il disparaît sur l'écran où on constate le dérapage. Arbitrage : sacrifier de la hauteur de composer sur mobile, ou accepter un aller-retour vers Parc pour freiner.

**4. Métriques machine : supprimées alors que le domaine les rend plus pertinentes, pas moins.**
Argument pour la suppression : la télémétrie ne pilote aucune décision. Argument contre, tiré de H-57 : les processus lancés par les agents (serveurs de dev, builds, watchers) **survivent à la pause** et s'accumulent. N missions concurrentes sur un même PC, ça se voit en RAM avant de se voir ailleurs. La v2 a supprimé le seul endroit où ça se serait vu. Compromis raisonnable : pas de vue dédiée, mais une ligne de charge dans la carte lien, et une alerte quand elle décroche.

**5. Deux entrées pour le même arbitrage.**
Une demande `requires_action` apparaît à la fois en tête du Parc (carte accentuée) et dans la vue Escalades. Voulu — la notification pousse vers l'une, le balayage matinal vers l'autre — mais la carte Parc n'offre pas Autoriser/Refuser, elle renvoie vers Escalades. Sur mobile, à 3 h du matin, ce détour est un clic de trop. Arbitrage : rendre la carte Parc actionnable en place (et Escalades devient une pure file), ou assumer le détour pour forcer la lecture du `decisionReason` avant le verdict — ce qui est défendable, et est probablement la vraie raison de le garder.
