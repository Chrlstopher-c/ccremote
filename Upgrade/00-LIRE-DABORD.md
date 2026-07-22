# Harness d'orchestration Claude Code — Spécification

**Cible** : Raspberry Pi (control plane) + PC de travail (workers), LAN de confiance, TypeScript.
**Objet** : une conversation générale avec Claude qui pilote plusieurs équipes d'agents Claude Code, sur plusieurs projets, en parallèle, à distance.

**État** : spécification. Aucun fichier ici n'est du code d'implémentation. Les rares blocs typés sont des **contrats** (formes de données, signatures d'interface), pas des implémentations, et chacun est vérifié contre le SDK réel — voir `01-verification-sdk.md`.

---

## Ordre de lecture

| Fichier | Rôle | Pour qui |
|---|---|---|
| `01-verification-sdk.md` | Faits vérifiés contre le SDK installé. **Trois découvertes qui changent l'archi.** | Tout le monde. À lire en premier. |
| `02-hypotheses.md` | Ce que j'ai décidé à ta place, et ce que tu as tranché. Réversible ou non. | Toi, avant de lancer quoi que ce soit. |
| `03-couche-1.md` | L'architecture de niveau 1. Sept composants, leurs frontières. | Tout le monde. |
| `04` → `10` | Branches A à G. Descente en profondeur, une par fichier. | L'agent assigné à la branche. |
| `13-arbre-F2-cycle-projet.md` | Création/modification de projet, modèle de dispatch. **Prolonge la branche F.** | Agents F2 (M-60, M-61). |
| `14-arbre-H-integration-retention.md` | Mission d'intégration, disponibilité machine, rétention et compression. | Agents H (M-62, M-63, M-64). |
| `11-missions.md` | Ordres de mission exécutables, un par feuille terminale. | L'orchestrateur. |
| `12-graphe-dependances.md` | Qui dépend de qui, ce qui part en parallèle, conditions d'échec. | L'orchestrateur. |
| `15-grille-revue.md` | Les 38 pannes silencieuses du paquet, par rang de gravité. | **Toute revue de mission.** |

**Ordre de construction du paquet** : les fichiers `04` → `12` ont été écrits avant que les questions H-30, H-32 et H-33 soient tranchées. Les fichiers `13`, `14` et `15` intègrent ces décisions et, en cas de contradiction, **font autorité**. Les points concernés sont signalés dans les fichiers antérieurs.

---

## Conventions de notation

**Identifiants de nœud** : `A.2.3` = branche A, niveau 2, sous-nœud 3. Stables — les missions y font référence.

**Marqueurs de fin de descente** :

- `⊣ TERMINAL` — la feuille est spécifiée jusqu'au contrat. L'étape suivante est d'écrire du code. Descendre plus loin produirait de l'implémentation.
- `⊣ DÉLÉGUÉ` — la feuille est confiée à un agent qui devra la re-décomposer lui-même, parce que sa décomposition dépend d'un choix technique que je n'ai pas les moyens de trancher à froid.
- `⊣ HORS-PÉRIMÈTRE` — volontairement pas spécifié. La raison est donnée.

**Marqueurs de risque** :

- `⚠ HYP` — hypothèse contestable. L'agent qui exécute a le **droit et le devoir** de la contester s'il constate qu'elle est fausse, plutôt que de l'appliquer.
- `⚠ ALPHA` — s'appuie sur une API que le SDK marque alpha ou expérimentale. À isoler derrière une couche d'adaptation.
- `☠ CASSE` — piège connu qui casse le système silencieusement. Non négociable.

**Profondeur** : elle n'est **pas uniforme, et c'est délibéré.** La profondeur est proportionnelle au risque. Le bus de permissions (branche C) descend à 5 niveaux parce que c'est là que le système casse. Le logging s'arrête à 2. Chaque branche porte une note « pourquoi ça s'arrête ici ».

---

## Comment donner ça à l'orchestrateur

Ce paquet est conçu pour être consommé par un orchestrateur qui délègue à des sous-agents. Séquence recommandée :

1. Donne-lui `01`, `02`, `03` en contexte permanent. C'est le socle partagé — tout agent doit l'avoir.
2. Donne-lui `12-graphe-dependances.md` pour qu'il ordonnance.
3. Pour chaque mission de `11-missions.md`, il spawn un agent avec : le socle + **le seul fichier de branche concerné** + l'ordre de mission. Pas tout le paquet — c'est le point qui évite l'explosion de contexte.

**Règle à imposer aux sous-agents** : une mission qui rencontre une `⚠ HYP` fausse **remonte** au lieu d'improviser. Une hypothèse fausse propagée sur six niveaux coûte plus cher que l'aller-retour.

---

## Ce que ce paquet ne couvre pas

- **L'implémentation.** Par construction.
- **Le choix du gestionnaire de paquets, du runner de tests, du linter.** Décisions sans conséquence architecturale, laissées aux agents.
- **Le provisioning du Pi et du PC** (OS, systemd, réseau). Voir `⊣ HORS-PÉRIMÈTRE` en branche B.
- **Le coût réel en tokens.** Non estimable à froid ; la branche G spécifie les instruments pour le mesurer, pas une prévision.
