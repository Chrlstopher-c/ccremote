import { describe, expect, test } from 'bun:test';
import { ConfigMachine, ModifMachine, cheminShell, cheminValide, citer } from './modele.ts';

const BASE = { id: 'vps-test', hote: 'machine.exemple.test', utilisateur: 'utilisateur', cle: '/chemin/vers/cle' };

describe('config de machine', () => {
  test('accepte une configuration complète et applique les défauts', () => {
    const c = ConfigMachine.parse(BASE);
    expect(c.port).toBe(22);
    expect(c.dossier).toBe('~');
    expect(c.description).toBe('');
  });

  test('refuse un identifiant, un hôte commençant par un tiret, une clé relative', () => {
    expect(ConfigMachine.safeParse({ ...BASE, id: 'Mauvais Id' }).success).toBe(false);
    expect(ConfigMachine.safeParse({ ...BASE, hote: '-oProxyCommand=x' }).success).toBe(false);
    expect(ConfigMachine.safeParse({ ...BASE, cle: 'cle' }).success).toBe(false);
  });

  test('refuse un port hors plage et un utilisateur invalide', () => {
    expect(ConfigMachine.safeParse({ ...BASE, port: 70000 }).success).toBe(false);
    expect(ConfigMachine.safeParse({ ...BASE, utilisateur: 'a b' }).success).toBe(false);
  });
});

describe('modification partielle', () => {
  test('un PATCH ne remplit pas les champs absents (pas de défaut réappliqué)', () => {
    const m = ModifMachine.parse({ dossier: '~/dev' });
    expect(m).toEqual({ dossier: '~/dev' });
  });
});

describe('chemins distants', () => {
  test('cheminValide : absolu ou tilde, sans saut de ligne', () => {
    expect(cheminValide('/mnt/projects')).toBe(true);
    expect(cheminValide('~/dev')).toBe(true);
    expect(cheminValide('~')).toBe(true);
    expect(cheminValide('dev/relatif')).toBe(false);
    expect(cheminValide('/a\nb')).toBe(false);
  });

  test('citer échappe les apostrophes', () => {
    expect(citer("a'b")).toBe(`'a'\\''b'`);
    expect(citer('$(rm -rf /)')).toBe(`'$(rm -rf /)'`);
  });

  test('cheminShell développe le tilde à l’exécution, pas à l’écriture', () => {
    expect(cheminShell('~/dev x')).toBe(`"$HOME"/'dev x'`);
    expect(cheminShell('~')).toBe('"$HOME"');
    expect(cheminShell('/srv')).toBe(`'/srv'`);
  });
});
