// Responsabilité : l'inventaire des processus du poste — les descendants du processus du poste (parenté, jamais un
// motif), leur rôle (tunnel, session, outil, autre), et les restes d'un lancement précédent (registre). Pur, sauf
// `inventairePoste` qui lit /proc et écrit le registre.
import type { Logger } from 'pino';
import type { ProcessusPoste, RoleProcessus } from '../../commun/entretien.ts';
import { type EntreeProc, debutIso, lireBtime, lireTableProc } from './proc.ts';
import { type EntreeRegistre, ecrireRegistre, lireRegistre, nouveauRegistre } from './registre-processus.ts';

const COMMANDES_SESSION = new Set(['claude', 'node', 'bun']);
export const LIBELLE_TUNNEL = 'Tunnel SSH';

/** Les descendants de la racine, parents avant enfants (parcours en largeur, sans cycle). La racine est exclue. */
export function descendants(racine: number, table: ReadonlyMap<number, EntreeProc>): EntreeProc[] {
  const enfants = new Map<number, EntreeProc[]>();
  for (const p of table.values()) enfants.set(p.ppid, [...(enfants.get(p.ppid) ?? []), p]);
  const vus = new Set<number>([racine]);
  const file: number[] = [racine];
  const resultat: EntreeProc[] = [];
  for (let i = 0; i < file.length; i++) {
    for (const e of enfants.get(file[i] ?? -1) ?? []) {
      if (vus.has(e.pid)) continue;
      vus.add(e.pid);
      resultat.push(e);
      file.push(e.pid);
    }
  }
  return resultat;
}

/**
 * Le rôle de chaque descendant. Tunnel : un `ssh` enfant direct de la racine (le relais ouvre ses tunnels). Session :
 * un `claude`, ou un enfant direct qui exécute Claude (SDK). Outil : ce qui descend d'une session. Autre : le reste.
 */
export function rolesDe(desc: readonly EntreeProc[], racine: number): Map<number, RoleProcessus> {
  const roles = new Map<number, RoleProcessus>();
  const dansSession = new Set<number>();
  for (const e of desc) {
    const estSession = e.comm === 'claude' || (e.ppid === racine && COMMANDES_SESSION.has(e.comm));
    if (e.comm === 'ssh' && e.ppid === racine) roles.set(e.pid, 'tunnel');
    else if (estSession) roles.set(e.pid, 'session');
    else if (dansSession.has(e.ppid)) roles.set(e.pid, 'outil');
    else roles.set(e.pid, 'autre');
    if (roles.get(e.pid) === 'session' || roles.get(e.pid) === 'outil') dansSession.add(e.pid);
  }
  return roles;
}

export interface EntreesInventaire {
  readonly table: ReadonlyMap<number, EntreeProc>;
  readonly racine: number;
  readonly btime: number | null;
  readonly precedent: readonly EntreeRegistre[];
  readonly lancement: string;
  readonly sessionDePid: (pid: number) => string | null;
}

function versProcessus(
  e: EntreeProc,
  role: RoleProcessus,
  session: string | null,
  btime: number | null,
  reste: boolean,
): ProcessusPoste {
  return {
    pid: e.pid,
    debut: e.debut,
    ppid: e.ppid,
    commande: role === 'tunnel' ? LIBELLE_TUNNEL : e.commande,
    role,
    session,
    depuis: btime === null ? '' : debutIso(btime, e.debut),
    memoire: e.memoire,
    reste,
  };
}

/** L'inventaire et le registre à écrire, à partir d'une table de processus déjà lue. Pur. */
export function assemblerInventaire(e: EntreesInventaire): { processus: ProcessusPoste[]; registre: EntreeRegistre[] } {
  const desc = descendants(e.racine, e.table);
  const roles = rolesDe(desc, e.racine);
  const sessionDe = (pid: number): string | null => (roles.get(pid) === 'session' ? e.sessionDePid(pid) : null);
  const vus = desc.map((p) => ({ pid: p.pid, debut: p.debut, session: sessionDe(p.pid) }));
  const vivant = (pid: number, debut: string): boolean => e.table.get(pid)?.debut === debut;
  const { registre, restes } = nouveauRegistre(e.precedent, vus, e.lancement, vivant);
  const actifs = desc.map((p) => versProcessus(p, roles.get(p.pid) ?? 'autre', sessionDe(p.pid), e.btime, false));
  const encoreLa = restes.flatMap((r) => {
    const p = e.table.get(r.pid);
    // Un processus détaché de sa session pendant CE lancement (serveur mis en fond) n'est pas un reste d'avant.
    return p ? [versProcessus(p, 'autre', r.session, e.btime, r.lancement !== e.lancement)] : [];
  });
  return { processus: [...actifs, ...encoreLa], registre };
}

export interface DependancesInventaire {
  readonly racine: number;
  readonly lancement: string;
  readonly fichierRegistre: string;
  readonly sessionDePid: (pid: number) => string | null;
  readonly journal: Logger;
}

/** L'inventaire réel du poste : lit /proc et le registre, puis réécrit le registre (0600). */
export function inventairePoste(d: DependancesInventaire): ProcessusPoste[] {
  const { processus, registre } = assemblerInventaire({
    table: lireTableProc(d.journal),
    racine: d.racine,
    btime: lireBtime(d.journal),
    precedent: lireRegistre(d.fichierRegistre, d.journal),
    lancement: d.lancement,
    sessionDePid: d.sessionDePid,
  });
  ecrireRegistre(d.fichierRegistre, registre, d.journal);
  return processus;
}
