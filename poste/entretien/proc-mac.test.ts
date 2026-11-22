// Responsabilité : tests des analyseurs de la table des processus sous macOS (ps, sysctl) sur des sorties réelles.
import { describe, expect, test } from 'bun:test';
import { entreeDePs, parserBootMac, parserTablePs } from './proc-mac.ts';

const BTIME = 1_700_000_000;
const epoch = (texte: string): number => Math.floor(new Date(texte).getTime() / 1000);

describe('ps -o FORMAT (macOS)', () => {
  test('une ligne : pid, parenté, mémoire en octets, commande, démarrage en battements depuis le boot', () => {
    const ligne = '  4242  4000 Ss     2048 Sat Nov 22 10:00:00 2026 /Users/x/.local/bin/claude --resume abc';
    expect(entreeDePs(ligne, BTIME)).toEqual({
      pid: 4242,
      ppid: 4000,
      comm: 'claude',
      debut: String((epoch('Sat Nov 22 10:00:00 2026') - BTIME) * 100),
      memoire: 2048 * 1024,
      commande: '/Users/x/.local/bin/claude --resume abc',
    });
  });

  test('jour à un chiffre (ps le remplit d’un espace) et binaire de version : même analyse', () => {
    const ligne = '77 1 S 512 Sun Nov  2 08:30:15 2026 /Users/x/.local/share/claude/versions/2.1.325 -p';
    const entree = entreeDePs(ligne, BTIME);
    expect(entree?.comm).toBe('2.1.325');
    expect(entree?.debut).toBe(String((epoch('Sun Nov 2 08:30:15 2026') - BTIME) * 100));
  });

  test('zombie (Z) et ligne illisible : rien', () => {
    expect(entreeDePs('9 1 Z 0 Sat Nov 22 10:00:00 2026 [sh] <defunct>', BTIME)).toBeNull();
    expect(entreeDePs('pas une ligne ps', BTIME)).toBeNull();
  });

  test('commande tronquée à 160 caractères ; sans argument, le nom entre crochets', () => {
    const longue = `1 1 S 1 Sat Nov 22 10:00:00 2026 /bin/x ${'a'.repeat(300)}`;
    expect(entreeDePs(longue, BTIME)?.commande).toHaveLength(160);
    expect(entreeDePs('1 1 S 1 Sat Nov 22 10:00:00 2026 ', BTIME)?.commande).toBe('[]');
  });

  test('la table est indexée par PID et ignore les lignes qui ne sont pas des processus', () => {
    const texte = [
      '  1     0 Ss 100 Sat Nov 22 09:00:00 2026 /sbin/launchd',
      '  9   1 Z 0 Sat Nov 22 10:00:00 2026 [sh] <defunct>',
      'bruit',
      '  12  1 S 300 Sat Nov 22 10:05:00 2026 /usr/bin/zsh',
    ].join('\n');
    const table = parserTablePs(texte, BTIME);
    expect([...table.keys()]).toEqual([1, 12]);
    expect(table.get(12)?.comm).toBe('zsh');
  });
});

describe('sysctl kern.boottime (macOS)', () => {
  test('secondes depuis l’époque, lues de la sortie de sysctl', () => {
    expect(parserBootMac('{ sec = 1700000000, usec = 123456 } Sat Nov 22 09:00:00 2026\n')).toBe(1_700_000_000);
    expect(parserBootMac('')).toBeNull();
  });
});
