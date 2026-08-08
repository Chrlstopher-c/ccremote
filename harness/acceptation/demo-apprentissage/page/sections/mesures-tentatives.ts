/**
 * Responsabilité : graphique (a) de la section « Les mesures » — tentatives avant succès,
 * une barre par exécution, groupées par condition. Toute échelle est calculée depuis les
 * données ; aucune hauteur ni aucun seuil n'est fixé en dur hors constantes graphiques.
 */

import type { Execution } from '../../experience/contrat.ts';
import { defsHachures, type Echelle, echelleLineaire, ligneSvg, maxDe, ouvrirSvg, rectangleSvg, texteSvg } from '../svg.ts';
import { couleurCondition } from '../utils.ts';
import { groupesParCondition, legendeConditions, type GroupeCondition } from './mesures-communs.ts';

const LARGEUR_BARRE = 24;
const ECART_INTRA_GROUPE = 8;
const ECART_GROUPES = 28;
const MARGE_GAUCHE = 44;
const MARGE_DROITE = 20;
const MARGE_HAUT = 26;
const HAUTEUR_ZONE = 170;
const MARGE_BAS = 56;
const HAUTEUR_SVG = MARGE_HAUT + HAUTEUR_ZONE + MARGE_BAS;

interface PositionBarre {
  readonly execution: Execution;
  readonly x: number;
}

function positionnerBarres(groupes: ReadonlyArray<GroupeCondition<Execution>>): readonly PositionBarre[] {
  const positions: PositionBarre[] = [];
  let x = MARGE_GAUCHE;
  for (const groupe of groupes) {
    for (const execution of groupe.items) {
      positions.push({ execution, x });
      x += LARGEUR_BARRE + ECART_INTRA_GROUPE;
    }
    x += ECART_GROUPES - ECART_INTRA_GROUPE;
  }
  return positions;
}

function dessinerBarre(position: PositionBarre, echelle: Echelle, domaineMax: number, baseline: number): string {
  const { execution } = position;
  const couleur = couleurCondition(execution.condition);
  const jamais = execution.tentativesAvantSucces === null;
  const hauteur = echelle(execution.tentativesAvantSucces ?? domaineMax);
  const y = baseline - hauteur;
  const remplissage = jamais ? `url(#hachure-tentatives-${execution.condition})` : couleur;
  const barre = rectangleSvg(position.x, y, LARGEUR_BARRE, hauteur, { remplissage });
  const contour = jamais
    ? `<rect x="${position.x}" y="${y}" width="${LARGEUR_BARRE}" height="${hauteur}" rx="2" fill="none" ` +
      `stroke="${couleur}" stroke-width="1" />`
    : '';
  const etiquette = jamais ? 'jamais' : String(execution.tentativesAvantSucces);
  // Une exécution jamais réussie porte un mot, pas un chiffre : plus long que la barre,
  // donc rendu plus petit pour ne pas empiéter sur ses voisines.
  const valeur = texteSvg(position.x + LARGEUR_BARRE / 2, y - 6, etiquette, {
    ancre: 'middle',
    taille: jamais ? 8 : 10,
  });
  const repetition = texteSvg(position.x + LARGEUR_BARRE / 2, baseline + 14, `r${execution.repetition}`, {
    ancre: 'middle',
    taille: 9,
    couleur: 'var(--texte-faible)',
  });
  return barre + contour + valeur + repetition;
}

function etiquettesGroupes(groupes: ReadonlyArray<GroupeCondition<Execution>>, positions: readonly PositionBarre[]): string {
  return groupes
    .map((groupe) => {
      const barresDuGroupe = positions.filter((p) => p.execution.condition === groupe.condition);
      const premiere = barresDuGroupe[0];
      const derniere = barresDuGroupe[barresDuGroupe.length - 1];
      if (premiere === undefined || derniere === undefined) return '';
      const centre = (premiere.x + derniere.x + LARGEUR_BARRE) / 2;
      return texteSvg(centre, MARGE_HAUT + HAUTEUR_ZONE + 32, groupe.condition, {
        ancre: 'middle',
        taille: 10,
        couleur: 'var(--texte-doux)',
      });
    })
    .join('\n');
}

function largeurTotale(positions: readonly PositionBarre[]): number {
  const derniere = positions[positions.length - 1];
  return derniere === undefined ? MARGE_GAUCHE + MARGE_DROITE : derniere.x + LARGEUR_BARRE + MARGE_DROITE;
}

export function dessinerGraphiqueTentatives(executions: readonly Execution[]): string {
  const groupes = groupesParCondition(executions);
  const positions = positionnerBarres(groupes);
  const domaineMax = maxDe(executions.map((e) => e.tentativesAvantSucces));
  const baseline = MARGE_HAUT + HAUTEUR_ZONE;
  const echelle = echelleLineaire([0, domaineMax], [0, HAUTEUR_ZONE]);
  const largeurSvg = largeurTotale(positions);
  const yPremierCoup = baseline - echelle(1);
  const ligneRepere = ligneSvg(MARGE_GAUCHE, yPremierCoup, largeurSvg - MARGE_DROITE, yPremierCoup, {
    couleur: 'var(--texte-faible)',
    tirets: '3,3',
  }) + texteSvg(MARGE_GAUCHE - 6, yPremierCoup - 3, 'premier coup', { ancre: 'end', taille: 9 });
  const hachures = groupes
    .map((g) => defsHachures(`hachure-tentatives-${g.condition}`, couleurCondition(g.condition)))
    .join('');
  const barres = positions.map((p) => dessinerBarre(p, echelle, domaineMax, baseline)).join('\n');
  const axeY = texteSvg(6, MARGE_HAUT - 8, 'tentatives', { ancre: 'start', taille: 10, couleur: 'var(--texte-faible)' });
  const svg = ouvrirSvg(
    largeurSvg,
    HAUTEUR_SVG,
    hachures + axeY + ligneRepere + barres + etiquettesGroupes(groupes, positions),
  );
  return `<div class="graphique-bloc">
    <h3 class="graphique-titre">Tentatives avant succès, par exécution</h3>
    ${legendeConditions()}
    ${svg}
  </div>`;
}
