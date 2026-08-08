/**
 * Responsabilité : graphique (c) de la section « Les mesures » — coût moyen et durée
 * médiane par condition, deux petits graphiques à barres horizontales côte à côte.
 * Les échelles sont calculées depuis `agregats`, jamais fixées en dur.
 */

import type { AgregatCondition, Condition } from '../../experience/contrat.ts';
import { CONDITIONS } from '../../experience/contrat.ts';
import { echelleLineaire, maxDe, ouvrirSvg, rectangleSvg, texteSvg } from '../svg.ts';
import { couleurCondition, libelleCondition, secondesDepuisMs, usdOuNonMesure } from '../utils.ts';

const LARGEUR_BARRE = 160;
const HAUTEUR_BARRE = 16;
const HAUTEUR_LIGNE = 36;
const MARGE_GAUCHE = 110;
const MARGE_HAUT = 10;
const LARGEUR_VALEUR = 70;

function ligneMetrique(
  condition: Condition,
  couleur: string,
  valeur: number | null,
  echelle: (v: number) => number,
  y: number,
  etiquetteValeur: string,
): string {
  const largeur = valeur === null ? 0 : echelle(valeur);
  const barre = rectangleSvg(MARGE_GAUCHE, y, largeur, HAUTEUR_BARRE, { couleur });
  const libelle = texteSvg(MARGE_GAUCHE - 8, y + HAUTEUR_BARRE - 3, libelleCondition(condition), {
    ancre: 'end',
    taille: 10,
  });
  const texteVal = texteSvg(MARGE_GAUCHE + largeur + 8, y + HAUTEUR_BARRE - 3, etiquetteValeur, {
    taille: 10,
    couleur: 'var(--texte)',
  });
  return barre + libelle + texteVal;
}

function petitGraphique(titre: string, lignesSvg: string, largeurSvg: number, hauteurSvg: number): string {
  return `<div>
    <p class="graphique-titre" style="font-size:14px">${titre}</p>
    ${ouvrirSvg(largeurSvg, hauteurSvg, lignesSvg)}
  </div>`;
}

function graphiqueCout(agregats: readonly AgregatCondition[]): string {
  const domaineMax = maxDe(agregats.map((a) => a.coutMoyenUsd));
  const echelle = echelleLineaire([0, domaineMax], [0, LARGEUR_BARRE]);
  const lignes = agregats
    .map((a, i) => ligneMetrique(a.condition, couleurCondition(a.condition), a.coutMoyenUsd, echelle,
      MARGE_HAUT + i * HAUTEUR_LIGNE, usdOuNonMesure(a.coutMoyenUsd)))
    .join('\n');
  const hauteur = MARGE_HAUT + agregats.length * HAUTEUR_LIGNE;
  return petitGraphique('Coût moyen (USD)', lignes, MARGE_GAUCHE + LARGEUR_BARRE + LARGEUR_VALEUR, hauteur);
}

function graphiqueDuree(agregats: readonly AgregatCondition[]): string {
  const domaineMax = maxDe(agregats.map((a) => a.dureeMedianeMs));
  const echelle = echelleLineaire([0, domaineMax], [0, LARGEUR_BARRE]);
  const lignes = agregats
    .map((a, i) => ligneMetrique(a.condition, couleurCondition(a.condition), a.dureeMedianeMs, echelle,
      MARGE_HAUT + i * HAUTEUR_LIGNE, secondesDepuisMs(a.dureeMedianeMs)))
    .join('\n');
  const hauteur = MARGE_HAUT + agregats.length * HAUTEUR_LIGNE;
  return petitGraphique('Durée médiane (s)', lignes, MARGE_GAUCHE + LARGEUR_BARRE + LARGEUR_VALEUR, hauteur);
}

export function dessinerGraphiqueCoutDuree(agregats: readonly AgregatCondition[]): string {
  const ordonnes = CONDITIONS.map((c) => agregats.find((a) => a.condition === c))
    .filter((a): a is AgregatCondition => a !== undefined);
  return `<div class="graphique-bloc">
    <h3 class="graphique-titre">Coût et durée</h3>
    <div class="deux-colonnes">
      ${graphiqueCout(ordonnes)}
      ${graphiqueDuree(ordonnes)}
    </div>
  </div>`;
}
