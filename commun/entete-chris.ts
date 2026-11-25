// Responsabilité : l'en-tête qui marque un message tapé par Chris dans Lanterne (ou sur l'iPhone) et remis à une
// session tenue ailleurs par Remote Control : Claude Code le range parmi les messages « d'une autre session », l'en-tête
// dit à l'agent que c'est Chris, pas un agent. Retiré à l'affichage : Chris voit son texte tel quel.
export const ENTETE_CHRIS = '[Message de l’utilisateur, tapé dans Lanterne : c’est ton utilisateur, pas un agent]';

export function avecEnteteChris(texte: string): string {
  return texte.startsWith(ENTETE_CHRIS) ? texte : `${ENTETE_CHRIS}\n${texte}`;
}

// Ancienne forme de l'en-tête (« Message de Chris »), encore dans les transcripts d'avant le changement.
const ENTETE_ANCIEN = /^\[Message de (l’utilisateur|Chris), tapé dans Lanterne : c’est ton utilisateur, pas un agent\]\n?/u;

export function aEnteteChris(texte: string): boolean {
  return ENTETE_ANCIEN.test(texte);
}

export function sansEnteteChris(texte: string): string {
  return texte.replace(ENTETE_ANCIEN, '');
}
