// Responsabilité : les textes purs de la salle de réunion — sujet d'une réunion, enveloppe d'une demande envoyée aux
// sessions, cumul borné d'une réponse. Pur : aucune I/O.
import { LONGUEUR_REPONSE_REUNION } from '../../commun/reunion.ts';

const LONGUEUR_SUJET = 60;

export function sujetDepuis(texte: string): string {
  const ligne = texte.trim().split('\n')[0]?.trim() || 'Réunion';
  return ligne.length > LONGUEUR_SUJET ? `${ligne.slice(0, LONGUEUR_SUJET)}…` : ligne;
}

// L'émetteur est toujours nommé : « [Réunion — de Chris] » ou « [Réunion — de <session>] ».
export function enteteReunion(emetteur: string): string {
  return `[Réunion — de ${emetteur}]`;
}

// Ce que reçoit chaque session destinataire : la demande de Chris, le sujet et les règles de la table.
export function enveloppeDemande(sujet: string, texte: string): string {
  return [
    `${enteteReunion('Chris')} ${texte}`,
    '',
    `Réunion « ${sujet} ». Si le sujet ne te concerne pas, réponds « hors sujet » en une ligne.`,
    'Tu peux te coordonner avec les autres sessions (outils quart_*) sans Chris.',
    'Si tu as besoin de Chris, notifie-le dans ton bureau, pas à la table.',
    'Toute action offensive (pentest, scan, exploitation) déclenchée entre agents exige la validation de Chris.',
  ].join('\n');
}

// Le texte d'une session est recopié dans la réunion, borné : les ajouts successifs d'un même tour s'accumulent.
export function cumulerReponse(existant: string | null, ajout: string): string {
  const cumul = existant === null ? ajout : `${existant}\n\n${ajout}`;
  return cumul.length > LONGUEUR_REPONSE_REUNION ? `${cumul.slice(0, LONGUEUR_REPONSE_REUNION - 1)}…` : cumul;
}
