# Grille de revue — pannes silencieuses

Consolidation de tous les `☠ CASSE` du paquet. **Un seul critère de sélection** : ce qui casse *sans produire d'erreur*.

**Usage** : chaque ligne est une question à poser en revue de mission. Une réponse « je crois que oui » vaut « non » — ces défauts se caractérisent tous par le fait qu'ils ne se voient pas.

**Pourquoi ce fichier existe** : dans un système autonome, la panne bruyante est bénigne — tu la vois, tu corriges. C'est la panne muette qui coûte, parce qu'elle se découvre des jours plus tard, après que du travail a été bâti dessus ou perdu.

---

## Rang 1 — invalident le travail déjà fait

Détectées tard, elles obligent à défaire.

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 1 | Générateur d'entrée fermé pendant que Claude travaille | `canUseTool` et les hooks cessent d'être appelés. **Le reste fonctionne**, donc ça ressemble à un bug de permissions. Seule trace : `Error: Stream closed` sur stderr | M-02 | A.1.3 |
| 2 | Pas de fencing par epoch | Deux workers sur un worktree après redémarrage du Pi. **Aucune erreur** — juste du code incohérent, découvert des jours après | M-11 | D.2.3, F.2.2 |
| 3 | `reinitialize()` absent de la séquence de rattachement | Les permissions demandées pendant la coupure ne réatteignent jamais `canUseTool`. Les équipes restent bloquées **en paraissant saines** | M-30 | D.2.4 |
| 4 | `listSubkeys` non implémentée | La reprise ne matérialise que le transcript principal. **Perte totale de l'historique des sous-agents, sans erreur** | M-63 | H.3.5 |
| 5 | Registre dimensionné pour des équipes durables | Le régime réel est « N missions courtes × rétention ». Modèle de données à refaire | M-03, M-61 | F2.0.1 |

---

## Rang 2 — perte de données ou de travail

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 6 | Conflit **sémantique** résolu par l'agent d'intégration | Le code compile, les tests passent peut-être, et une décision d'une autre mission **a disparu** | M-62 | H.1.4 |
| 7 | Compression appliquée à la vérité (disque PC) | Le miroir est déjà lacunaire par conception. Compresser en croyant compresser la source ⇒ perte irrécupérable | M-63 | H.3.1 |
| 8 | `delete` non implémentée sur le store | Les suppressions sont acceptées **sans rien supprimer et sans erreur** | M-63 | H.3.4 |
| 9 | Worktree supprimé avec travail non commité | Perte définitive | M-32 | F.2.3 |
| 10 | Association worktree enregistrée **après** le spawn | Fenêtre où un worker tourne sans association. Redémarrage du Pi dans cette fenêtre ⇒ orphelin | M-32 | F.2.1 |
| 11 | Orphelin ignoré à la réconciliation | Consomme budget et écrit des fichiers **sans apparaître nulle part** | M-30 | E.1.4 |

---

## Rang 3 — coût ou dérive

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 12 | Échec **structurel** relancé automatiquement | Boucle qui consomme le budget sans jamais aboutir. Le mode le plus coûteux d'un parc non surveillé | M-34 | B.3.2 |
| 13 | `budget_exhausted` relancé automatiquement | Annule le garde-fou. Facile à commettre : la relance est légitime pour d'autres raisons terminales | M-34, M-51 | G.1.1 |
| 14 | `critere_arret` non testable dans un mandat | La mission consomme tout son budget sans conclure. **Se multiplie par le nombre de missions du lot** | M-61 | F2.1.2 |
| 15 | `CLAUDE_CODE_RETRY_WATCHDOG=1` sans budget actif | Retentatives indéfinies, dépense non bornée | M-51 | B.3.1, G.1.4 |
| 16 | Avertissement d'usage traité comme erreur | Des équipes s'arrêtent sans raison. Les trois catégories de préfixes sont distinctes | M-51 | E.4.3 |
| 17 | Flux brut routé vers l'orchestrateur | Contexte saturé en quelques heures, compactions répétées, perte de qualité | M-41, M-42 | H-45, E.2.1 |

---

## Rang 4 — configuration et permissions

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 18 | `settingSources: []` ajouté « pour être déterministe » | Config machine neutralisée en silence. Le `CLAUDE.md` du poste n'est plus lu | M-01 | H-44 |
| 19 | `env` fourni sans `...process.env` | `env` **remplace** au lieu de fusionner. `PATH` perdu ⇒ git, node, credentials introuvables | M-01 | B.1.3 |
| 20 | Plancher Sonnet validé sur l'alias | `'inherit'` ne garantit rien. Valider sur le **modèle résolu** | M-01 | H-43 |
| 21 | Nom d'outil nu dans le plancher de déni | Ampute la capacité au lieu de borner le danger. Seules les règles **scopées** survivent à tous les modes | M-20 | C.1.3 |
| 22 | Plancher jamais testé | Un motif mal écrit ne refuse rien **et ne produit aucune erreur**. C'est une croyance, pas un garde-fou | M-20 | G.2.3 |
| 23 | `canUseTool` utilisé pour l'audit exhaustif | N'est appelé qu'à l'étage d'invite. Angle mort sur tout ce qui est auto-approuvé ⇒ fausse impression de couverture. Utiliser `PreToolUse` | M-22 | C.1.1 |
| 24 | Retour `null` sans envoi hors-bande confirmé | Aucun `control_response` n'est jamais envoyé, **et les invites n'expirent pas**. Agent bloqué indéfiniment | M-23 | C.2.3 |
| 25 | Demande redélivrée non dédupliquée | Doublon de notification à chaque reconnexion. Avec plusieurs équipes et un lien instable, l'UI devient inutilisable | M-21 | C.3.2 |
| 26 | Prompt système modifié via `applyFlagSettings()` | **L'appel réussit, la valeur ne change pas.** Changer un mandat exige une nouvelle session | M-60 | F2.3.2 |

