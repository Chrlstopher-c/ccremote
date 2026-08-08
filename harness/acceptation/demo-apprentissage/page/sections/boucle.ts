/**
 * Responsabilité : « La boucle » — schéma SVG horizontal à quatre étapes fixes
 * (observer → extraire → confirmer → réinjecter), reliées par des flèches, la
 * quatrième revenant à la première. Aucune donnée mesurée : c'est un schéma de
 * mécanisme, identique quel que soit le fichier de mesures.
 */

import { ligneSvg, ouvrirSvg, rectangleSvg, texteSvg } from '../svg.ts';
import { section } from '../utils.ts';

interface Etape {
  readonly mot: string;
  readonly description: string;
}

const ETAPES: readonly Etape[] = [
  { mot: 'observer', description: "l'historique JSONL d'une équipe terminée" },
  { mot: 'extraire', description: 'un modèle en tire des énoncés courts' },
  { mot: 'confirmer', description: 'une leçon vue par deux missions distinctes devient active' },
  { mot: 'réinjecter', description: 'les leçons actives entrent dans le mandat des équipes suivantes' },
];

const LARGEUR_BOITE = 200;
const HAUTEUR_BOITE = 64;
const ESPACE = 40;
const MARGE_X = 20;
const Y_BOITE = 50;
const HAUTEUR_SVG = 220;

function boite(etape: Etape, index: number): string {
  const x = MARGE_X + index * (LARGEUR_BOITE + ESPACE);
  const centreX = x + LARGEUR_BOITE / 2;
  return rectangleSvg(x, Y_BOITE, LARGEUR_BOITE, HAUTEUR_BOITE, { couleur: 'transparent' }) +
    `<rect x="${x}" y="${Y_BOITE}" width="${LARGEUR_BOITE}" height="${HAUTEUR_BOITE}" rx="2" ` +
    `fill="var(--surface)" stroke="var(--bord)" />` +
    texteSvg(centreX, Y_BOITE + 26, etape.mot, { ancre: 'middle', couleur: 'var(--texte)', taille: 14, poids: 700 }) +
    texteMultiligne(centreX, Y_BOITE + 44, etape.description, LARGEUR_BOITE - 16);
}

/** Découpe grossièrement une description en lignes centrées pour tenir dans la boîte (retour simple). */
function texteMultiligne(centreX: number, y: number, texte: string, largeurMax: number): string {
  const mots = texte.split(' ');
  const caracteresParLigne = Math.floor(largeurMax / 5.5);
  const lignes: string[] = [];
  let courante = '';
  for (const mot of mots) {
    const candidate = courante === '' ? mot : `${courante} ${mot}`;
    if (candidate.length > caracteresParLigne && courante !== '') {
      lignes.push(courante);
      courante = mot;
    } else {
      courante = candidate;
    }
  }
  if (courante !== '') lignes.push(courante);
  const ligne1 = lignes[0] ?? '';
  const ligne2 = lignes.slice(1).join(' ');
  return texteSvg(centreX, y, ligne1, { ancre: 'middle', taille: 10 }) +
    (ligne2 === '' ? '' : texteSvg(centreX, y + 13, ligne2, { ancre: 'middle', taille: 10 }));
}

function flechesAvant(): string {
  let fleches = '';
  for (let index = 0; index < ETAPES.length - 1; index += 1) {
    const x1 = MARGE_X + index * (LARGEUR_BOITE + ESPACE) + LARGEUR_BOITE;
    const x2 = x1 + ESPACE;
    const y = Y_BOITE + HAUTEUR_BOITE / 2;
    fleches += ligneSvg(x1, y, x2, y, { couleur: 'var(--texte-faible)' });
    fleches += ligneSvg(x2 - 6, y - 4, x2, y, { couleur: 'var(--texte-faible)' });
    fleches += ligneSvg(x2 - 6, y + 4, x2, y, { couleur: 'var(--texte-faible)' });
  }
  return fleches;
}

function fleecheRetour(): string {
  const derniere = MARGE_X + (ETAPES.length - 1) * (LARGEUR_BOITE + ESPACE) + LARGEUR_BOITE / 2;
  const premiere = MARGE_X + LARGEUR_BOITE / 2;
  const yHaut = Y_BOITE - 30;
  const yBoite = Y_BOITE;
  return ligneSvg(derniere, yBoite, derniere, yHaut, { couleur: 'var(--texte-faible)', tirets: '3,3' }) +
    ligneSvg(derniere, yHaut, premiere, yHaut, { couleur: 'var(--texte-faible)', tirets: '3,3' }) +
    ligneSvg(premiere, yHaut, premiere, yBoite, { couleur: 'var(--texte-faible)', tirets: '3,3' }) +
    ligneSvg(premiere - 4, yBoite - 8, premiere, yBoite, { couleur: 'var(--texte-faible)' }) +
    ligneSvg(premiere + 4, yBoite - 8, premiere, yBoite, { couleur: 'var(--texte-faible)' });
}

export function rendreBoucle(): string {
  const boites = ETAPES.map((etape, index) => boite(etape, index)).join('\n');
  const largeurSvg = MARGE_X * 2 + ETAPES.length * LARGEUR_BOITE + (ETAPES.length - 1) * ESPACE;
  const svg = ouvrirSvg(largeurSvg, HAUTEUR_SVG, fleecheRetour() + flechesAvant() + boites);
  return section('03', 'La boucle', svg, true);
}
