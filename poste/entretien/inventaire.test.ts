// Responsabilité : tests de l'inventaire par parenté — descendants, rôles, restes, PID réutilisés, tunnels.
import { describe, expect, test } from 'bun:test';
import type { EntreeProc } from './proc.ts';
import { assemblerInventaire, descendants, rolesDe } from './inventaire.ts';
import type { EntreeRegistre } from './registre-processus.ts';

const RACINE = 1000;
const BTIME = 1_700_000_000;

function p(pid: number, ppid: number, comm: string, debut = String(pid * 10)): EntreeProc {
  return { pid, ppid, comm, debut, memoire: 1024, commande: comm };
}

function table(...liste: EntreeProc[]): Map<number, EntreeProc> {
  return new Map(liste.map((e) => [e.pid, e]));
}

// Le poste (1000) : un tunnel ssh, une session SDK (node) avec un outil, un processus sans rapport (lié à un autre
// parent), et un ssh orphelin (ppid 1) qui n'est pas un descendant.
const TABLE = table(
  p(1000, 1, 'lanterne-moteur'),
  p(1001, 1000, 'ssh'),
  p(1002, 1000, 'node'),
  p(1003, 1002, 'git'),
  p(1004, 1003, 'sh'),
  p(1005, 1, 'bash'),
  p(1006, 1005, 'ssh'),
  p(1007, 1000, 'claude', '77'),
);

describe('descendants', () => {
  test('parcours depuis la racine : parents avant enfants, racine exclue, processus étrangers exclus', () => {
    expect(descendants(RACINE, TABLE).map((e) => e.pid)).toEqual([1001, 1002, 1007, 1003, 1004]);
  });

  test('un cycle de parenté ne boucle pas', () => {
    const cyc = table(p(2, 3, 'a'), p(3, 2, 'b'));
    expect(descendants(2, cyc).map((e) => e.pid)).toEqual([3]);
  });
});

describe('rôles', () => {
  test('tunnel, session, outil : ssh enfant direct ; node ou claude enfant ; ce qui descend d’une session', () => {
    const desc = descendants(RACINE, TABLE);
    const roles = rolesDe(desc, RACINE);
    expect(roles.get(1001)).toBe('tunnel');
    expect(roles.get(1002)).toBe('session');
    expect(roles.get(1003)).toBe('outil');
    expect(roles.get(1004)).toBe('outil');
    expect(roles.get(1007)).toBe('session');
  });

  test('un ssh qui n’est pas enfant direct de la racine n’est pas un tunnel', () => {
    const t = table(p(1000, 1, 'moteur'), p(1001, 1000, 'node'), p(1002, 1001, 'ssh'));
    expect(rolesDe(descendants(1000, t), 1000).get(1002)).toBe('outil');
  });
});

describe('assemblage de l’inventaire', () => {
  test('actifs : rôle, commande (tunnel nommé sans hôte), démarrage en ISO, mémoire', () => {
    const { processus } = assemblerInventaire({
      table: TABLE,
      racine: RACINE,
      btime: BTIME,
      precedent: [],
      lancement: 'L2',
      sessionDePid: () => 'sess-9',
    });
    const tunnel = processus.find((x) => x.pid === 1001);
    expect(tunnel).toMatchObject({ role: 'tunnel', commande: 'Tunnel SSH', reste: false, session: null });
    expect(tunnel?.depuis).toBe(new Date((BTIME + 10010 / 100) * 1000).toISOString());
    const session = processus.find((x) => x.pid === 1002);
    expect(session).toMatchObject({ role: 'session', session: 'sess-9', memoire: 1024 });
    expect(processus.find((x) => x.pid === 1003)?.session).toBeNull();
  });

  test('un reste vivant avec la même heure est signalé ; un PID réutilisé ne l’est pas', () => {
    const precedent: EntreeRegistre[] = [
      { pid: 1006, debut: '10060', session: null, lancement: 'L1' }, // ssh orphelin, vivant, même heure
      { pid: 1005, debut: '999', session: null, lancement: 'L1' }, // PID réutilisé : heure différente
      { pid: 4444, debut: '1', session: null, lancement: 'L1' }, // mort
    ];
    const { processus, registre } = assemblerInventaire({
      table: TABLE,
      racine: RACINE,
      btime: BTIME,
      precedent,
      lancement: 'L2',
      sessionDePid: () => null,
    });
    const restes = processus.filter((x) => x.reste);
    expect(restes.map((x) => x.pid)).toEqual([1006]);
    expect(restes[0]?.role).toBe('autre');
    expect(registre.map((e) => e.lancement)).toEqual(['L2', 'L2', 'L2', 'L2', 'L2', 'L1']);
  });

  test('un processus détaché pendant le lancement en cours reste listé, sans être un reste', () => {
    const precedent: EntreeRegistre[] = [{ pid: 1006, debut: '10060', session: 'S1', lancement: 'L2' }];
    const { processus, registre } = assemblerInventaire({
      table: TABLE,
      racine: RACINE,
      btime: BTIME,
      precedent,
      lancement: 'L2',
      sessionDePid: () => null,
    });
    expect(processus.find((x) => x.pid === 1006)).toMatchObject({ reste: false, role: 'autre', session: 'S1' });
    expect(registre.filter((e) => e.pid === 1006)).toHaveLength(1);
  });

  test('le poste lui-même et ses ancêtres n’entrent jamais dans l’inventaire', () => {
    const { processus } = assemblerInventaire({
      table: TABLE,
      racine: RACINE,
      btime: null,
      precedent: [],
      lancement: 'L',
      sessionDePid: () => null,
    });
    expect(processus.some((x) => x.pid === RACINE || x.pid === 1)).toBe(false);
    expect(processus.every((x) => x.depuis === '')).toBe(true);
  });
});
