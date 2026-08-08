/**
 * Responsabilité : helpers transverses au générateur — échappement HTML, formatage de
 * nombres, couleur/libellé de condition, gabarit de section. Aucune valeur mesurée n'est
 * écrite ici : uniquement des fonctions pures qui mettent en forme ce qu'on leur donne.
 */

import type { Condition } from '../experience/contrat.ts';

const REMPLACEMENTS_HTML: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#39;'],
];

/** Échappe tout texte destiné à être injecté dans du HTML. Utilisée pour CHAQUE valeur venant du fichier de mesures. */
export function echapper(valeur: string): string {
  return REMPLACEMENTS_HTML.reduce((acc, [motif, remplacement]) => acc.replace(motif, remplacement), valeur);
}

/** Mention sobre affichée quand une valeur mesurée est absente — jamais une valeur de repli chiffrée. */
export const NON_MESURE = 'non mesuré';

export function texteOuNonMesure(valeur: string | null): string {
  return valeur === null ? NON_MESURE : echapper(valeur);
}

export function nombreOuNonMesure(valeur: number | null, decimales = 0): string {
  return valeur === null ? NON_MESURE : valeur.toFixed(decimales);
}

export function usdOuNonMesure(valeur: number | null): string {
  return valeur === null ? NON_MESURE : `$${valeur.toFixed(2)}`;
}

export function secondesDepuisMs(valeurMs: number): string {
  return `${(valeurMs / 1000).toFixed(1)}s`;
}

export function ouiNon(valeur: boolean): string {
  return valeur ? 'oui' : 'non';
}

const VARIABLE_COULEUR_CONDITION: Readonly<Record<Condition, string>> = {
  sans_lecon: 'var(--sans-lecon)',
  avec_lecon: 'var(--avec-lecon)',
  lecon_hors_sujet: 'var(--hors-sujet)',
};

export function couleurCondition(condition: Condition): string {
  return VARIABLE_COULEUR_CONDITION[condition];
}

const LIBELLE_CONDITION: Readonly<Record<Condition, string>> = {
  sans_lecon: 'sans leçon',
  avec_lecon: 'avec leçon',
  lecon_hors_sujet: 'leçon hors sujet',
};

export function libelleCondition(condition: Condition): string {
  return LIBELLE_CONDITION[condition];
}

/** Petite pastille de couleur, ronde, pour marquer une condition dans un tableau ou une légende. */
export function pastilleCondition(condition: Condition): string {
  return `<span class="pastille" style="background:${couleurCondition(condition)}" ` +
    `aria-hidden="true"></span>`;
}

/** Gabarit commun d'une section numérotée : numéro en monospace, titre, contenu. */
export function section(numero: string, titre: string, contenuHtml: string, large = false): string {
  const classeLargeur = large ? 'bloc-large' : 'bloc-prose';
  return `<section class="section">
  <div class="${classeLargeur}">
    <h2 class="titre-section"><span class="numero-section">${numero}</span> ${echapper(titre)}</h2>
    ${contenuHtml}
  </div>
</section>`;
}
