# Branche D — Transport Pi ↔ PC

**Profondeur atteinte : 4** sur la reprise, **2** sur le choix du tunnel (délégué).

**Responsabilité unique** : donner au Pi une paire stdin/stdout attachée à un processus qui tourne sur le PC, et survivre aux coupures.

`☠` **Invariant absolu (H-12)** : le transport **n'interprète jamais** le contenu du canal principal. Il relaie des octets. Toute mission qui parse ou réécrit les trames du canal principal viole la conception — remonter.

---

## D.1 — Le canal principal

### D.1.1 Ce qui transite `⊣ TERMINAL`

Le protocole entre le SDK et le binaire Claude Code, sur stdin/stdout. Le harness ne le définit pas, ne le comprend pas, ne le documente pas. Il le **déplace**.

Bénéfice : quand Anthropic fait évoluer ce protocole, le harness ne bouge pas. C'est la raison principale de H-12.

### D.1.2 Choix du tunnel `⊣ DÉLÉGUÉ`

Sur LAN de confiance (H-03), plusieurs options tiennent. Aucune n'a d'impact architectural tant que le contrat de D.1.3 est respecté.

| Option | Pour | Contre |
|---|---|---|
| SSH + `ChannelExec` | rien à écrire côté PC, auth intégrée, robuste | dépendance à la config sshd, reconnexion à gérer |
| WebSocket binaire | contrôle total, reconnexion naturelle, métadonnées faciles | serveur à écrire et sécuriser |
| TCP brut + framing | minimal, rapide | tout à écrire, y compris l'auth |

`⚠ HYP` — je penche pour **SSH** : sur LAN de confiance, il évite d'écrire un serveur, et c'est déjà installé. Mais c'est un choix d'ingénierie, pas d'architecture. **L'agent qui exécute décide sur critères mesurés** (latence de reconnexion, comportement sous coupure) et documente.

**Critère d'acceptation** : couper physiquement le lien 30 s pendant un tour actif, le rétablir, vérifier qu'aucun octet n'est perdu ni dupliqué.

### D.1.3 Contrat du tunnel `⊣ TERMINAL`

Quelle que soit l'option :

- Fournir un `Writable` (stdin) et un `Readable` (stdout) conformes à `SpawnedProcess`.
- Signaler `'exit'` avec code et signal, et `'error'`.
- Exposer `killed`, `exitCode`, `signalCode?`.
- Supporter `kill(signal)` — le signal doit atteindre le **processus distant**, pas le tunnel.
- Rapatrier stderr **par une voie séparée** (B.2.3).
- Préserver l'ordre et l'intégrité des octets. Pas de réordonnancement, pas de perte silencieuse.

`☠ CASSE` — un tunnel qui « perd » silencieusement des octets sous charge produit des trames tronquées que le SDK interprète comme corruption de protocole. Symptôme trompeur : ça ressemble à un bug du SDK. Le tunnel doit garantir l'intégrité ou échouer bruyamment.

---

## D.2 — Reprise après coupure

Section fondée sur les patterns du bridge d'Anthropic (`01`, Découverte 2).

### D.2.1 Transitoire contre terminal `⊣ TERMINAL`

Distinction **structurante**, reprise du bridge : les déconnexions passagères (503, coupures réseau) sont réessayées **indéfiniment à l'intérieur du transport** et **ne remontent pas** à l'appelant. Seul le définitif déclenche `onClose`.

Taxonomie du bridge, transposée :

| Code | Sens | Action |
|---|---|---|
| 401 | credential expiré | se rattacher avec un secret frais |
| 4090 | **epoch dépassé** — plus le worker actif | abandonner, ne **pas** reconnecter |
| 4091 | échec d'initialisation du client | terminal |
| 4092 | fermeture sans code — repli défensif, cause inconnue | terminal, à investiguer |
| 403 / 404 | rejet HTTP permanent | terminal |

`☠ CASSE` — remonter les coupures transitoires à l'orchestrateur produit un bruit constant et des relances inutiles. **Le transport absorbe le transitoire en silence.** C'est la propriété qui rend le système utilisable en mobilité.

### D.2.2 Numéro de séquence `⊣ TERMINAL`

Pattern `getSequenceNum()` / `initialSequenceNum` : le high-water mark du flux d'événements est suivi en continu et **persisté**. À la reconnexion, on le repasse et le serveur **reprend** au lieu de rejouer l'historique complet.

