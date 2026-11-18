// Responsabilité : lire un fichier présenté pour la route du relais — contenu en base64 avec son nom et son type.
// Un identifiant inconnu donne null ; une lecture en échec est journalisée et donne null aussi.
import type { Logger } from 'pino';
import type { FichierLu } from '../../commun/presentation.ts';
import type { Stockage } from './stockage.ts';

export function lireFichierSession(
  stockage: Stockage,
  sessionId: string,
  fichier: string,
  journal: Logger,
): FichierLu | null {
  try {
    const trouve = stockage.lire(sessionId, fichier);
    return trouve ? { nom: trouve.meta.nom, mime: trouve.meta.mime, base64: trouve.octets.toString('base64') } : null;
  } catch (erreur) {
    journal.error({ err: erreur, session: sessionId, fichier }, 'lecture d’un fichier présenté impossible');
    return null;
  }
}
