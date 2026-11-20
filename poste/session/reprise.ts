// Responsabilité : au démarrage du poste, décider quelles sessions SDK reprendre (celles qui tournaient quand le poste
// s'est arrêté, jamais celles que Chris a fermées) et les relancer une à une par leur conversation.
import type { Logger } from 'pino';
import type { StatutSession } from '../../commun/session.ts';
import type { SessionPersistee } from './persistance.ts';
import { processusClaude } from './processus.ts';

export const PAUSE_REPRISE_MS = 1_000;
export const RAISON_REDEMARRAGE = 'redémarrage du poste';
export const TEXTE_REDEMARRAGE = 'Le poste a redémarré pendant ton tour : reprends exactement où tu en étais.';

const STATUTS_EN_TOUR: ReadonlySet<StatutSession> = new Set(['travail', 'compaction', 'question']);

// Ce que le démarrage demande à une session SDK : la reprendre, avec le texte du poste (null : reprise silencieuse).
export interface SessionReprenable {
  readonly resume: { readonly id: string };
  reprendreApresRedemarrage(texte: string | null): string | null;
}

export interface ReprisePrevue {
  readonly session: SessionReprenable;
  readonly texte: string | null;
}

// Le texte de la reprise d'une session persistée, ou null si elle ne se reprend pas (tmux, fermée par Chris).
export function reprisePrevue(p: SessionPersistee): { readonly texte: string | null } | null {
  if (p.resume.moteur !== 'sdk' || !p.aReprendre) return null;
  return { texte: STATUTS_EN_TOUR.has(p.resume.statut) ? TEXTE_REDEMARRAGE : null };
}

// Reprises une à une, chacune après `pauseMs` : le délai laisse au lien vers le relais le temps de s'ouvrir (les
// événements émis avant lui sont perdus). Une reprise en échec n'empêche pas les suivantes.
export async function relancerApresRedemarrage(
  reprises: readonly ReprisePrevue[],
  journal: Logger,
  pauseMs = PAUSE_REPRISE_MS,
): Promise<void> {
  for (const { session, texte } of reprises) {
    await pause(pauseMs);
    relancerUne(session, texte, journal);
  }
}

function relancerUne(session: SessionReprenable, texte: string | null, journal: Logger): void {
  const id = session.resume.id;
  try {
    const erreur = session.reprendreApresRedemarrage(texte);
    if (erreur) journal.warn({ session: id, erreur }, 'reprise au démarrage en échec');
    else journal.info({ session: id, avecMessage: texte !== null }, 'session reprise après le redémarrage du poste');
  } catch (erreur) {
    journal.error({ err: erreur, session: id }, 'reprise au démarrage en échec');
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Conversations qu'un processus Claude vivant hors du poste tient déjà (Desktop, terminal), par identifiant. */
export function conversationsTenuesAilleurs(comptes: readonly (string | null)[], journal: Logger): Set<string> {
  try {
    return new Set(processusClaude([null, ...comptes], journal).map((proc) => proc.sessionId));
  } catch (erreur) {
    journal.warn({ err: erreur }, 'processus Claude non lus : reprises décidées sans eux');
    return new Set();
  }
}
