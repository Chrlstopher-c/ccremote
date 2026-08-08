/**
 * Responsabilité : graphique (b) de la section « Les mesures » — réussi du premier coup,
 * une barre horizontale segmentée par condition, `reussiDuPremierCoup` sur `executions`.
 * La largeur remplie est calculée depuis l'agrégat, jamais fixée en dur.
 */

import type { AgregatCondition } from '../../experience/contrat.ts';
import { ouvrirSvg, rectangleSvg, texteSvg } from '../svg.ts';
import { CONDITIONS } from '../../experience/contrat.ts';
import { couleurCondition, libelleCondition } from '../utils.ts';
import { legendeConditions } from './mesures-communs.ts';

const LARGEUR_BARRE = 420;
const HAUTEUR_BARRE = 18;
const HAUTEUR_LIGNE = 40;
const MARGE_GAUCHE = 130;
const MARGE_HAUT = 12;
const LARGEUR_ETIQUETTE_FRACTION = 70;

function ligneBarre(agregat: AgregatCondition, y: number): string {
  const couleur = couleurCondition(agregat.condition);
  const fraction = agregat.executions === 0 ? 0 : agregat.reussiDuPremierCoup / agregat.executions;
  const largeurRemplie = LARGEUR_BARRE * fraction;
  const fond = rectangleSvg(MARGE_GAUCHE, y, LARGEUR_BARRE, HAUTEUR_BARRE, { couleur: 'var(--bord)' });
  const rempli = rectangleSvg(MARGE_GAUCHE, y, largeurRemplie, HAUTEUR_BARRE, { couleur });
  const libelle = texteSvg(MARGE_GAUCHE - 10, y + HAUTEUR_BARRE - 4, libelleCondition(agregat.condition), {
    ancre: 'end',
    taille: 11,
  });
  const fractionTexte = texteSvg(
    MARGE_GAUCHE + LARGEUR_BARRE + 10,
    y + HAUTEUR_BARRE - 4,
    `${agregat.reussiDuPremierCoup}/${agregat.executions}`,
    { taille: 11, couleur: 'var(--texte)' },
  );
  return fond + rempli + libelle + fractionTexte;
}

export function dessinerGraphiquePremierCoup(agregats: readonly AgregatCondition[]): string {
  const parCondition = new Map(agregats.map((a) => [a.condition, a]));
  const lignes = CONDITIONS.map((condition, index) => {
    const agregat = parCondition.get(condition);
    if (agregat === undefined) return '';
    return ligneBarre(agregat, MARGE_HAUT + index * HAUTEUR_LIGNE);
  }).join('\n');
  const hauteurSvg = MARGE_HAUT + CONDITIONS.length * HAUTEUR_LIGNE;
  const largeurSvg = MARGE_GAUCHE + LARGEUR_BARRE + LARGEUR_ETIQUETTE_FRACTION;
  const svg = ouvrirSvg(largeurSvg, hauteurSvg, lignes);
  return `<div class="graphique-bloc">
    <h3 class="graphique-titre">Réussi du premier coup</h3>
    ${legendeConditions()}
    ${svg}
  </div>`;
}
