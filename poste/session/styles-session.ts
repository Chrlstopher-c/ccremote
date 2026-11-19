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

export function rechargerStylesVivants(sessions: Iterable<SessionPoste>): void {
  for (const s of sessions) if (s instanceof SessionSdk) void s.rechargerStyles();
}
