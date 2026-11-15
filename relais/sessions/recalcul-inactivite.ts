// Responsabilité : recalculer périodiquement l'inactivité et diffuser aux clients ce qui a changé sans événement.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';

export const INTERVALLE_RECALCUL_MS = 60_000;

export interface ChangementsInactivite {
  readonly changees: ResumeSession[];
  readonly etat: Map<string, string | null>;
}

// Pur : compare l'inactivité de chaque session à celle déjà diffusée. Un premier passage ne diffuse que les inactives.
export function changementsInactivite(
  sessions: readonly ResumeSession[],
  precedent: ReadonlyMap<string, string | null>,
): ChangementsInactivite {
  const etat = new Map<string, string | null>();
  const changees: ResumeSession[] = [];
  for (const s of sessions) {
    const courant = s.inactiveDepuis ?? null;
    etat.set(s.id, courant);
    if ((precedent.get(s.id) ?? null) !== courant) changees.push(s);
  }
  return { changees, etat };
}

// Toutes les minutes, comme la rétention : aucun événement n'annonce l'inactivité, le seul passage du temps la produit.
export function lancerRecalculInactivite(
  registre: Registre,
  diffusion: Diffusion,
  journal: Logger,
  intervalleMs = INTERVALLE_RECALCUL_MS,
): Timer {
  let suivi = new Map<string, string | null>();
  return setInterval(() => {
    try {
      const r = changementsInactivite(registre.sessions(true), suivi);
      suivi = r.etat;
      for (const session of r.changees) diffusion.diffuser({ type: 'session', session });
    } catch (e) {
      journal.error({ err: e }, 'recalcul de l inactivité : échec');
    }
  }, intervalleMs);
}
