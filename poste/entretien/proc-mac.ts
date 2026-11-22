// Responsabilité : lire la table des processus sous macOS (ps, sysctl) dans la même forme que /proc
// (EntreeProc, heure de démarrage en battements depuis le démarrage du système) : l'inventaire et les identités
// restent les mêmes que sous Linux.
// Les analyseurs sont purs et testés ; les appels à ps et sysctl sont isolés en fin de fichier.
import { basename } from 'node:path';
import type { Logger } from 'pino';
import { CLK_TCK, type EntreeProc, MAX_COMMANDE } from './proc.ts';

export const FORMAT_PS = 'pid=,ppid=,stat=,rss=,lstart=,args=';
const LIGNE_PS = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;

/** Une ligne de `ps -o FORMAT_PS` ; null si elle ne décrit pas un processus vivant (zombie, texte étranger). */
export function entreeDePs(ligne: string, btime: number): EntreeProc | null {
  const m = LIGNE_PS.exec(ligne);
  if (!m) return null;
  const [, pid = '', ppid = '', etat = '', rss = '0', lancement = '', args = ''] = m;
  if (etat.startsWith('Z')) return null;
  const instant = Date.parse(lancement.replace(/\s+/g, ' ')) / 1000;
  if (Number.isNaN(instant)) return null;
  const comm = basename(args.split(' ')[0] ?? '');
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    comm,
    debut: String(Math.max(0, Math.floor(instant) - btime) * CLK_TCK),
    memoire: Number(rss) * 1024,
    commande: args.slice(0, MAX_COMMANDE) || `[${comm}]`,
  };
}

/** La table `pid → processus` d'une sortie complète de `ps -axww -o FORMAT_PS`. */
export function parserTablePs(texte: string, btime: number): Map<number, EntreeProc> {
  const table = new Map<number, EntreeProc>();
  for (const ligne of texte.split('\n')) {
    const entree = entreeDePs(ligne, btime);
    if (entree) table.set(entree.pid, entree);
  }
  return table;
}

/** Secondes depuis l'époque du démarrage, tirées de `sysctl -n kern.boottime` (`{ sec = N, usec = M } …`). */
export function parserBootMac(texte: string): number | null {
  const m = /sec = (\d+)/.exec(texte);
  return m?.[1] ? Number(m[1]) : null;
}

/** `ps` en locale C : les dates de `lstart` doivent rester en anglais, quelle que soit la langue de la machine. */
function executerPs(args: readonly string[]): string | null {
  const r = Bun.spawnSync(['ps', ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, LC_ALL: 'C' } });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** L'heure de démarrage du système, ou null si sysctl ne répond pas. */
export function lireBootMac(): number | null {
  const r = Bun.spawnSync(['sysctl', '-n', 'kern.boottime'], { stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? parserBootMac(r.stdout.toString()) : null;
}

/** Tous les processus visibles ; une table vide (avec un avertissement) si ps ou sysctl échouent. */
export function lireTableProcMac(journal: Logger): Map<number, EntreeProc> {
  const btime = lireBootMac();
  const texte = executerPs(['-axww', '-o', FORMAT_PS]);
  if (btime === null || texte === null) {
    journal.warn({ btime, ps: texte !== null }, 'table des processus macOS indisponible');
    return new Map();
  }
  return parserTablePs(texte, btime);
}

/** Un processus par son PID, ou null s'il a disparu ou si l'heure du système est illisible. */
export function lireProcessusMac(pid: number): EntreeProc | null {
  const btime = lireBootMac();
  const texte = executerPs(['-ww', '-o', FORMAT_PS, '-p', String(pid)]);
  return btime === null || texte === null ? null : entreeDePs(texte.trim(), btime);
}

/** Environnement brut d'un processus (`ps -E`), pour repérer TMUX ; chaîne vide si illisible. */
export function environnementMac(pid: number): string {
  return executerPs(['-wwwE', '-o', 'command=', '-p', String(pid)]) ?? '';
}
