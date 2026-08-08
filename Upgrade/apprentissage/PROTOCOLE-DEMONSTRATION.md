# Protocole de démonstration — est-ce que le harness a réellement appris ?

Ce document explique le raisonnement derrière l'expérience livrée sous
`harness/acceptation/demo-apprentissage/`, et surtout ce qu'elle **ne prouve pas**.

---

## 1. La question, et pourquoi elle est difficile

« Le système a appris » est une affirmation facile à suggérer et difficile à prouver. Une
équipe qui réussit après réinjection d'une leçon ne prouve rien : elle aurait peut-être
réussi de toute façon. Un agent est bruyant — deux exécutions du même mandat ne produisent
pas la même trajectoire.

Il faut donc un dispositif qui répond à trois objections, dans l'ordre où un sceptique les pose.

**« Vous avez changé autre chose en même temps. »** La comparaison ne vaut que toutes choses
égales par ailleurs. Ici : même tâche, même projet, même modèle, même mandat **mot pour mot**.
Le mandat est une constante unique (`MANDAT_COMMUN` dans `experience/mandat.ts`), partagée par
référence entre les conditions ; la seule fonction autorisée à composer un mandat est
`mandatDe(condition)`, qui rend `MANDAT_COMMUN + (bloc de leçons ?? '')`. Il est
structurellement impossible que le texte de la tâche diverge d'une condition à l'autre.

**« Une exécution ne prouve rien. »** Vrai. Le protocole répète, et rend les chiffres **par
exécution** autant qu'agrégés — c'est la dispersion qui est intéressante, pas la moyenne.

**« Ça marche parce que la tâche est facile. »** C'est l'objection décisive, et elle exige le
**sens inverse** : leçon retirée, le tâtonnement doit revenir. Un système qui réussit dans les
deux cas n'a rien appris.

---

## 2. Le piège, et pourquoi la première version ne valait rien

Le mandat d'origine recommandait un piège de configuration plutôt qu'un piège de raisonnement.
C'est juste, mais insuffisant, et ça s'est vu à la mesure.

**Première version.** Le projet jetable `tarif-devises` porte une suite de tests qui n'a de sens
que si `banc/amorce.ts` est préchargé : `bun test --preload ./banc/amorce.ts`. Sans lui, la table
de taux n'existe pas et l'erreur remonte depuis `src/tarif.ts` — une pile qui désigne le code
métier alors que le code métier est correct. Fausse piste franche, échec déterministe, tout ce
qu'on demande à un piège.

**`☠` Ce que la mesure a dit.** 15 exécutions réelles le 2026-08-08, modèle `sonnet`. Aucun
contraste : `sans_lecon` 2, 3, 2, 3, 3 tentatives ; `avec_lecon` 5, 2, 3, 4, 2. Trois exécutions
sans aucune leçon ont écrit `bun test --preload ./banc/amorce.ts` **en première commande de test**.
La raison est simple et rétrospectivement évidente : `--preload` est une option documentée de Bun.
Ce n'était pas un savoir de ce projet, c'était de la culture générale du modèle — et une leçon
qui répète ce que le modèle sait déjà n'apporte, par construction, rien de mesurable.

**Ce que ça enseigne sur la boucle elle-même**, au-delà du protocole : une leçon n'a de valeur que
si elle porte une information que le modèle **ne peut pas reconstituer**. Une boucle
d'apprentissage qui extrait surtout des énoncés du genre « utiliser `--preload` pour précharger »
produira des leçons vraies, confirmées, actives — et inutiles. C'est un critère de qualité à
appliquer à l'extraction, pas seulement à la démonstration.

**Seconde version, celle qui est livrée.** Un second verrou, arbitraire et local : l'amorce ne
pose la table que si `BANC_JETON` vaut `ARDOISE-7719`. Cette valeur n'apparaît **nulle part** dans
le projet — le code ne compare qu'une empreinte. Aucune lecture du dépôt, aucun raisonnement,
aucune aide en ligne ne la donne. La commande complète est :

```
BANC_JETON=ARDOISE-7719 bun test --preload ./banc/amorce.ts
```

Le piège garde par ailleurs ses deux propriétés utiles : la pile d'erreur désigne `src/tarif.ts`
(fausse piste), et `docs/OUTILLAGE.md` est volontairement en retard — comme un vrai `docs/` — et
recommande une variable `TARIFS_BANC=1` que plus aucune ligne ne lit depuis la version 0.3.0.

Vérifié en réel avant toute exécution d'agent, les quatre cas :

| commande | verdict |
|---|---|
| `BANC_JETON=ARDOISE-7719 bun test --preload ./banc/amorce.ts` | passe |
| `bun test --preload ./banc/amorce.ts` | échoue |
| `TARIFS_BANC=1 bun test` (ce que dit la doc) | échoue |
| `bun test` | échoue |

---

## 3. Ce qui est mesuré, et d'où ça sort

Tout vient des **transcripts JSONL réels** écrits par le CLI, jamais d'une estimation ni d'une
déclaration de l'agent (`experience/extraction-jsonl.ts`) :

- **tentatives avant succès** — rang de la première invocation de la suite de tests dont le
  `tool_result` n'est pas en erreur et annonce des tests passés. Les invocations sont repérées
  par les blocs `tool_use` de nom `Bash` dont la commande contient un marqueur de test ;
- **réussi du premier coup** — `tentativesAvantSucces === 1`. Le fait binaire ;
- **appels d'outils**, par nom, et leurs échecs (`tool_result` portant `is_error`) ;
- **durée** — dernier moins premier `timestamp` du transcript ;
- **coût** — `total_cost_usd` du message `result` du SDK ;
- **tours** — nombre d'entrées `assistant`.

