// Responsabilité : lire la table des processus Linux (/proc) — parenté, heure de démarrage, mémoire, commande. Les
// analyseurs sont purs ; seule `lireTableProc` touche /proc, et ne lit jamais par motif.
import { readdirSync, readFileSync } from 'node:fs';
import type { Logger } from 'pino';

/** Les battements par seconde du noyau (`USER_HZ`), fixés à 100 sur Linux : l'heure de démarrage en découle. */
export const CLK_TCK = 100;
export const MAX_COMMANDE = 160;

export interface EntreeProc {
  readonly pid: number;
  readonly ppid: number;
  readonly comm: string;
  /** Heure de démarrage en battements du noyau (champ 22 de /proc/<pid>/stat) : avec le PID, l'identité. */
  readonly debut: string;
  readonly memoire: number;
  readonly commande: string;
}

/** Le nom du programme et la parenté d'un `/proc/<pid>/stat` ; le nom peut contenir espaces et parenthèses. */
export function parserStat(texte: string): { comm: string; ppid: number; debut: string } | null {
  const ouvre = texte.indexOf('(');
  const ferme = texte.lastIndexOf(')');
  if (ouvre < 0 || ferme < ouvre) return null;
  const champs = texte.slice(ferme + 2).split(' ');
  const ppid = Number(champs[1]);
  const debut = champs[19];
  if (!Number.isInteger(ppid) || !debut || !/^\d+$/.test(debut)) return null;
  return { comm: texte.slice(ouvre + 1, ferme), ppid, debut };
}

/** La mémoire résidente (VmRSS) en octets ; 0 si absente. */
export function parserMemoire(statusTexte: string): number {
  const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(statusTexte);
  return m?.[1] ? Number(m[1]) * 1024 : 0;
}

/** L'argv d'un `cmdline` (séparé par NUL), joint et tronqué. */
export function commandeDe(cmdline: string): string {
  return cmdline.split('\0').filter(Boolean).join(' ').slice(0, MAX_COMMANDE);
}

/** L'instant de démarrage du système (`btime` de /proc/stat), en secondes depuis l'époque. */
export function parserBtime(statTexte: string): number | null {
  const m = /^btime\s+(\d+)/m.exec(statTexte);
  return m?.[1] ? Number(m[1]) : null;
}

/** Heure de démarrage du processus en ISO, à partir de l'heure du système et du champ 22. */
export function debutIso(btime: number, debut: string): string {
  return new Date((btime + Number(debut) / CLK_TCK) * 1000).toISOString();
}

// Un fichier qui disparaît (processus terminé entre deux lectures) est normal ; toute autre erreur est journalisée.
function lire(chemin: string, journal: Logger): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT' && (erreur as NodeJS.ErrnoException).code !== 'ESRCH') {
      journal.debug({ chemin, err: erreur }, '/proc illisible');
    }
    return null;
  }
}

/** Un processus lu dans /proc, ou `null` s'il a disparu ou n'est pas lisible. */
export function lireProcessus(pid: number, journal: Logger): EntreeProc | null {
  const base = `/proc/${pid}`;
  const stat = lire(`${base}/stat`, journal);
  const parse = stat ? parserStat(stat) : null;
  if (!parse) return null;
  const status = lire(`${base}/status`, journal) ?? '';
  const cmdline = lire(`${base}/cmdline`, journal) ?? '';
  return { pid, ...parse, memoire: parserMemoire(status), commande: commandeDe(cmdline) || `[${parse.comm}]` };
}

/** Tous les processus visibles, indexés par PID. Le PID 0 et les entrées non numériques de /proc sont ignorés. */
export function lireTableProc(journal: Logger): Map<number, EntreeProc> {
  const table = new Map<number, EntreeProc>();
  let entrees: string[];
  try {
    entrees = readdirSync('/proc');
  } catch (erreur) {
    journal.warn({ err: erreur }, '/proc illisible : pas d’inventaire des processus');
    return table;
  }
  for (const nom of entrees) {
    if (!/^\d+$/.test(nom)) continue;
    const pid = Number(nom);
    const p = pid > 0 ? lireProcessus(pid, journal) : null;
    if (p) table.set(pid, p);
  }
  return table;
}

/** L'heure de démarrage du système, lue une fois : null si /proc/stat est illisible. */
export function lireBtime(journal: Logger): number | null {
  const texte = lire('/proc/stat', journal);
  return texte === null ? null : parserBtime(texte);
}