---

## Rang 5 — transport et état

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 27 | Tunnel perdant des octets sous charge | Trames tronquées, interprétées comme corruption de protocole. **Ressemble à un bug du SDK** | M-10 | D.1.3 |
| 28 | Coupures transitoires remontées à l'orchestrateur | Bruit constant, relances inutiles. Le transport doit les absorber en silence | M-12 | D.2.1 |
| 29 | Contre-pression d'un client lent jusqu'au worker | L'agent ralentit parce que quelqu'un a une mauvaise connexion | M-12 | E.2.3 |
| 30 | États SDK et états harness dans un seul champ | Réconciliation impossible : on ne sait plus qui fait autorité | M-03 | E.1.1 |
| 31 | `mtime` du sidecar dérivé des horodatages d'entrées | Annule le contrôle de fraîcheur. Estampiller **à la persistance** | M-63 | H.3.2 |
| 32 | File d'attente « pour plus tard » sans réveil | Missions qui dorment indéfiniment sans que personne ne le sache | — clos | H.2.2 |
| 33 | Arrêt d'urgence passant par l'orchestrateur | Inutilisable exactement quand il faut : quand l'orchestrateur déraille | M-52 | G.4.1 |

---

## Rang 6 — process

| # | Défaut | Symptôme trompeur | Mission | Réf. |
|---|---|---|---|---|
| 34 | Paquet complet donné à chaque agent | Contextes saturés, interventions hors périmètre — le défaut même que ce harness existe pour éviter | — | 12 |
| 35 | Validation court-circuitée pour un projet auto-créé | « C'est nous qui l'avons écrit » ⇒ config invalide qui échoue au spawn, bien plus tard | M-60 | F2.2.2 |
| 36 | Intégration déclenchée avec une mission encore active | Fusion sur base mouvante | M-62 | H.1.2 |
| 37 | API disparue : `TeamCreate`, `TeamDelete`, `team_name` | Supprimés en CC v2.1.178. Travail sur une surface qui n'existe plus | M-01 | F.3.2 |
| 38 | API supprimée : `unstable_v2_*` | Retirée en SDK 0.3.142. **Encore recommandée par des articles récents** | tous | 01 |

---

## Résumé par mission

Nombre de pannes silencieuses dont chaque mission est responsable. **Sert à calibrer l'effort de revue**, pas à ordonnancer.

| Mission | Pannes | Rangs |
|---|---|---|
| M-63 rétention | 5 | 1, 2, 2, 3, 5 |
| M-01 squelette worker | 4 | 4, 4, 4, 6 |
| M-34 relance | 2 | 3, 3 |
| M-30 réconciliation | 2 | 1, 2 |
| M-32 projets | 2 | 2, 2 |
| M-51 budgets | 3 | 3, 3, 3 |
| M-62 intégration | 2 | 2, 6 |
| M-12 transport | 2 | 5, 5 |
| M-03 registre | 2 | 1, 5 |
| M-20 plancher | 2 | 4, 4 |
| M-02, M-10, M-11, M-21, M-22, M-23, M-41/42, M-52, M-60, M-61 | 1 chacune | — |

**M-63 concentre le plus de pannes silencieuses du paquet**, et quatre d'entre elles portent sur de la perte de données. C'est la mission qui mérite la revue la plus attentive, alors qu'elle n'est ni sur le chemin critique ni intuitivement risquée.

---

## Trois questions de revue finale

À poser avant de déclarer M-53 satisfaite.

1. **Chaque `☠` de cette grille a-t-il un test qui échoue si le défaut est réintroduit ?** Une revue de code ne suffit pas : ces défauts ne se voient pas à la lecture.
2. **Le système a-t-il tourné une nuit entière sans intervention, avec budgets et plancher actifs ?** C'est le seul test qui exerce simultanément l'autonomie, la reprise et le bornage.
3. **La trace d'audit permet-elle de répondre à « le classifieur `auto` a-t-il autorisé quelque chose que je n'aurais pas autorisé » ?** C'est ce qui valide ou invalide H-40, la décision la plus structurante du paquet. Sans cette réponse, la délégation reste un pari.
