# Branche G — Garde-fous

**Profondeur atteinte : 3.** S'arrête là parce que les seuils dépendent de mesures qui n'existent pas encore. Spécifier des chiffres à froid serait inventer.

**Responsabilité unique** : empêcher qu'un parc autonome consomme sans limite ou fasse des dégâts irréversibles pendant que l'opérateur dort.

**Contexte** : avec H-40 (arbitrage délégué au lead) et H-41 (le lead peut tout faire), c'est la **dernière ligne de défense**. Elle porte donc plus de poids qu'elle n'en porterait dans un système supervisé.

---

## G.1 — Budget

### G.1.1 Plafond par équipe `⊣ TERMINAL`

`maxBudgetUsd` arrête la requête quand l'estimation de coût côté client atteint la valeur.

`⚠` Vérifié : comparé à la **même estimation** que `total_cost_usd`, avec des réserves de précision documentées. **C'est un garde-fou, pas une comptabilité.** Ne pas construire de facturation dessus.

Arrêt propre : `TerminalReason = 'budget_exhausted'`, classé « borne atteinte » en B.3.2 ⇒ **remonter, ne pas relancer automatiquement.**

`☠ CASSE` — relancer automatiquement une équipe qui a épuisé son budget annule le garde-fou. C'est l'erreur la plus facile à commettre, parce que la relance automatique est légitime pour d'autres raisons terminales.

### G.1.2 Budget de tâche `⊣ TERMINAL` `⚠ ALPHA`

`taskBudget: { total: number }` — budget en tokens côté API. Quand il est réglé, **le modèle est informé de son budget restant** et peut donc doser son usage d'outils et conclure avant la limite.

Différence de nature avec `maxBudgetUsd` : l'un **coupe**, l'autre **informe**. Les deux se combinent — informer produit un arrêt plus propre que couper.

`⚠ HYP` — utiliser les deux. Le second étant alpha, l'isoler derrière une couche d'adaptation.

### G.1.3 Plafond de parc `⊣ DÉLÉGUÉ`

Au-delà des plafonds par équipe, un plafond agrégé — N équipes chacune sous son plafond peuvent dépasser ce que tu acceptes globalement.

Mécanique imposée : le Pi agrège, et au franchissement du seuil, refuse de créer de nouvelles équipes et notifie. **Il ne tue pas** les équipes en cours — les tuer perd du travail sans économiser grand-chose.

Seuil : `⊣ DÉLÉGUÉ`, dépend de ton budget réel.

### G.1.4 Limites d'usage `⊣ TERMINAL`

Voir E.4.3 pour les trois catégories.

Comportement au franchissement :
- **Limite atteinte** (`USAGE_LIMIT_ERROR_PREFIXES`) ⇒ suspendre les créations d'équipes, notifier.
- **Transition** ⇒ notifier, ne rien suspendre.
- **Avertissement** ⇒ tracer, ne pas notifier.

Voir aussi `SDKRateLimitEvent` / `SDKRateLimitInfo` pour l'état structuré, et les raisons terminales `blocking_limit` et `rapid_refill_breaker`.

`⚠ HYP` — `CLAUDE_CODE_RETRY_WATCHDOG=1` (B.3.1) retente les erreurs de capacité **indéfiniment**. Combiné à un budget actif, c'est correct : le budget coupe. **Sans budget actif, c'est un risque de dépense non bornée.** Les deux vont ensemble ou aucun.

---

## G.2 — Plancher de déni

### G.2.1 Principe `⊣ TERMINAL`

Détail complet en C.1.3. Rappel du fondement, parce que c'est ce qui rend H-41 acceptable :

Une règle **scopée** (`Bash(rm *)`) refuse les appels correspondants **dans tous les modes de permission, y compris `bypassPermissions`.** Un nom d'outil nu retire simplement l'outil du contexte.

Le plancher est donc un vrai plancher. Le lead peut tout faire **dans l'espace que le plancher laisse ouvert**, et cet espace est vaste : le plancher ne vise que l'irréversible.

