// Responsabilité : l'extinction automatique des sessions inactives, tenue par le nœud (marche sans Lanterne ouverte).
// La règle est pure (`sessionsAEteindre`) ; le balayage, lui, appelle le poste et ne lève jamais d'erreur.
import type { Logger } from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { ReponsePoste } from '../parc/postes.ts';
import type { ReglageExtinctionAuto } from './extinction-auto-reglage.ts';

const MINUTE_MS = 60_000;
export const INTERVALLE_EXTINCTION_MS = MINUTE_MS;

export type SessionExtinguible = Pick<
  ResumeSession,
  'id' | 'machine' | 'moteur' | 'statut' | 'archivee' | 'duo' | 'majLe'
>;

function inactiveAvant(majLe: string, limite: number): boolean {
  const activite = Date.parse(majLe);
  return Number.isFinite(activite) && activite < limite;
}

// Le nœud ne tient que les sessions sdk (tmux et Desktop lui échappent), en tour fini (`attente` seulement : une
// question attend Chris, un travail tourne), non archivées, et jamais celles qu'un pair nous relaie.
function eteignable(s: SessionExtinguible, machineLocale: (machine: string) => boolean): boolean {
  return (
    s.moteur === 'sdk' &&
    s.statut === 'attente' &&
    s.archivee !== true &&
    !s.duo &&
    machineLocale(s.machine)
  );
}

/** Ids des sessions à éteindre pour `delaiMinutes` (null = jamais), à l'instant `maintenant` (ms). Pur. */
export function sessionsAEteindre(
  sessions: readonly SessionExtinguible[],
  delaiMinutes: number | null,
  maintenant: number,
  machineLocale: (machine: string) => boolean,
): string[] {
  if (delaiMinutes === null) return [];
  const limite = maintenant - delaiMinutes * MINUTE_MS;
  return sessions
    .filter((s) => eteignable(s, machineLocale) && inactiveAvant(s.majLe, limite))
    .map((s) => s.id);
}

export interface SourcesExtinction {
  readonly reglage: Pick<ReglageExtinctionAuto, 'delai'>;
  readonly registre: { sessions(): readonly SessionExtinguible[] };
  readonly postes: {
    enLigne(machine: string): boolean;
    commander(
      machine: string,
      commande: { readonly kind: 'fermer'; readonly sessionId: string },
    ): Promise<ReponsePoste>;
  };
  readonly journal: Logger;
}

async function eteindre(d: SourcesExtinction, machine: string, id: string): Promise<boolean> {
  try {
    const r = await d.postes.commander(machine, { kind: 'fermer', sessionId: id });
    if (!r.ok) {
      d.journal.warn({ session: id, machine, erreur: r.erreur }, 'extinction automatique refusée par le poste');
      return false;
    }
    d.journal.info({ session: id }, 'session éteinte pour inactivité');
    return true;
  } catch (err) {
    d.journal.error({ err, session: id, machine }, 'extinction automatique : échec');
    return false;
  }
}

/** Un passage : éteint les sessions retenues et rend leurs ids. Ne lève jamais d'erreur. */
export async function balayerExtinctionAuto(d: SourcesExtinction, maintenant = Date.now()): Promise<string[]> {
  const delai = d.reglage.delai();
  if (delai === null) return [];
  const sessions = d.registre.sessions();
  const machines = new Map(sessions.map((s) => [s.id, s.machine]));
  const ids = sessionsAEteindre(sessions, delai, maintenant, (m) => d.postes.enLigne(m));
  const eteintes: string[] = [];
  for (const id of ids) {
    const machine = machines.get(id) ?? '';
    if (await eteindre(d, machine, id)) eteintes.push(id);
  }
  return eteintes;
}

/** Le balayage toutes les minutes ; une erreur du passage est journalisée, jamais levée. */
export function lancerExtinctionAuto(d: SourcesExtinction, intervalleMs = INTERVALLE_EXTINCTION_MS): Timer {
  return setInterval(() => {
    balayerExtinctionAuto(d).catch((err: unknown) =>
      d.journal.error({ err }, 'extinction automatique : balayage en échec'),
    );
  }, intervalleMs);
}
