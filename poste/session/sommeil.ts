// Responsabilité : la mise en sommeil des sessions SDK au repos, balayage périodique du gestionnaire. Une session au
// repos depuis le délai réglé rend son processus ; la décision et l'arrêt sont dans session-sdk-processus.ts.
import type { Logger } from 'pino';
import type { SessionPoste } from './session-poste.ts';
import { SessionSdk } from './session-sdk.ts';

/** Met au repos les sessions SDK inactives depuis `minutes` (les autres sessions ne sont pas touchées). */
export function endormirAuRepos(
  sessions: Iterable<SessionPoste>,
  minutes: number,
  journal: Logger,
  maintenant: number = Date.now(),
): void {
  for (const s of sessions) {
    if (!(s instanceof SessionSdk)) continue;
    try {
      s.endormirSiRepos(maintenant, minutes * 60_000);
    } catch (erreur) {
      journal.error({ err: erreur, session: s.resume.id }, 'mise en sommeil impossible');
    }
  }
}
