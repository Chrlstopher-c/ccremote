// Responsabilité : la liaison occupée d'une machine — trouver le sshd qui tient le port distant, et le libérer, par SSH
// sur la machine (commandes fixes, PID entiers validés, aucun texte libre). L'exécuteur SSH est injecté.
import type { Logger } from 'pino';
import type { OccupantLiaison, ResultatGeste } from '../../commun/entretien.ts';
import type { ConnexionSsh, Ssh } from '../machines/ssh.ts';

const DELAI_MS = 10_000;
/** OpenSSH ≥ 9.8 sépare la session dans `sshd-session` (Arch) ; avant, c'est `sshd` (Debian du Pi). */
const PROGRAMMES_SSHD: ReadonlySet<string> = new Set(['sshd', 'sshd-session']);
const AUCUN: OccupantLiaison = { occupe: false, pid: null, depuis: null };

export interface DependancesLiaisons {
  readonly ssh: Pick<Ssh, 'executer'>;
  readonly journal: Logger;
}

/** Le PID du processus en écoute, d'après la sortie de `ss -Hltnp` (« users:(("sshd",pid=4242,fd=7)) »). */
export function analyserOccupant(sortie: string): number | null {
  const m = /pid=(\d+)/.exec(sortie);
  return m?.[1] ? Number(m[1]) : null;
}

/** Le nom du programme, son propriétaire et sa date de démarrage, d'après `ps -o user=,comm=,lstart= -p <pid>`. */
export function analyserProcessus(sortie: string): { user: string; comm: string; lstart: string } | null {
  const c = sortie.trim().split(/\s+/);
  if (c.length < 3 || !c[0] || !c[1]) return null;
  return { user: c[0], comm: c[1], lstart: c.slice(2).join(' ') };
}

function pidValide(pid: number): boolean {
  return Number.isInteger(pid) && pid > 1 && pid < 4_194_305;
}

/** Qui tient le port distant de la machine : seulement un sshd de l'utilisateur de la fiche. */
export async function occupant(d: DependancesLiaisons, c: ConnexionSsh, portDistant: number): Promise<OccupantLiaison> {
  if (!Number.isInteger(portDistant) || portDistant < 1 || portDistant > 65535) return AUCUN;
  const ss = await d.ssh.executer(c, `ss -Hltnp 'sport = :${portDistant}'`, null, DELAI_MS);
  const pid = ss.code === 0 ? analyserOccupant(ss.sortie) : null;
  if (pid === null || !pidValide(pid)) return AUCUN;
  const ps = await d.ssh.executer(c, `ps -o user=,comm=,lstart= -p ${pid}`, null, DELAI_MS);
  const proc = ps.code === 0 ? analyserProcessus(ps.sortie) : null;
  if (!proc || !PROGRAMMES_SSHD.has(proc.comm) || proc.user !== c.utilisateur) return AUCUN;
  const depuis = new Date(proc.lstart);
  return { occupe: true, pid, depuis: Number.isNaN(depuis.getTime()) ? null : depuis.toISOString() };
}

/** Envoie un signal d'arrêt standard au PID entier déjà vérifié comme occupant de la liaison, sur la machine. */
export async function tuerOccupant(d: DependancesLiaisons, c: ConnexionSsh, pid: number): Promise<ResultatGeste> {
  if (!pidValide(pid)) return { ok: false, phrase: 'Processus invalide' };
  const r = await d.ssh.executer(c, `kill ${pid}`, null, DELAI_MS);
  if (r.code === 0) return { ok: true, phrase: 'Processus arrêté' };
  d.journal.warn({ pid, code: r.code, erreurs: r.erreurs }, 'arrêt du sshd occupant refusé');
  return { ok: false, phrase: 'Processus non arrêté' };
}
