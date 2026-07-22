/**
 * Responsabilité : implémentation RÉELLE de `VerificateurSessionExistante`
 * (`control-plane/orchestrateur/processus/identite.ts`) — jusqu'ici un port
 * sans aucun appelant réel, `resoudreIdentite` n'étant exercé qu'avec une
 * doublure retournant toujours `false` (bancs `acceptation/`, tests).
 *
 * Appelle `getSessionInfo` du SDK, module-level (pas liée à un `Query`
 * particulier — vérifié dans `sdk.d.ts`), pour constater si l'UUID persisté
 * correspond réellement à une session connue avant de choisir `resume`.
 */

import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { VerificateurSessionExistante } from '../../control-plane/orchestrateur/processus/index.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'verificateur-session-sdk' });

export function creerVerificateurSessionSdk(cwd: string): VerificateurSessionExistante {
  return {
    async existe(sessionId: string): Promise<boolean> {
      try {
        const info = await getSessionInfo(sessionId, { dir: cwd });
        return info !== undefined;
      } catch (erreur) {
        // Fait, pas une panne à propager (H-44, même esprit) : un fichier d'identité
        // présent mais un SDK qui ne peut pas la confirmer doit rester `demarrage_froid`,
        // jamais un `resume` sur une session dont l'existence n'a pas pu être vérifiée.
        log.warn({ err: erreur, sessionId }, 'getSessionInfo en échec — traité comme session inexistante');
        return false;
      }
    },
  };
}
