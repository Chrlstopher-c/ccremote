# Activation de la boucle d'apprentissage — un seul interrupteur

## Déploiement en une commande (`deployer-apprentissage.sh`)

Allumer : `./deployer-apprentissage.sh` — éteindre : `./deployer-apprentissage.sh --eteindre`.
Une fois allumé, observable par `bun harness/pilotage/pilote.ts machines` (service actif) et par
un rapport Markdown daté sous `~/.local/share/ccremote/apprentissage/rapports/` après consolidation.

`☠` Câblage E10 (PLAN-PORTAGE.md) : le déclenchement à la clôture (E6) et la consolidation
périodique (E10) obéissent tous deux à **la même variable, la même logique**. Éteint veut dire
éteint partout ; allumé veut dire les deux à la fois. Aucun autre geste n'est nécessaire.

## Comment on allume

Une machine de production pose, avant de démarrer le superviseur (`SuperviseurWorkers`) :

```bash
export CCREMOTE_APPRENTISSAGE_ACTIF=1
```

Toute valeur non vide, différente de `0` et de `false` (insensible à la casse), active le
système — voir `apprentissageActif()` dans `harness/superviseur/superviseur-workers.ts`. Absente,
vide, `0` ou `false` : éteint. C'est le comportement par défaut, celui de tous les tests.

## Ce que ça déclenche

1. **À la clôture de chaque mission** (E6) — une passe d'apprentissage : extraction de leçons
   depuis le transcript, rapprochement avec l'existant du projet, mise à jour des compteurs de
   confirmation/contradiction. Appel `void`, jamais attendu : la clôture d'une mission ne dépend
   jamais du résultat de cette passe (SPEC §1).
2. **En tâche de fond, dès la construction du superviseur** (E10) — un tick programmé toutes les
   `INTERVALLE_VERIFICATION_MS_DEFAUT` (6 h, `harness/apprentissage/service/
   consolidation-periodique.ts`) qui vérifie si les portes de `executerConsolidation` sont
   ouvertes : **au moins 7 jours** depuis la dernière passe **et aucune mission active sur la
   machine**. Le second point est lu depuis `RegistreWorkers` — la seule source honnête sur ce
   qui tourne réellement sur le PC — jamais une estimation de durée ni un compteur maison. Quand
   les deux portes s'ouvrent : transitions d'état par horloge, retrait des doublons actifs par
   similarité lexicale, sauvegarde de la base **avant** toute mutation, rapport Markdown daté
   sous `~/.local/share/ccremote/apprentissage/rapports/`.

Les deux mécanismes ne se recouvrent jamais dans le temps : la consolidation ne peut s'ouvrir
que quand `RegistreWorkers` ne porte plus aucun worker vivant, donc jamais pendant qu'une
équipe est en train d'écrire dans le corpus qu'une autre passe voudrait lire.

## Comment on éteint

```bash
unset CCREMOTE_APPRENTISSAGE_ACTIF
# ou
export CCREMOTE_APPRENTISSAGE_ACTIF=0
```

Redémarrage du superviseur requis (la variable est lue une fois, à la construction, pour décider
si le tick de consolidation démarre — pas de bascule à chaud). Une fois éteint : aucune ouverture
de `apprentissage.db`, aucun tick programmé, aucun appel au moteur d'inférence. Le comportement
redevient strictement celui d'avant E6/E10.

## Discipline non négociable, quelle que soit la position de l'interrupteur

- Aucune des deux passes ne lève jamais d'exception vers le superviseur (try/catch total,
  erreur journalisée — `harness/apprentissage/service/file-attente.ts` et
  `consolidation-periodique.ts`).
- La consolidation périodique tourne en dehors de tout chemin critique : elle est planifiée par
  `#planifier` (réel = `setTimeout`), jamais dans la boucle de surveillance des résultats qui
  ferme une mission.
- Preuve d'innocuité et de déclenchement réel : `harness/acceptation/
  apprentissage-innocuite-cloture.ts` (E6) et `harness/acceptation/
  apprentissage-consolidation-periodique-reel.ts` (E10).
