// Responsabilité : la décision de cession d'une session SDK — une conversation tenue par un processus Claude
// interactif hors Lanterne (Claude Desktop, terminal) fait rendre la main au poste : tout de suite sans tour en
// cours, à la fin du tour sinon. Pur : ni fichier ni requête ici ; le câblage est dans session-sdk.ts et
// balayage-sessions.ts.
import type { ProcessusClaude } from './processus.ts';

export type DecisionCession = 'ignorer' | 'fermer' | 'attendre';

/** Ce qu'une session SDK fait de sa conversation : vivante ? tour en cours ? tenue ailleurs ? */
export function decisionCession(vivante: boolean, tourEnCours: boolean, tenue: boolean): DecisionCession {
  if (!vivante || !tenue) return 'ignorer';
  return tourEnCours ? 'attendre' : 'fermer';
}

/** Vrai si un processus Claude interactif hors SDK tient cette conversation (nos sessions SDK ne comptent pas). */
export function tenueParAilleurs(procs: readonly ProcessusClaude[], conversation: string): boolean {
  return procs.some((p) => p.sdk !== true && p.sessionId === conversation);
}
