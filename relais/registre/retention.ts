// Responsabilité : rétention du fil — purger les événements des sessions fermées depuis trop longtemps.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Registre } from './registre.ts';

export const RETENTION_JOURS = 30;
export const INTERVALLE_PURGE_MS = 24 * 60 * 60 * 1000;
const JOUR_MS = 24 * 60 * 60 * 1000;

// Pur : une session fermée n'est plus mise à jour, son `majLe` date donc sa fermeture.
export function sessionsAPurger(
  sessions: readonly ResumeSession[],
  maintenant: Date,
  jours = RETENTION_JOURS,
): string[] {
  const limite = maintenant.getTime() - jours * JOUR_MS;
  return sessions.filter((s) => s.statut === 'fermee' && Date.parse(s.majLe) < limite).map((s) => s.id);
}

export function purgerFil(registre: Registre, journal: Logger, maintenant = new Date()): void {
  try {
    const ids = sessionsAPurger(registre.sessions(), maintenant);
    const supprimes = ids.length > 0 ? registre.purgerEvenements(ids) : 0;
    journal.info({ sessions: ids.length, evenements: supprimes, jours: RETENTION_JOURS }, 'rétention du fil');
  } catch (e) {
    journal.error({ err: e }, 'rétention du fil : purge échouée');
  }
}

// Au démarrage, puis toutes les 24 h.
export function lancerRetention(registre: Registre, journal: Logger): Timer {
  purgerFil(registre, journal);
  return setInterval(() => purgerFil(registre, journal), INTERVALLE_PURGE_MS);
}
