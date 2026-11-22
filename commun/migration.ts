// Responsabilité : ce qui rend une session observée (Claude Desktop, terminal) migrable vers Lanterne. Règle pure,
// partagée par le relais (champ `migrable` de la vue) et le poste (garde de la commande `migrer`).
import type { ResumeSession } from './session.ts';

export type SessionMigrable = Pick<ResumeSession, 'terminal' | 'pilotee' | 'claudeSessionId' | 'annexe_de' | 'invite'>;

/** Vrai pour une conversation tenue hors Lanterne (Desktop, terminal) et pas encore migrée (`migreeVers` absent). */
export function estMigrable(s: SessionMigrable, migreeVers: string | null | undefined): boolean {
  if (migreeVers) return false;
  if (s.terminal !== true || s.pilotee || s.annexe_de || s.invite) return false;
  return s.claudeSessionId !== null;
}
