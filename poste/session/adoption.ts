// Responsabilité : la fiche d'une session adoptée — lancée hors ccremote, dans tmux ou dans un terminal ordinaire —
// et le transcript qui lui correspond. Pur, sauf la lecture du disque par `retrouverTranscript`.
import type { ResumeSession } from '../../commun/session.ts';
import type { ProcessusClaude } from './processus.ts';
import type { PaneTmux } from './tmux.ts';
import { cheminTranscript, retrouverTranscript } from './transcript.ts';

export interface Origine {
  readonly machine: string;
  readonly compte: string;
  readonly fenetre: number;
}

export interface Adoptee {
  readonly id: string;
  readonly transcript: { readonly id: string; readonly chemin: string } | null;
}

/** Le transcript d'une session tmux : exact si Claude a déclaré son processus, sinon deviné (titre, dossier). */
export function transcriptDuPane(
  pane: PaneTmux,
  panes: readonly PaneTmux[],
  proc: ProcessusClaude | undefined,
): Adoptee {
  if (proc)
    return {
      id: proc.sessionId,
      transcript: { id: proc.sessionId, chemin: cheminTranscript(proc.cwd, proc.sessionId, proc.configDir) },
    };
  const voisins = panes.filter((p) => p.dossier === pane.dossier).length;
  const t = retrouverTranscript(pane.dossier, pane.titre, voisins, null);
  return { id: t?.id ?? `tmux-${pane.nom}-${pane.creeLe}`, transcript: t };
}

export function transcriptDuProcessus(proc: ProcessusClaude): Adoptee {
  return {
    id: proc.sessionId,
    transcript: { id: proc.sessionId, chemin: cheminTranscript(proc.cwd, proc.sessionId, proc.configDir) },
  };
}

export function ficheAdoptee(
  o: Origine,
  a: Adoptee,
  dossier: string,
  titre: string,
  tmux: PaneTmux | null,
): ResumeSession {
  const maintenant = new Date().toISOString();
  return {
    id: a.id,
    machine: o.machine,
    projet: { machine: o.machine, chemin: dossier, nom: dossier.split('/').at(-1) ?? dossier },
    cwd: dossier,
    titre,
    objectif: null,
    modele: 'défaut',
    compte: o.compte,
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: o.fenetre },
    etapes: 0,
    compactions: 0,
    claudeSessionId: a.transcript?.id ?? null,
    tmux: tmux?.nom ?? null,
    attachee: tmux?.attachee ?? false,
    pilotee: false,
    terminal: tmux === null,
    creeLe: maintenant,
    majLe: maintenant,
  };
}
