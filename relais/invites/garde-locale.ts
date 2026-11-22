// Responsabilité : la garde des routes locales (appli, appareils) sur les sessions d'invité — le chef garde la main
// (interrompre, archiver, désarchiver) mais ne lit ni n'écrit le contenu d'une session d'invité. Rend la réponse 403.
import { erreur } from '../clients/http.ts';
import { contenuPrive, inviteDe } from './sessions-invite.ts';
import type { ResumeSession } from '../../commun/session.ts';

const SESSION_CONTENU = /^\/api\/sessions\/([^/]+)\/([^?]+)/;

/** La réponse 403 si la route `url` vise un contenu privé d'une session d'invité, sinon null. */
export function refusContenuLocal(
  url: string,
  moi: string | null,
  sessionDe: (id: string) => ResumeSession | null,
): Response | null {
  const trouve = SESSION_CONTENU.exec(new URL(url).pathname);
  if (!trouve) return null;
  const id = decodeURIComponent(trouve[1] ?? '');
  const suffixe = trouve[2] ?? '';
  const proprietaire = inviteDe(sessionDe(id));
  if (proprietaire === null || proprietaire === moi || !contenuPrive(suffixe.split('/')[0] ?? '')) return null;
  return erreur('contenu privé', 403);
}
