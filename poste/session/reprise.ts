// Responsabilité : au démarrage du poste, relancer seulement les sessions SDK prises en plein tour quand le poste
// s'est arrêté. Les autres (au repos, fermées par Chris) n'ont aucun processus : elles repartent au prochain message
// (voir session-sdk-envoi.ts) ou à une action qui en a besoin. Les relances se font une à une.
import type { Logger } from 'pino';
import type { StatutSession } from '../../commun/session.ts';
import type { SessionPersistee } from './persistance.ts';
import { processusClaude } from './processus.ts';

export const PAUSE_REPRISE_MS = 1_000;
export const RAISON_REDEMARRAGE = 'redémarrage du poste';
export const TEXTE_REDEMARRAGE = 'Le poste a redémarré pendant ton tour : reprends exactement où tu en étais.';

const STATUTS_EN_TOUR: ReadonlySet<StatutSession> = new Set(['travail', 'compaction', 'question']);

// Ce que le démarrage demande à une session SDK : la reprendre, avec le texte du poste.
export interface SessionReprenable {
  readonly resume: { readonly id: string };
  reprendreApresRedemarrage(texte: string): string | null;
}

export interface ReprisePrevue {
  readonly session: SessionReprenable;
  readonly texte: string;
}

// La reprise d'une session persistée, ou null : seule une session prise en plein tour se relance (tmux, au repos ou
// fermée par Chris : aucun processus au démarrage).
export function reprisePrevue(p: SessionPersistee): { readonly texte: string } | null {
  if (p.resume.moteur !== 'sdk' || !p.aReprendre || !STATUTS_EN_TOUR.has(p.resume.statut)) return null;
  return { texte: TEXTE_REDEMARRAGE };
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

function relancerUne(session: SessionReprenable, texte: string, journal: Logger): void {
  const id = session.resume.id;
  try {
    const erreur = session.reprendreApresRedemarrage(texte);
    if (erreur) journal.warn({ session: id, erreur }, 'reprise au démarrage en échec');
    else journal.info({ session: id }, 'session reprise après le redémarrage du poste');
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
