// Responsabilité : les lectures du panneau d'une session (contexte, connecteurs, tâches) relayées par le gestionnaire.
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { SessionSdk } from './session-sdk.ts';
import type { SessionPoste } from './session-poste.ts';

export type CommandeSession = Extract<CommandeRelais, { sessionId: string }>;
export type LecturePanneau = Extract<CommandeSession, { kind: 'contexte' | 'connecteurs' | 'taches' | 'tache' }>;

export const estLecture = (c: CommandeSession): c is LecturePanneau =>
  c.kind === 'contexte' || c.kind === 'connecteurs' || c.kind === 'taches' || c.kind === 'tache';

// Le panneau ne lit que le SDK ; une session tmux n'a ni contexte ni tâche à relayer (listes vides, détail absent).
export async function lecturePanneau(s: SessionPoste, c: LecturePanneau): Promise<unknown> {
  if (!(s instanceof SessionSdk)) return c.kind === 'connecteurs' || c.kind === 'taches' ? [] : null;
  if (c.kind === 'contexte') return s.contexte();
  if (c.kind === 'connecteurs') return s.connecteurs();
  if (c.kind === 'taches') return s.taches();
  return s.tache(c.tache);
}
