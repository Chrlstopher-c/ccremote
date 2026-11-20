// Responsabilité : la clé de transcript d'un événement du fil principal — uuid de la ligne pour un message ou un texte,
// identifiant de l'appel pour un outil, un sous-agent ou un résultat. Partagée par le poste (recalage) et le relais
// (nettoyage du fil). Pur.
import type { Evenement } from './session.ts';

/** Clé de transcript d'un événement du fil principal ; null s'il n'en porte pas (ou s'il est d'un sous-agent). */
export function cleTranscript(evt: Evenement): string | null {
  if ('agent' in evt && evt.agent) return null; // fil d'un sous-agent : son transcript est à part
  if ((evt.type === 'message' || evt.type === 'texte') && evt.uuid) return evt.uuid;
  if (evt.type === 'outil' || evt.type === 'sous_agent') return evt.id;
  if (evt.type === 'resultat_outil') return evt.outilId;
  return null;
}
