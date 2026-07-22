# Branche C — Bus de permissions

**Profondeur atteinte : 5.** La plus profonde du paquet. Motif : c'est ici que le système casse silencieusement.

**Recadrage suite à H-40** : l'arbitrage nominal appartient au lead via `permissionMode: 'auto'`. Le bus n'est donc **plus sur le chemin critique de chaque tour** — c'est une voie d'escalade, d'observation et d'audit. Ça réduit le volume, **pas** les exigences de correction : une seule demande perdue bloque une équipe pour toujours.

---

## C.1 — Le modèle d'évaluation

### C.1.1 Ordre d'évaluation `⊣ TERMINAL`

Une demande d'outil traverse, dans l'ordre : règles de déni → règles d'autorisation / `allowedTools` → `permissionMode` → invite.

`canUseTool` **n'est appelé qu'au dernier étage**. Il n'est **pas** invoqué pour ce qui est auto-approuvé par `allowedTools`, par une règle d'allow, ou par le mode (`acceptEdits`, `bypassPermissions`).

`☠ CASSE` — pour intercepter **tous** les appels d'outils, y compris les auto-approuvés, il faut un hook `PreToolUse`, pas `canUseTool`. Confondre les deux produit un système d'audit qui ne voit qu'une fraction de l'activité et donne une fausse impression de couverture.

### C.1.2 Les trois exceptions qui traversent tout `⊣ TERMINAL`

Atteignent `canUseTool` **même si une règle d'allow correspond** :

1. `AskUserQuestion`
2. Les outils MCP marqués `requiresUserInteraction`
3. Les outils de connecteur qu'une organisation a réglés sur `ask`

En mode `dontAsk`, ces appels sont **refusés** au lieu d'invoquer la fonction.

Conséquence de conception : une équipe en `dontAsk` **ne peut pas poser de question**. Si elle a besoin d'un arbitrage, elle échoue. Propriété du mode, pas défaut — à documenter comme telle. En mode `'auto'` (le nôtre), le classifieur tranche.

### C.1.3 Le plancher de déni `⊣ TERMINAL`

Distinction vérifiée, et c'est elle qui rend H-41 tenable :

- **Nom d'outil nu** (`"Bash"`) → retire l'outil du contexte de Claude. Il ne sait plus qu'il existe.
- **Règle scopée** (`"Bash(rm *)"`) → laisse l'outil disponible et **refuse les appels correspondants dans tous les modes, y compris `bypassPermissions`.**

Le plancher irréversible utilise donc **exclusivement des règles scopées**. Une mission qui met un nom nu dans le plancher a mal compris : elle ampute la capacité au lieu de borner le danger.

`⊣ DÉLÉGUÉ` — la liste exacte des motifs. Elle dépend de l'arborescence réelle du poste, des dépôts, de l'emplacement des secrets. Cadre imposé : destruction hors worktree, réécriture d'historique git partagé, écrasement de fichiers de secrets, désinstallation d'outillage système. Rien qui gêne le travail normal.

---

## C.2 — Cycle de vie d'une demande escaladée

### C.2.1 Les six états `⊣ TERMINAL`

```
      [reçue] ──arbitrée par le lead──▶ [résolue_auto]
         │
         └──escaladée──▶ [en_attente] ──verdict──▶ [répondue] ──▶ [confirmée]
                              │                                        ▲
                              ├──tour avorté──▶ [caduque]              │
                              └──redélivrée──▶ [en_attente] ───────────┘
```

`[confirmée]` est distinct de `[répondue]` **volontairement** : répondue = un verdict a été émis ; confirmée = le worker a repris. L'écart entre les deux est exactement là où se cache la panne silencieuse. Un système qui fusionne ces deux états ne peut pas détecter un agent bloqué.

### C.2.2 Invariants `⊣ TERMINAL`

| # | Invariant | Détection de violation |
|---|---|---|
| I-1 | Toute demande atteint un état terminal | Balayage périodique : `en_attente` au-delà d'un seuil ⇒ alerte |
| I-2 | Exactement un `control_response` par `request_id` | Compteur ; un deuxième envoi est un défaut |
| I-3 | Une demande redélivrée n'en crée pas une seconde | Déduplication par `request_id` |
| I-4 | Une demande caduque ne reçoit jamais de verdict | Vérifier l'état avant émission |
| I-5 | `[répondue]` sans `[confirmée]` sous seuil ⇒ alerte | C'est **le** symptôme d'agent bloqué |

