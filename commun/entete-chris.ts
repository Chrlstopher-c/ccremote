// Responsabilité : l'en-tête qui marque un message tapé par Chris dans Lanterne (ou sur l'iPhone) et remis à une
// session tenue ailleurs par Remote Control : Claude Code le range parmi les messages « d'une autre session », l'en-tête
// dit à l'agent que c'est Chris, pas un agent. Retiré à l'affichage : Chris voit son texte tel quel.
export const ENTETE_CHRIS = '[Message de Chris, tapé dans Lanterne : c’est ton utilisateur, pas un agent]';

export function avecEnteteChris(texte: string): string {
  return texte.startsWith(ENTETE_CHRIS) ? texte : `${ENTETE_CHRIS}\n${texte}`;
}

export function sansEnteteChris(texte: string): string {
  return texte.startsWith(ENTETE_CHRIS) ? texte.slice(ENTETE_CHRIS.length).replace(/^\n/, '') : texte;
}
