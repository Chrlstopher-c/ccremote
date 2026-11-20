// Responsabilité : tests des analyseurs /proc (parenté, heure de démarrage, mémoire, commande) sur des textes réels.
import { describe, expect, test } from 'bun:test';
import { commandeDe, debutIso, estTermine, parserBtime, parserMemoire, parserStat } from './proc.ts';

describe('/proc/<pid>/stat', () => {
  test('ppid et heure de démarrage (champ 22), même avec des espaces dans le nom', () => {
    const texte = '4242 (mon outil (v2)) S 4000 4242 4242 0 -1 4194560 100 0 0 0 5 2 0 0 20 0 1 0 987654 0 0';
    expect(parserStat(texte)).toEqual({ comm: 'mon outil (v2)', ppid: 4000, debut: '987654' });
  });

  test('texte tronqué ou sans parenthèses : rien', () => {
    expect(parserStat('4242 bash S 1 2 3')).toBeNull();
    expect(parserStat('4242 (bash) S 1')).toBeNull();
  });
});

describe('mémoire, commande, démarrage', () => {
  test('VmRSS converti en octets ; absent → 0', () => {
    expect(parserMemoire('Name:\tssh\nVmRSS:\t   2048 kB\n')).toBe(2048 * 1024);
    expect(parserMemoire('Name:\tzombie\n')).toBe(0);
  });

  test('argv joint par espaces, tronqué à 160 caractères', () => {
    expect(commandeDe('ssh\0-N\0-p\0cible\0')).toBe('ssh -N -p cible');
    expect(commandeDe('x'.repeat(300))).toHaveLength(160);
  });

  test('btime lu de /proc/stat, et démarrage en ISO (100 battements par seconde)', () => {
    expect(parserBtime('cpu 1 2 3\nbtime 1700000000\nprocesses 9\n')).toBe(1_700_000_000);
    expect(parserBtime('cpu 1 2 3\n')).toBeNull();
    expect(debutIso(1_700_000_000, '250')).toBe(new Date(1_700_000_002_500).toISOString());
  });
});

describe('processus terminés', () => {
  test('un zombie ou un mort n’est pas un processus à montrer', () => {
    expect(estTermine('4242 (tar) Z 4000 1 1 0 -1 0')).toBe(true);
    expect(estTermine('4242 (a) b) X 4000 1')).toBe(true);
    expect(estTermine('4242 (bash) S 4000 1 1 0 -1 0')).toBe(false);
  });
});
