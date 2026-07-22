# Graphe de dépendances et ordonnancement

Destiné à l'orchestrateur. Détermine ce qui part en parallèle et ce qui bloque.

---

## Graphe

```
LOT 0 — SOCLE (bloquant total)
  M-01 squelette worker ──┬──────────────────────────────┐
  M-02 générateur entrée ─┤                              │
  M-03 registre ──────────┤                              │
  M-04 harnais de test ───┘                              │
        │                                                │
        ├──────────────┬─────────────────┐               │
        ▼              ▼                 ▼               │
   LOT 1          LOT 2             LOT 3                │
   TRANSPORT      PERMISSIONS       ÉTAT+PROJETS         │
   M-10 tunnel    M-20 plancher     M-30 réconciliation ◀┘ (besoin M-10)
   M-11 fencing◀──┐                 M-31 sessionstore
   M-12 séquence  │M-21 états dem.  M-32 projets ◀── M-11
   M-13 contrôle  │M-22 audit       M-33 pause
                  │M-23 escalade    M-34 relance
                  │
                  └── M-32 dépend de M-11 (fencing worktree)
        │              │                 │
        └──────────────┴────────┬────────┘
                                ▼
                         LOT 4 — ORCHESTRATEUR
                         M-40 MCP contrôle
                         M-41 session
                         M-42 contexte
                                │
                                ▼
                         LOT 5 — SURFACE + SÛRETÉ
                         M-50 UI    M-51 budgets
                         M-52 arrêt d'urgence
                                │
                                ▼
                         LOT 6 — CYCLE DE PROJET
                         M-60 création/modif ◀── M-32
                         M-61 dispatch + lots ◀── M-03 (renotifiée)
                         M-62 intégration ◀── M-61
                         M-63 rétention ◀── M-31
                         M-64 condensation ◀── M-63
                                │
                                ▼
                         M-53 VALIDATION ── déclare le harness terminé
```

---

## Chemin critique

```
M-02 → M-10 → M-11 → M-32 → M-40 → M-61 → M-62 → M-53
```

Huit missions. Tout le reste peut glisser sans retarder la livraison.

**M-02 est en tête et ce n'est pas intuitif.** Le générateur d'entrée persistant paraît trivial. C'est le défaut qui casse `canUseTool` et les hooks **en silence** : tout ce qui est construit avant est invalide, et personne ne s'en aperçoit avant d'avoir bâti trois lots dessus.

**M-11 (fencing) est le deuxième point non intuitif.** Il ressemble à une optimisation. C'est le seul mécanisme qui empêche la corruption silencieuse de worktree — une panne qui ne produit **aucune erreur**, juste du code incohérent, découverte des jours plus tard.

**M-62 (intégration) est le troisième, et il est nouveau.** Il est entré sur le chemin critique quand le dispatch multi-missions a été confirmé. C'est le seul endroit du système où un agent arbitre entre les décisions de deux autres agents. Le risque n'est pas qu'il échoue — c'est qu'il réussisse en perdant silencieusement une décision.

---

## Parallélisation

| Vague | En parallèle | Agents |
|---|---|---|
| 1 | M-01, M-02, M-03, M-04 | 4 |
| 2 | M-10, M-20, M-21, M-22, M-31, M-34 | 6 |
| 3 | M-11, M-12, M-13, M-23, M-33 | 5 |
| 4 | M-30, M-32 | 2 |
| 5 | M-40, M-41, M-42 | 3 |
| 6 | M-50, M-51, M-52 | 3 |
| 7 | M-60, M-61, M-63 | 3 |
| 8 | M-62, M-64 | 2 |
| 9 | M-53 | 1 |

**Vague 2 est la plus large.** Si le parallélisme est limité, prioriser M-10 (chemin critique) et M-20 (garde-fou minimal avant toute exécution non surveillée).

`⚠` **Ne pas lancer d'exécution non surveillée avant M-20 et M-51.** Le plancher de déni et les budgets sont ce qui rend le parc sûr en autonomie. Développer sans eux est acceptable ; laisser tourner une nuit sans eux ne l'est pas.

---

