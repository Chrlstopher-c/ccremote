// Responsabilité : ce qui est commun aux deux côtés du lien duo — le canal d'émission et la lecture validée d'un
// message reçu (jamais un message non conforme au contrat).
import { type MessageLien, MessageLien as SchemaMessage } from '../../commun/duo.ts';

export interface Canal {
  envoyer(m: MessageLien): void;
  fermer(): void;
}

export function lireMessage(brut: string): MessageLien | null {
  try {
    const r = SchemaMessage.safeParse(JSON.parse(brut));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const CHEMIN_LIEN = '/duo';
