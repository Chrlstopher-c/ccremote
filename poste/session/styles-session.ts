// Responsabilité : les styles de sortie d'une session du poste — ceux de sa requête vivante, sinon ceux des fichiers ;
// et le rechargement des styles créés sur la machine dans les sessions SDK vivantes.
import type { Logger } from 'pino';
import type { StylesSession } from '../../commun/configuration.ts';
import { stylesDisque } from '../configuration/styles.ts';
import { SessionSdk } from './session-sdk.ts';
import type { SessionPoste } from './session-poste.ts';

export async function stylesDeSession(s: SessionPoste, journal: Logger): Promise<StylesSession> {
  const vivants = s instanceof SessionSdk ? await s.stylesVivants() : null;
  return vivants ?? stylesDisque(s.persistee.configDir, s.resume.cwd, s.resume.style_sortie ?? null, journal);
}

/** Les styles d'une session par son identifiant ; une session inconnue du poste n'en a pas. */
export async function stylesDeSessionId(
  sessions: ReadonlyMap<string, SessionPoste>,
  id: string,
  machine: string,
  journal: Logger,
): Promise<{ ok: true; donnees: StylesSession } | { ok: false; erreur: string }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, erreur: `session inconnue sur ${machine}` };
  return { ok: true, donnees: await stylesDeSession(s, journal) };
}

export function rechargerStylesVivants(sessions: Iterable<SessionPoste>): void {
  for (const s of sessions) if (s instanceof SessionSdk) void s.rechargerStyles();
}
