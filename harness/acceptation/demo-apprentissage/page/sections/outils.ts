/**
 * Responsabilité : « Les outils qu'une équipe a appelés » — usage cumulé des outils par
 * condition, sommé sur les exécutions de cette condition, en barres monochromes triées
 * par nombre d'appels décroissant. Échelle calculée depuis les données.
 */

import type { Condition, Execution, FichierMesures } from '../../experience/contrat.ts';
import { echelleLineaire, maxDe, ouvrirSvg, rectangleSvg, texteSvg } from '../svg.ts';
import { couleurCondition, echapper, libelleCondition, section } from '../utils.ts';
import { groupesParCondition } from './mesures-communs.ts';

const LARGEUR_BARRE_MAX = 260;
const HAUTEUR_BARRE = 14;
const HAUTEUR_LIGNE = 26;
const MARGE_GAUCHE = 110;
const MARGE_HAUT = 8;

interface UsageCumule {
  readonly nom: string;
  readonly appels: number;
}

function cumulerOutils(executions: readonly Execution[]): readonly UsageCumule[] {
  const totaux = new Map<string, number>();
  for (const execution of executions) {
    for (const usage of execution.usageOutils) {
      totaux.set(usage.nom, (totaux.get(usage.nom) ?? 0) + usage.appels);
    }
  }
  return [...totaux.entries()].map(([nom, appels]) => ({ nom, appels })).sort((a, b) => b.appels - a.appels);
}

function ligneUsage(usage: UsageCumule, y: number, echelle: (v: number) => number, couleur: string): string {
  const largeur = echelle(usage.appels);
  return rectangleSvg(MARGE_GAUCHE, y, largeur, HAUTEUR_BARRE, { couleur }) +
    texteSvg(MARGE_GAUCHE - 8, y + HAUTEUR_BARRE - 2, usage.nom, { ancre: 'end', taille: 11 }) +
    texteSvg(MARGE_GAUCHE + largeur + 8, y + HAUTEUR_BARRE - 2, String(usage.appels), { taille: 11 });
}

function graphiqueCondition(condition: Condition, executions: readonly Execution[]): string {
  const titre = echapper(libelleCondition(condition));
  const usages = cumulerOutils(executions);
  if (usages.length === 0) {
    return `<div class="graphique-bloc"><p class="graphique-titre">${titre}</p>` +
      `<p class="valeur-non-mesuree">aucun appel d'outil enregistré</p></div>`;
  }
  const couleur = couleurCondition(condition);
  const domaineMax = maxDe(usages.map((u) => u.appels));
  const echelle = echelleLineaire([0, domaineMax], [0, LARGEUR_BARRE_MAX]);
  const lignes = usages.map((u, i) => ligneUsage(u, MARGE_HAUT + i * HAUTEUR_LIGNE, echelle, couleur)).join('\n');
  const hauteur = MARGE_HAUT + usages.length * HAUTEUR_LIGNE;
  const svg = ouvrirSvg(MARGE_GAUCHE + LARGEUR_BARRE_MAX + 60, hauteur, lignes);
  return `<div class="graphique-bloc"><p class="graphique-titre">${titre}</p>${svg}</div>`;
}

export function rendreOutils(m: FichierMesures): string {
  const groupes = groupesParCondition(m.executions);
  const blocs = groupes.map((g) => graphiqueCondition(g.condition, g.items)).join('\n');
  return section('07', "Les outils qu'une équipe a appelés", blocs, true);
}
