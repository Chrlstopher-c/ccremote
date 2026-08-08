# Contrat du fichier de mesures

Le fichier de mesures est la **seule** frontière entre le protocole expérimental, qui produit,
et le générateur de page, qui consomme. La forme fait foi dans `experience/contrat.ts` ; ce
document dit ce que chaque champ signifie et ce qu'on a le droit d'y mettre.

**`☠` La règle qui prime sur toutes les autres.** Le générateur n'écrit aucun chiffre. Toute
valeur affichée par la page vient de ce fichier. Une donnée absente s'affiche « non mesuré » —
jamais une valeur de repli, jamais un exemple, jamais un placeholder.

## Racine

| champ | type | sens |
|---|---|---|
| `version` | `1` | change dès qu'un champ existant change de sens |
| `factice` | `boolean` | `true` ⇒ la page porte un bandeau d'avertissement inamovible, premier élément du `<body>` |
| `raisonFactice` | `string \| null` | obligatoire si `factice` ; pourquoi ces valeurs ne sont pas des mesures |
| `genereA` | `string` | date ISO de production |
| `protocole` | objet | descriptif, repris tel quel par la page |
| `executions` | tableau | une entrée par agent lancé |
| `agregats` | tableau | un par condition, dérivé des `executions` du même fichier |
| `traces` | objet | les extraits réels affichés |

## `protocole`

`modele`, `repetitionsParCondition`, `conditions`, `piege`, `tache`, `mandatMotPourMot`,
`blocsLecons` (le texte ajouté au mandat par condition, `null` pour la condition nue),
`critereSucces`, `limites` (affichées intégralement).

## `executions[]`

`id`, `condition`, `repetition`, `sessionId`, `transcript` (chemin absolu du JSONL d'où tout
sort — un lecteur sceptique doit pouvoir aller relire), `modele`, `demarreeA`, `dureeMs`,
`coutUsd` (`null` si le SDK n'en a rendu aucun), `nbTours`, `usageOutils[]`
(`{nom, appels, echecs}`), `appelsOutilsTotal`, `tentatives[]` (`{rang, commande, reussie,
survenueA}`), `tentativesAvantSucces` (`null` = la suite n'a jamais passé),
`reussiDuPremierCoup`, `succesVerifie`, `commandeLivree`.

`succesVerifie` est la seule mesure qui ne vient pas du transcript : elle vient du vérificateur
externe, qui rejoue `commandeLivree` sur une copie neuve du projet.

## `agregats[]`

`condition`, `executions`, `succesVerifie`, `reussiDuPremierCoup`, `tentativesMediane`,
`tentativesMoyenne`, `dureeMedianeMs`, `coutMoyenUsd`, `appelsOutilsMoyens`. Les médianes sont
des valeurs réellement observées, jamais interpolées, et valent `null` si aucune exécution ne
qualifie.

## `traces`

`leconMotPourMot` (le texte exact injecté), `injection` (`{transcript, ligneJsonl, extrait}` —
la preuve que la leçon est entrée dans le contexte de l'équipe), `tatonnement` et `direct`
(`{transcript, lignes[]}`, chaque ligne `{role: 'outil'|'resultat'|'texte', outil, texte}`).
Chacun peut valoir `null` ; la page affiche alors « aucune trace disponible ».

## Produire et consommer

```
# produire (lance de vraies sessions, écrit mesures.json)
REPETITIONS=5 bun run experience/protocole.ts

# consommer (n'ouvre rien d'autre que le fichier passé)
bun run page/generer-page.ts mesures.json demonstration.html
```

Le générateur valide la structure et **refuse d'écrire** si elle n'est pas conforme, en listant
ce qui manque.