Et une mesure qui ne vient **pas** du transcript, délibérément : **succès vérifié**. Le
vérificateur (`experience/verification.ts`) prépare une copie neuve du projet, y exécute la
commande livrée dans `COMMANDE.md`, et n'accepte que le code de sortie 0 avec le compte exact de
tests passés. Il ignore tout ce que l'agent a pu faire dans son propre répertoire. C'est ce qui
rend la tâche non contournable : le mandat interdit de modifier le projet, et la vérification
rend cette interdiction sans conséquence à enfreindre.

**`☠` Un fait de terrain, à savoir avant de chercher un transcript.** La clé de projet du CLI
n'est pas le simple remplacement des séparateurs de chemin : un `cwd` contenant `sans_lecon` a
produit le dossier `…-sans-lecon-…`. La normalisation va plus loin que ce que reproduit
`cleProjet()` dans `superviseur/sous-agents-disque.ts`, et la règle exacte n'est pas documentée.
`resoudreTranscript()` ne devine pas cette règle : elle cherche le fichier par son `sessionId`,
qui est stable et unique.

---

## 4. Les trois conditions

| condition | mandat | rôle |
|---|---|---|
| `sans_lecon` | nu | le **sens inverse** : leçon retirée, le tâtonnement doit revenir |
| `avec_lecon` | + bloc portant la leçon du piège | le sens positif |
| `lecon_hors_sujet` | + bloc de même forme, sans rapport | contrôle placebo |

Le placebo n'était pas demandé, et il est ce qui distingue « la leçon aide » de « un bloc de texte
en plus met l'agent en alerte ». Sans lui, un sceptique a raison de dire qu'on a mesuré l'effet
d'avoir rallongé le mandat. Son bloc a la même structure, la même en-tête, la même mention de
provenance et un ordre de longueur comparable.

Les exécutions sont **entrelacées** — répétition 1 des trois conditions, puis répétition 2, etc.
Une dérive dans le temps (charge de la machine, variation côté service) frappe alors les trois
conditions également au lieu de se confondre avec l'une d'elles.

---

## 5. Combien de répétitions, et pourquoi

Le plan était **5 par condition**. Raison : l'effet attendu est binaire et net (réussi du premier
coup, oui ou non), donc l'événement qui compte est une séparation parfaite entre deux conditions.
Sous l'hypothèse nulle — la leçon ne change rien —, la probabilité d'observer une séparation
parfaite 5 contre 5 au test exact de Fisher est de 1 sur C(10,5) = **1/252 ≈ 0,004**. C'est le
plus petit effectif qui passe sous le seuil de 1 %, et donc le point où le coût cesse d'acheter
de la conviction.

Le budget de la session a tranché autrement : la première campagne de 15 exécutions a été dépensée
pour découvrir que le piège n'en était pas un — un résultat qui valait ce qu'il a coûté, mais qui a
consommé la marge. La campagne livrée est à **3 par condition**, soit 9 exécutions, où une
séparation parfaite 3 contre 3 vaut **1/20 = 0,05**. C'est un seuil de conviction plus faible, et
il faut le dire ainsi plutôt que le maquiller : l'expérience montre un effet, elle ne le mesure pas
finement. Relancer à 5, voire 10, ne demande qu'une variable d'environnement et environ un dollar :

```
REPETITIONS=5 bun run harness/acceptation/demo-apprentissage/experience/protocole.ts
```

---

## 6. Ce que l'expérience ne prouve pas

Ces limites sont dans `experience/mandat.ts` (`LIMITES`) et la page les affiche **intégralement**,
au même niveau typographique que les résultats. Elles ne sont pas des réserves de politesse.

1. **Elle mesure la réinjection, pas l'extraction.** La leçon servie est écrite à la main. Qu'un
   modèle sache la produire à partir d'un historique réduit est une autre question.
2. **Un seul piège, d'un seul genre** — une configuration absente. Rien ne dit qu'une leçon de
   méthode produirait le même écart.
3. **Aucun effet de long terme** : ni la dérive d'une leçon devenue fausse, ni le coût d'un bloc
   de leçons qui grossit, ni deux leçons contradictoires.
4. **L'effectif est petit.** Un écart net sur peu d'exécutions dit qu'il y a un effet, pas sa
   taille. Les moyennes rendues sont descriptives.
5. **Le vérificateur juge la commande, pas la compréhension.** Deviner compte comme réussir.
6. **`☠` Le savoir en jeu est arbitraire**, donc c'est le cas le plus favorable au système.
   L'écart mesuré est un **majorant**, pas une moyenne attendue. Une leçon qui répète ce que le
   modèle sait déjà ne produit aucun écart — c'est précisément ce que la première campagne a
   montré, et c'est la mise en garde la plus utile de tout ce document.

---

## 7. Où sont les choses

| | |
|---|---|
| protocole exécutable | `harness/acceptation/demo-apprentissage/experience/protocole.ts` |
| projet jetable et piège | `experience/projet-piege.ts` |
| mandat mot pour mot, blocs de leçons, limites | `experience/mandat.ts` |
| extraction depuis les JSONL | `experience/extraction-jsonl.ts` |
| vérificateur externe | `experience/verification.ts` |
| contrat du fichier de mesures | `experience/contrat.ts` et `CONTRAT-MESURES.md` |
| générateur de page | `page/generer-page.ts` |
| page produite | `demonstration.html` |
