/**
 * Responsabilité : le mandat des cobayes, mot pour mot, et les blocs de leçons qui
 * constituent la SEULE différence entre conditions.
 *
 * `☠` `MANDAT_COMMUN` est une constante unique. Les trois conditions la partagent par
 * référence, pas par copie : il est structurellement impossible que le texte de la tâche
 * diverge d'une condition à l'autre. Le mandat servi est toujours
 * `MANDAT_COMMUN + (bloc de la condition ?? '')`, et rien d'autre.
 *
 * Le format du bloc de leçons reprend celui de la SPEC (§1, §5.7) : énoncé court,
 * catégorie, provenance, nombre de confirmations. Une leçon servie porte sa provenance.
 */

import type { Condition } from './contrat.ts';

/**
 * La tâche. Elle interdit de modifier le projet : le livrable est la COMMANDE, pas un
 * correctif. C'est ce qui rend le succès vérifiable hors de l'agent — le vérificateur
 * rejoue la commande sur une copie fraîche, donc aucun contournement local ne compte.
 */
export const MANDAT_COMMUN = `Tu travailles seul, sans interlocuteur humain : personne ne lira ce fil pendant que tu \
travailles, et aucune question posée ici n'obtiendra de réponse. Tranche seul.

Le répertoire de travail courant contient le projet \`tarif-devises\`. Sa suite de tests \
ne passe pas en l'état.

TA TÂCHE : trouver la commande exacte qui fait passer l'INTÉGRALITÉ de la suite de tests, \
et l'écrire dans un fichier \`COMMANDE.md\` à la racine du projet. Ce fichier ne contient \
que la commande, sur une seule ligne, sans bloc de code ni commentaire.

CONTRAINTE : tu ne modifies, ne crées et ne supprimes AUCUN autre fichier du projet. \
Les sources et les tests sont corrects et sont la responsabilité d'une autre équipe. \
Toute modification que tu ferais serait ignorée : ta commande sera rejouée sur une copie \
neuve du projet.

CRITÈRE D'ARRÊT : \`COMMANDE.md\` existe et contient une commande qui, exécutée à la racine \
d'une copie neuve du projet, fait passer les 3 tests. Dès que tu as vérifié cela, tu \
t'arrêtes et tu rends la commande dans ton dernier message.`;

/**
 * La leçon du piège, mot pour mot. C'est ce texte exact qui est affiché par la page et
 * ce texte exact qui entre dans le mandat de la condition `avec_lecon`.
 */
export const LECON_DU_PIEGE =
  'Sur ce projet, la suite de tests exige DEUX choses : le préchargement du banc de taux ' +
  'et le jeton du banc, qui vaut `ARDOISE-7719` et ne figure nulle part dans le dépôt. ' +
  'La commande est `BANC_JETON=ARDOISE-7719 bun test --preload ./banc/amorce.ts`. ' +
  "Sans le jeton, l'amorce ne pose pas la table et l'erreur remonte depuis `src/tarif.ts` " +
  "— le code métier n'est pas en cause. `docs/OUTILLAGE.md` est en retard et recommande " +
  'une variable `TARIFS_BANC` que plus aucune ligne ne lit.';

/**
 * La leçon du contrôle placebo : même forme, même longueur d'ordre, aucune information
 * sur le piège. Elle sépare « la leçon aide » de « un bloc de texte en plus met en alerte ».
 */
export const LECON_HORS_SUJET =
  'Sur ce projet, les journaux de build sont écrits sous `var/journaux/` et purgés à ' +
  "chaque installation de dépendances : relever une trace avant de relancer `bun install`, " +
  "sinon la trace de l'échec précédent est perdue et le diagnostic repart de zéro.";

function blocLecons(enonce: string, categorie: string, mission: string): string {
  return `

LEÇONS ACTIVES POUR CE PROJET — réinjectées par le harness, confirmées par deux missions \
distinctes. Elles ne sont pas des ordres : ce sont des constats déjà payés par d'autres \
équipes sur ce même projet.

- [${categorie}] ${enonce}
  (confirmée 2 fois · dernière observation : mission ${mission})`;
}

/** Le bloc ajouté au mandat, par condition. `null` = mandat nu, aucune addition. */
export const BLOCS_LECONS: Readonly<Record<Condition, string | null>> = {
  sans_lecon: null,
  avec_lecon: blocLecons(LECON_DU_PIEGE, 'piege', 'm-4f21'),
  lecon_hors_sujet: blocLecons(LECON_HORS_SUJET, 'projet', 'm-7c08'),
};

/** Le mandat effectivement servi à un cobaye. Seule fonction autorisée à composer un mandat. */
export function mandatDe(condition: Condition): string {
  const bloc = BLOCS_LECONS[condition];
  return bloc === null ? MANDAT_COMMUN : MANDAT_COMMUN + bloc;
}

/** Ce que l'expérience ne prouve pas — rendu intégralement par la page. */
export const LIMITES: readonly string[] = [
  "Elle mesure la RÉINJECTION, pas l'EXTRACTION. La leçon servie ici est écrite à la main, " +
    "mot pour mot dans `mandat.ts` ; le fait qu'un modèle sache la produire à partir d'un " +
    'historique réduit est une autre question, testée ailleurs.',
  "Elle porte sur UN piège, d'un seul genre — une configuration d'environnement absente. " +
    "Rien ici ne dit qu'une leçon de méthode ou de raisonnement produirait le même écart.",
  'Elle ne mesure aucun effet de long terme : ni la dérive d\'une leçon devenue fausse, ni le ' +
    "coût d'un bloc de leçons qui grossit à chaque mission, ni ce qui se passe quand deux " +
    'leçons se contredisent.',
  "L'effectif est petit. Un écart net sur peu d'exécutions dit qu'il y a un effet, pas quelle " +
    "en est la taille exacte : les moyennes rendues sont descriptives, pas des estimations.",
  "Le vérificateur juge la commande livrée, pas la compréhension : un agent qui devine la " +
    'bonne commande sans avoir compris le piège compte comme un succès.',
  "Le savoir en jeu est ARBITRAIRE — une valeur locale que rien ne permet de déduire. " +
    "C'est le cas où une leçon apporte le plus, et donc le cas le plus favorable au " +
    "système : l'écart mesuré ici est un majorant, pas une moyenne attendue.",
];
