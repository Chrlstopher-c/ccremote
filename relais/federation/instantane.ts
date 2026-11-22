// Responsabilité : l'instantané des sessions d'un nœud au-delà d'une trame. Les sessions au-delà de la tête
// (les 150 plus récentes) partent en pages numérotées, AVANT la tête : le pair remplace sa liste d'un coup à
// l'arrivée de la tête, sans trou pendant le transfert. Un pair d'avant ignore ces pages et reçoit la tête seule.
import {
  type MessageChiffre,
  NOMBRE_MAX_PAGES_INSTANTANE,
  NOMBRE_MAX_SESSIONS_FEDEREES,
} from '../../commun/federation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { lePlusLongQuiTient } from './trames.ts';

type Suite = Extract<MessageChiffre, { t: 'instantane_suite' }>;

/**
 * Les messages d'un instantané, dans l'ordre d'envoi : les pages des sessions au-delà de la tête, puis la tête.
 * `tete` construit le message `instantane` qui porte les sessions qu'on lui donne (il tient dans une trame).
 */
export function messagesInstantane(
  sessions: readonly ResumeSession[],
  tete: (liste: readonly ResumeSession[]) => MessageChiffre,
): MessageChiffre[] {
  const debut = lePlusLongQuiTient(sessions.slice(0, NOMBRE_MAX_SESSIONS_FEDEREES), tete);
  const pages = pagesDe(sessions.slice(debut.length));
  const suites: Suite[] = pages.map((page, i) => ({
    t: 'instantane_suite',
    rang: i + 1,
    total: pages.length,
    sessions: page,
  }));
  return [...suites, tete(debut)];
}

// Les sessions restantes, par pages qui tiennent chacune dans une trame. Le rang est compté sur 3 chiffres au plus,
// pour mesurer la taille au pire (le message réel n'est jamais plus gros).
function pagesDe(sessions: readonly ResumeSession[]): ResumeSession[][] {
  const pages: ResumeSession[][] = [];
  let reste = sessions;
  while (reste.length > 0 && pages.length < NOMBRE_MAX_PAGES_INSTANTANE) {
    const page = lePlusLongQuiTient(reste.slice(0, NOMBRE_MAX_SESSIONS_FEDEREES), (liste) => ({
      t: 'instantane_suite',
      rang: NOMBRE_MAX_PAGES_INSTANTANE,
      total: NOMBRE_MAX_PAGES_INSTANTANE,
      sessions: [...liste],
    }));
    const n = Math.max(1, page.length);
    pages.push([...reste.slice(0, n)]);
    reste = reste.slice(n);
  }
  return pages;
}

interface Lot {
  readonly total: number;
  rang: number;
  readonly sessions: ResumeSession[];
}

/** Les pages reçues de chaque pair, en attente de leur tête. Une page hors d'ordre annule le lot. */
export class AssemblageInstantane {
  private readonly lots = new Map<string, Lot>();

  recevoirSuite(membre: string, m: Suite): void {
    if (m.rang === 1) {
      this.lots.set(membre, { total: m.total, rang: 1, sessions: [...m.sessions] });
      return;
    }
    const lot = this.lots.get(membre);
    if (!lot || lot.total !== m.total || lot.rang + 1 !== m.rang) {
      this.lots.delete(membre);
      return;
    }
    lot.rang = m.rang;
    lot.sessions.push(...m.sessions);
  }

  /** À l'arrivée de la tête : les sessions des pages si le lot est complet, sinon rien. Le lot est vidé. */
  terminer(membre: string): ResumeSession[] {
    const lot = this.lots.get(membre);
    this.lots.delete(membre);
    return lot && lot.rang === lot.total ? lot.sessions : [];
  }

  oublier(membre: string): void {
    this.lots.delete(membre);
  }
}