### C.2.3 Le contrat hors-bande `⊣ TERMINAL` `☠ CASSE`

Mécanisme vérifié, exige **CC v2.1.199+** :

- `canUseTool` reçoit un `requestId` : c'est le `request_id` de l'enveloppe `control_request`.
- Retour normal : un `PermissionResult`, que le SDK écrit sur son transport comme `control_response`.
- Retour `null` : **uniquement** si l'application a **déjà** envoyé le `control_response` par son propre canal, en répétant ce `requestId`. Le SDK saute alors l'écriture.

`☠` **Retourner `null` dans tout autre cas laisse l'appel d'outil bloqué indéfiniment**, parce qu'aucun `control_response` n'est jamais envoyé — **et les invites de permission n'expirent pas.**

Règle absolue : **le `null` n'est retourné qu'après confirmation que l'envoi hors-bande a réussi.** Pas après l'avoir tenté. Après confirmation.

`⚠ HYP` — dans notre architecture (H-40), le chemin hors-bande sert rarement. Envisager de ne **pas** l'implémenter en v1 : répondre en `PermissionResult` classique, en acceptant que le callback attende. Ça supprime le mode de panne le plus dangereux du système. À trancher par mesure : si l'attente d'un callback dégrade le worker, alors hors-bande.

### C.2.4 Forme d'un verdict `⊣ TERMINAL`

```
allow: { behavior: 'allow',
         updatedInput?,          // entrée modifiée avant exécution
         updatedPermissions?,    // règles à persister
         toolUseID? }

deny:  { behavior: 'deny',
         message,                // OBLIGATOIRE, lu par le modèle
         interrupt?,             // stopper le tour entier
         toolUseID? }
```

Sur `deny`, le `message` est lu par le modèle : il doit expliquer **pourquoi** et **quelle alternative** est acceptable. Un refus opaque fait boucler l'agent sur des variantes de la même demande jusqu'à épuiser son budget.

`updatedPermissions` avec `suggestions` : les invites Bash fournissent une suggestion portant la destination `localSettings`. La renvoyer écrit la règle dans `.claude/settings.local.json` et **persiste entre sessions**. C'est le mécanisme d'apprentissage : une décision prise une fois ne se repose plus.

`⚠ HYP` — persister automatiquement les suggestions acceptées élargit le périmètre au fil du temps sans revue. Défaut proposé : **proposer**, ne pas persister automatiquement ; l'élargissement passe par une action explicite.

---

## C.3 — Redélivrance et déduplication

### C.3.1 Les deux chemins de redélivrance `⊣ TERMINAL`

1. **`reinitialize()`** (CC v2.1.195+) — renvoie `initialize` au CLI en cours et retourne un résultat frais au lieu du résultat de première connexion mis en cache. À utiliser **après une coupure de transport**, typiquement en se rattachant à une session après déconnexion, pour que les demandes en attente atteignent à nouveau `canUseTool`.
2. **`initialize` sur session vivante** — l'enveloppe de réponse porte un tableau optionnel `pending_permission_requests`, **sur l'enveloppe, pas dans la charge utile**. Chaque entrée est un message `control_request` complet. Le SDK lit le tableau et redispatche chaque entrée vers `canUseTool`.

### C.3.2 L'exigence d'idempotence `⊣ TERMINAL` `☠ CASSE`

Documentation explicite : **rendre le callback idempotent par identifiant de requête**, parce qu'une requête dont la réponse a été perdue est **redispatchée**.

Traduction : la table des demandes est indexée par `request_id`. À la réception :
- inconnue ⇒ créer, escalader
- connue en `[en_attente]` ⇒ **ne rien faire**, elle est déjà en file
- connue en `[répondue]` ⇒ **réémettre le verdict déjà pris**, ne pas redemander à l'humain
- connue en `[caduque]` ⇒ refuser proprement

`☠` Sans ce traitement, chaque reconnexion réseau génère un doublon de notification sur ton téléphone. Avec plusieurs équipes et un lien instable, l'UI devient inutilisable en quelques heures.

### C.3.3 Rejet d'une réponse `⊣ TERMINAL`

Pattern repris du bridge : quand une réponse est rejetée (malformée, forgée), la demande **reste éligible à la redélivrance par `initialize`**. Une acceptation est signalée séparément d'un rejet.

Conséquence : rejeter n'est pas perdre. Le système doit distinguer « verdict refusé pour cause de validation » de « verdict absent » — le premier laisse la demande vivante.

