// Responsabilité : ce qu'un membre (ou l'appli locale) voit des sessions de ce nœud. Les sessions d'invité sont
// masquées pour les autres ; un invité ne voit aucune session du chef.
import type { MessageClient } from '../../commun/api-clients.ts';
import type { ReglagesInvite } from '../../commun/invites.ts';
import { masquerPourAutres } from '../../commun/invites-vue.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { inviteDe } from './sessions-invite.ts';

/** Les sessions qu'un membre voit : un invité n'en voit aucune (son travail tourne chez lui) ; autre → masquées. */
export function sessionsVues(
  viewer: string,
  reglages: ReglagesInvite | null,
  sessions: readonly ResumeSession[],
): ResumeSession[] {
  if (reglages !== null) return [];
  return sessions.map((s) => masquee(s, viewer));
}

/** Sessions que l'appli de ce nœud reçoit : un invité, sur sa propre machine, voit les siennes (et seulement elles). */
export function sessionsLocalesVues(
  moi: string,
  reglages: ReglagesInvite | null,
  sessions: readonly ResumeSession[],
): ResumeSession[] {
  if (reglages === null) return sessionsVues(moi, null, sessions);
  return sessions.filter((s) => s.invite?.membre === moi);
}

function masquee(s: ResumeSession, viewer: string): ResumeSession {
  const inv = s.invite;
  return inv && inv.membre !== viewer ? masquerPourAutres(s, inv.nom, inv.membre) : s;
}

/** Ce que l'appli locale reçoit en direct : la session d'un invité masquée, son contenu jamais. */
export function messageVuPar(
  moi: string,
  m: MessageClient,
  sessionDe: (id: string) => ResumeSession | null,
): MessageClient | null {
  const cache = (id: string): boolean => {
    const inv = inviteDe(sessionDe(id));
    return inv !== null && inv !== moi;
  };
  switch (m.type) {
    case 'session':
      return m.session.invite && m.session.invite.membre !== moi ? { ...m, session: masquee(m.session, moi) } : m;
    case 'evenement':
      return cache(m.evenement.sessionId) ? null : m;
    case 'flux':
    case 'fil_modifie':
      return cache(m.sessionId) ? null : m;
    default:
      return m;
  }
}