Application ici : ce n'est pas nécessaire pour le canal principal (les octets stdin/stdout ne se rejouent pas), mais **indispensable pour le canal d'observation** (E.2) qui alimente l'UI temps réel. Sans lui, chaque reconnexion du téléphone rejoue l'intégralité de l'historique de N équipes.

Persistance : SQLite du Pi, un high-water mark par équipe. `0` = rattachement réellement neuf.

### D.2.3 Epoch et fencing `⊣ TERMINAL`

Pattern `getEpoch()` / `reconnectTransport({epoch})` : un entier incrémenté à chaque enregistrement de worker. Le code `4090` signifie « ton epoch est dépassé, tu n'es plus le worker actif ».

**Le problème qu'il résout** : après une coupure, le Pi peut croire qu'un worker est mort et en spawner un nouveau sur le même worktree, pendant que l'ancien est en réalité vivant. Deux agents écrivent alors les mêmes fichiers.

Règle : à chaque attachement, le Pi incrémente l'epoch de l'équipe. Un worker dont l'epoch est périmé est **rejeté** et doit se terminer. C'est un verrou distribué minimal, et c'est le seul mécanisme qui protège vraiment le worktree.

Distinction vérifiée à respecter : une reconnexion pour **rafraîchissement de credential** réutilise l'epoch courant ; un **rattachement à froid** en demande un nouveau. Confondre les deux invalide le worker à chaque renouvellement de token.

`☠ CASSE` — sans fencing, le scénario « le Pi redémarre pendant que le PC travaille » produit une corruption silencieuse du worktree. C'est la panne la plus difficile à diagnostiquer du système, parce qu'elle ne produit aucune erreur : juste du code incohérent.

### D.2.4 Séquence de rattachement `⊣ TERMINAL`

Ordre imposé :

1. Le Pi demande au PC l'inventaire des workers vivants (le PC fait autorité, B.1.4).
2. Réconciliation avec le registre : marquer les fantômes, adopter les orphelins.
3. Pour chaque équipe adoptée : incrémenter l'epoch, rétablir le tunnel.
4. `reinitialize()` sur la session — récupère les demandes de permission en attente (C.3.1).
5. Reprendre le canal d'observation au high-water mark.
6. Rejouer la file de sortie retenue pendant la coupure.

`☠` L'étape 4 est celle qu'on oublie. Sans elle, les permissions demandées pendant la coupure ne réatteignent jamais `canUseTool` et les équipes concernées restent bloquées pour toujours, en apparence saines.

---

## D.3 — Canal de contrôle

### D.3.1 Ce qui ne passe pas par les flux `⊣ TERMINAL`

Distinct du canal principal, parce que ça ne concerne pas une session en particulier :

- Spawner / arrêter un worker
- Inventaire des workers vivants
- Stderr rapatrié
- Santé du PC (charge, RAM, disque)
- Métadonnées d'équipe (branche, répertoire, état)

`⚠ HYP` — un canal séparé pour le contrôle, plutôt que du multiplexage sur le canal principal. Motif : ça préserve H-12 (le canal principal reste aveugle) et ça permet de contrôler le PC même quand aucune session ne tourne.

### D.3.2 Protocole de contrôle `⊣ DÉLÉGUÉ`

Contrat imposé, implémentation libre :
- requête/réponse, idempotent par identifiant d'opération
- toute opération mutative porte un identifiant fourni par le Pi, rejouable sans effet double
- pas de notification poussée : le PC répond, il n'initie pas (sauf le canal d'observation, E.2)

**Motif de l'asymétrie** : un PC qui initie des connexions vers le Pi complique la reprise et brouille l'autorité. Le Pi commande, le PC répond.

---

## D.4 — Mode dégradé `⊣ DÉLÉGUÉ`

`⚠ HYP` H-30 non résolue : le PC est-il toujours allumé ?

Si non, il faut spécifier :
- Une file d'équipes « en attente de machine ».
- Réveil (wake-on-LAN ou équivalent).
- Ce que l'orchestrateur répond quand tu demandes une équipe et que le PC dort.

**Rappel utile** : `linux-arm64` est dans les binaires disponibles, donc le Pi **peut** exécuter Claude Code. Ça ouvre un mode dégradé « équipe légère sur le Pi » quand le PC est indisponible. Non retenu par défaut (le Pi est control plane), mais c'est une porte de sortie réelle si H-30 se révèle contraignante.

**Instruction** : ne pas spécifier tant que H-30 n'est pas tranchée. Spécifier un mode dégradé pour un problème qui n'existe pas est du gaspillage.