## Points de synchronisation

| Après | Vérifier avant de continuer |
|---|---|
| Vague 1 | Un worker démarre, `canUseTool` est appelé après 10 min de silence, le harnais de pannes fonctionne |
| Vague 3 | Coupure de 30 s sans perte ni doublon ; un seul worker par worktree |
| Vague 4 | Redémarrage du Pi pendant un tour actif ⇒ réconciliation correcte, permissions récupérées |
| Vague 6 | Arrêt d'urgence fonctionnel, budgets actifs |
| Vague 7 | Ajouter un projet = déposer un fichier ; un mandat sans critère d'arrêt testable est refusé ; `listSubkeys` et `delete` implémentées |
| Vague 8 | **Test précoce de M-62** : l'agent distingue-t-il conflit textuel et sémantique sur un cas réel ? Si non ⇒ appliquer le repli documenté en H.1.4 **avant** de continuer |

Un point de synchronisation non validé **bloque la vague suivante**. Passer outre revient à construire sur un défaut connu.

---

## Ce que l'orchestrateur doit donner à chaque agent

| Élément | Toujours | Motif |
|---|---|---|
| `01-verification-sdk.md` | oui | évite de re-supposer, contient les pièges versionnés |
| `02-hypotheses.md` | oui | permet de contester une `⚠ HYP` |
| `03-couche-1.md` | oui | frontières et invariants |
| `15-grille-revue.md` | oui | les pannes silencieuses dont la mission est responsable |
| Le fichier de branche concerné | **un seul** | c'est ce qui évite l'explosion de contexte |
| L'ordre de mission | oui | — |
| Les autres fichiers de branche | **non** | — |

Correspondance mission → fichier de branche :

| Missions | Fichier |
|---|---|
| M-01, M-33, M-34 | `05-arbre-B-workers.md` |
| M-02, M-40, M-41, M-42 | `04-arbre-A-orchestrateur.md` |
| M-10 → M-13 | `07-arbre-D-transport.md` |
| M-20 → M-23 | `06-arbre-C-permissions.md` |
| M-03, M-30, M-31 | `08-arbre-E-etat-observabilite.md` |
| M-32, M-50 | `09-arbre-F-projets-equipes.md` |
| M-51, M-52 | `10-arbre-G-gardefous.md` |
| M-60, M-61 | `13-arbre-F2-cycle-projet.md` |
| M-62, M-63, M-64 | `14-arbre-H-integration-retention.md` |
| M-04, M-53 | tous, en lecture — c'est l'exception |

`☠` Donner tout le paquet à chaque agent sature les contextes et produit des interventions hors périmètre — exactement le défaut que ce harness existe pour éviter.

---

## Conditions d'échec du projet

Signaux qui justifient d'arrêter et de reconcevoir, plutôt que de continuer :

1. **M-02 ne peut pas être satisfaite** — si `canUseTool` ne peut pas être maintenu fiable, tout le modèle de permissions s'effondre. Reconcevoir autour de hooks `PreToolUse` seuls.
2. **Le tunnel ne garantit pas l'intégrité des octets** — H-12 tombe, il faut un protocole applicatif, ce qui invalide la branche D entière.
3. **Le classifieur `auto` autorise des choses inacceptables** — visible dans la trace de M-22. H-40 tombe, retour à l'arbitrage humain, la branche C redevient chemin critique.
4. **Le contexte de l'orchestrateur sature malgré H-45** — passer en A.4.1 option (b), rotation avec reconstruction d'état.
5. **Agent Teams se révèle inutilisable en reprise de session** — H-14 s'applique globalement, toutes les équipes en solo+subagents. Sans impact sur l'architecture.
6. **L'agent d'intégration ne distingue pas conflit textuel et sémantique** — visible au test précoce de M-62. Repli : escalader tout conflit non trivial. Dégrade l'autonomie sur le dernier maillon, ne casse pas l'architecture. **C'est le repli le plus probable des six.**

Les cinq sont détectables **avant** la fin du projet, par les tests des missions concernées. C'est le but des points de synchronisation : découvrir tôt, pas à la livraison.
