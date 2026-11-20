// Responsabilité : le résumé Quart d'une session Remote Control (vue depuis claude.ai). Pur : aucune I/O.
import { EffortSession, type ResumeSession, type StatutSession } from '../../commun/session.ts';
import type { SessionBrute } from './donnees.ts';

export const LIBELLE_DISTANT = 'Remote Control';

export interface ContexteDistant {
  readonly machine: string;
  readonly compte: string; // nom du compte local qui voit la session
  readonly fenetreContexte: number;
}

/** Statut Quart d'une session claude.ai : la connexion coupée prime, sinon l'état du travail. */
export function statutDistant(s: SessionBrute): StatutSession {
  if (!s.connectee) return 'fermee';
  if (s.travail === 'running') return 'travail';
  if (s.travail === 'requires_action') return 'question';
  return 'attente';
}

export function resumeDistant(s: SessionBrute, c: ContexteDistant, creeLeRepli: string): ResumeSession {
  const effort = EffortSession.safeParse(s.effort);
  const maj = s.majLe ?? s.dernierEvenement ?? creeLeRepli;
  return {
    id: s.id,
    machine: c.machine,
    projet: { machine: c.machine, chemin: LIBELLE_DISTANT, nom: LIBELLE_DISTANT },
    cwd: LIBELLE_DISTANT,
    titre: s.titre ?? LIBELLE_DISTANT,
    objectif: null,
    modele: s.modele ?? '',
    compte: c.compte,
    autonomie: false,
    statut: statutDistant(s),
    contexte: { tokens: s.contexte?.tokens ?? 0, max: s.contexte?.max ?? c.fenetreContexte },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    moteur: 'claude_ai',
    effort: effort.success ? effort.data : null,
    tmux: null,
    attachee: false,
    pilotee: false,
    remoteControl: { actif: true, url: `https://claude.ai/code/${s.id}` },
    distant: {
      compte: c.compte,
      idDistant: s.id,
      connexion: s.connectee ? 'connectee' : 'deconnectee',
      probleme: null,
    },
    nonLue: s.nonLue,
    creeLe: s.creeLe ?? creeLeRepli,
    majLe: maj,
  };
}
