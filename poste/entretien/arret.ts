// Responsabilité : arrêter un processus ou une session tmux de l'inventaire — jamais ce qui fait tourner le poste ou
// l'appli, jamais un PID qui ne figure pas dans un inventaire recalculé à l'instant. Signaux et attente injectés.
import type { Logger } from 'pino';
import type { ProcessusPoste, ResultatGeste, TmuxPoste } from '../../commun/entretien.ts';

export const DELAI_ARRET_MS = 3000;
export const DELAI_KILL_MS = 1000;

export interface CibleArret {
  readonly pid: number;
  readonly debut: string;
  readonly force: boolean;
}

export interface DependancesArret {
  readonly inventaire: () => readonly ProcessusPoste[];
  readonly signaler: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  readonly attendre: (ms: number) => Promise<void>;
  readonly vivant: (pid: number, debut: string) => boolean;
  readonly proteges: ReadonlySet<number>;
  /** Clés `pid:debut` auxquelles ce poste a déjà envoyé un SIGTERM : seul cas où `force` tue net. */
  readonly envoyes: Set<string>;
}

const PHRASE_ARRETE = 'Processus arrêté';
const PHRASE_INCONNU = 'Processus inconnu ou déjà terminé';
const PHRASE_PROTEGE = 'Processus protégé : il fait tourner le poste ou l’appli';

/** Un SIGTERM, trois secondes d'attente ; SIGKILL seulement si `force` et qu'un SIGTERM précède (même processus). */
export async function arreterProcessus(d: DependancesArret, c: CibleArret): Promise<ResultatGeste> {
  if (c.pid <= 1 || d.proteges.has(c.pid)) return { ok: false, phrase: PHRASE_PROTEGE };
  if (!d.inventaire().some((p) => p.pid === c.pid && p.debut === c.debut)) return { ok: false, phrase: PHRASE_INCONNU };
  const cle = `${c.pid}:${c.debut}`;
  if (c.force && d.envoyes.has(cle)) {
    d.signaler(c.pid, 'SIGKILL');
    await d.attendre(DELAI_KILL_MS);
    return d.vivant(c.pid, c.debut)
      ? { ok: false, phrase: 'Toujours actif après SIGKILL' }
      : { ok: true, phrase: PHRASE_ARRETE };
  }
  d.signaler(c.pid, 'SIGTERM');
  d.envoyes.add(cle);
  await d.attendre(DELAI_ARRET_MS);
  if (!d.vivant(c.pid, c.debut)) return { ok: true, phrase: PHRASE_ARRETE };
  return { ok: false, phrase: 'Toujours actif après 3 s' };
}

export interface DependancesArretTmux {
  readonly sessions: () => Promise<readonly TmuxPoste[]>;
  readonly tuer: (nom: string) => Promise<{ readonly code: number; readonly erreur: string }>;
  readonly journal: Logger;
}

/** Tuer une session tmux : seulement si elle figure dans l'inventaire courant. */
export async function arreterTmux(d: DependancesArretTmux, nom: string): Promise<ResultatGeste> {
  if (!(await d.sessions()).some((s) => s.nom === nom))
    return { ok: false, phrase: 'Session inconnue ou déjà terminée' };
  const r = await d.tuer(nom);
  if (r.code === 0) return { ok: true, phrase: 'Session arrêtée' };
  d.journal.warn({ session: nom, erreur: r.erreur }, 'arrêt de session tmux refusé');
  return { ok: false, phrase: 'Session non arrêtée' };
}