### G.2.2 Périmètre `⊣ DÉLÉGUÉ`

Cadre imposé, liste à établir sur l'arborescence réelle du poste :

| Catégorie | Intention |
|---|---|
| Destruction hors worktree | protéger le reste de la machine |
| Réécriture d'historique git partagé | protéger le travail des autres équipes |
| Écrasement de secrets | protéger les credentials |
| Désinstallation d'outillage système | protéger l'environnement d'exécution |

Contrainte : **rien qui gêne le travail normal.** Un plancher qui déclenche plusieurs fois par jour sera contourné ou désactivé, donc inutile. Viser une dizaine de motifs, pas cinquante.

### G.2.3 Vérification `⊣ TERMINAL`

Le plancher se **teste**, il ne se suppose pas. Chaque motif doit avoir un cas de test qui démontre le refus effectif, dans le mode de permission réellement utilisé en production.

`☠ CASSE` — un plancher jamais testé est une croyance. Un motif mal écrit ne refuse rien et ne produit aucune erreur.

---

## G.3 — Bac à sable `⊣ DÉLÉGUÉ`

`SandboxSettings` est configurable programmatiquement, avec `SandboxNetworkConfig`, `SandboxFilesystemConfig`, `SandboxCredentialsConfig`, `SandboxIgnoreViolations`.

Sur ta machine, dans ton LAN, avec ton PC, un bac à sable complet est probablement excessif — mais restreindre le **système de fichiers** au worktree renforcerait matériellement H-11, et restreindre le **réseau** limiterait l'exfiltration accidentelle de secrets.

**Instruction** : évaluer le coût de friction sur un cas réel avant d'adopter. Une restriction qui casse le travail légitime sera désactivée. Ne pas adopter préventivement.

---

## G.4 — Arrêt d'urgence `⊣ TERMINAL`

### G.4.1 Exigence

Un moyen, depuis le téléphone, d'arrêter **tout** immédiatement, sans passer par l'orchestrateur.

`☠` **Ne pas passer par l'orchestrateur** est le point essentiel : si l'orchestrateur est en train de dérailler, de saturer son contexte ou de boucler, c'est exactement le moment où tu as besoin du bouton. Un arrêt d'urgence qui dépend du composant potentiellement défaillant n'en est pas un.

### G.4.2 Mécanique

Chemin direct téléphone → control plane → canal de contrôle (D.3) → superviseur.

Séquence : marquer toutes les équipes `en_pause`, `interrupt()` sur chacune, puis `close()`. Fenêtre de grâce respectée (B.1.5), `kill` seulement en dernier recours.

**Ne détruit rien.** Les worktrees restent, le travail non commité reste. Un arrêt d'urgence qui perd du travail ne sera pas utilisé quand il faudra.

### G.4.3 Test

Se teste **régulièrement**, pas une seule fois à l'installation. Un arrêt d'urgence qui n'a pas été déclenché depuis six mois a une probabilité élevée d'être cassé.

---

## G.5 — Ce qui n'est pas un garde-fou `⊣ TERMINAL`

Point de doctrine, à opposer aux missions qui dériveraient.

| Pas un garde-fou | Pourquoi |
|---|---|
| Une instruction dans le prompt | Suggestion au modèle, pas contrainte sur l'exécution (H-42) |
| Le mandat de l'équipe | Idem. Utile, mais pas contraignant |
| La confiance dans le classifieur `auto` | Il décide **dans** l'espace autorisé ; il ne définit pas l'espace |
| Un plafond jamais testé | Une croyance (G.2.3) |
| La supervision humaine | Toute la conception suppose qu'elle est absente |

Les vrais garde-fous du système sont **au nombre de quatre** : `disallowedTools` scopé, `maxBudgetUsd`, le fencing par epoch (D.2.3), et l'arrêt d'urgence. Tout le reste est de la conduite, pas de la sûreté.