### C.3.4 Fenêtre de course sur `expectControlResponse` `⊣ TERMINAL`

L'interface `Transport` expose `expectControlResponse?(requestId)`, décrit ainsi : enregistre un `request_id` dont l'appelant attendra le `control_response` hors-bande ; les transports qui voient la source par trame (diffusion multi-clients) **devraient rejeter les `control_response` non-worker** portant cet identifiant — **seul le worker peut répondre**.

Utile ici uniquement si l'on implémente C.2.3. Le principe à retenir : dans une architecture multi-clients (téléphone + UI web + orchestrateur), il faut **une autorité unique par réponse**, sinon deux clients répondent et la deuxième réponse est soit ignorée soit source d'incohérence.

---

## C.4 — Le canal humain

### C.4.1 Durabilité `⊣ TERMINAL`

La file d'attente est **sur disque** au Pi (H-21). Justification : les demandes n'expirent pas ; le téléphone peut être éteint ; le Pi peut redémarrer. Une file en mémoire perd des demandes et bloque des équipes sans trace.

Au démarrage du Pi : recharger la file, puis pour chaque demande `[en_attente]`, vérifier que le worker correspondant vit encore. Sinon ⇒ `[caduque]`.

### C.4.2 Résumé d'une demande `⊣ TERMINAL`

Le téléphone reçoit un résumé, jamais le contexte complet (frontière de `03`). Contenu minimal :

- équipe, projet, worktree
- outil demandé, et **de quoi il s'agit en une phrase**
- `decisionReason` — l'explication fournie par le SDK sur **pourquoi** cette demande a été déclenchée
- `blockedPath` si présent — le chemin qui a déclenché la demande
- `agentID` si présent — quel sous-agent, pas seulement quelle équipe
- ancienneté
- suggestions disponibles

`⚠ HYP` — je suppose qu'un résumé structuré suffit à décider. Si tu constates que tu dois systématiquement ouvrir le transcript, alors le résumé est mal conçu : corriger le résumé, **ne pas** envoyer le contexte complet.

### C.4.3 Annulation `⊣ TERMINAL`

Repris du bridge (`sendControlCancelRequest`) : quand une demande devient caduque — tour interrompu, équipe arrêtée, worker mort — l'interface distante doit **retirer l'invite**.

Sans ça : accumulation d'invites zombies sur le téléphone, et le risque de répondre à une demande dont l'agent est mort. Le verdict part alors dans le vide et personne ne s'en aperçoit.

### C.4.4 Notification `⊣ DÉLÉGUÉ`

Le mécanisme (push, webhook, autre) dépend de la plateforme du téléphone.

Contraintes imposées :
- Déclenchée par la transition vers `requires_action`, **pas** par un sondage.
- Groupée : dix demandes de la même équipe = une notification, pas dix.
- Rappel si `[en_attente]` dépasse un seuil.
- **Silencieuse pour ce que le lead a résolu seul** — sinon H-40 ne sert à rien.

---

## C.5 — Observabilité et audit

### C.5.1 Ce qui est tracé `⊣ TERMINAL`

Chaque demande, quel que soit son sort, y compris résolue par le lead : `request_id`, équipe, agent, outil, entrée (tronquée), `decisionReason`, verdict, **auteur du verdict** (classifieur / règle / humain), horodatages de chaque transition.

`⚠ HYP` — l'entrée d'outil peut contenir des secrets. Politique de troncature et de masquage à définir par l'agent sécurité, pas ici.

### C.5.2 Ce que ça permet de répondre `⊣ TERMINAL`

- Que s'est-il passé cette nuit, et qui a autorisé quoi ?
- Le classifieur a-t-il autorisé des choses que je n'aurais pas autorisées ? **C'est la question qui valide ou invalide H-40.** Sans cette trace, on ne peut pas savoir si la délégation était une bonne idée.
- Quelles demandes reviennent assez souvent pour mériter une règle permanente ?
- Y a-t-il des demandes `[répondue]` jamais `[confirmée]` ? (I-5)

### C.5.3 Hooks de permission `⊣ TERMINAL`

`PermissionRequest` et `PermissionDenied` sont des événements de hook **distincts** de `canUseTool`. Ils voient des choses que `canUseTool` ne voit pas — notamment les demandes tranchées avant l'étage d'invite.

Utiliser `PermissionRequest` pour l'audit exhaustif, `canUseTool` pour l'arbitrage. Les deux ne sont pas redondants : les confondre produit exactement l'angle mort décrit en C.1.1.
