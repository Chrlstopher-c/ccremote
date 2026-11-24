// Responsabilité : tests de la CLI `noctis-nav` — analyse des arguments (outil, cle=valeur, valeurs typées), aide,
// sortie JSON compacte sur stdout, erreur sur stderr avec le code 1.
import { describe, expect, test } from 'bun:test';
import type { ArgsNav, OutilNav } from './client.d.mts';
import { analyser, ErreurUsage, executerCli, lireParametre, texteAide, valeurCli } from './cli.mjs';

function sorties() {
  const sortie: string[] = [];
  const erreur: string[] = [];
  return {
    sorties: { sortie: (t: string) => void sortie.push(t), erreur: (t: string) => void erreur.push(t) },
    sortie,
    erreur,
  };
}

describe('analyse des arguments', () => {
  test('sans outil, ou « aide » : aide', () => {
    expect(analyser([])).toEqual({ aide: true });
    expect(analyser(['aide'])).toEqual({ aide: true });
  });

  test('un outil et ses paramètres cle=valeur', () => {
    expect(analyser(['lire', 'filtre=tout'])).toEqual({ aide: false, outil: 'lire', args: { filtre: 'tout' } });
    expect(analyser(['cliquer', 'x=10', 'y=-3.5'])).toEqual({
      aide: false,
      outil: 'cliquer',
      args: { x: 10, y: -3.5 },
    });
    expect(analyser(['cliquer', 'ref=ref_3'])).toEqual({ aide: false, outil: 'cliquer', args: { ref: 'ref_3' } });
  });

  test('la valeur s’arrête au premier « = » : une URL avec des paramètres passe telle quelle', () => {
    expect(lireParametre('url=https://x.org/?a=1&b=2')).toEqual(['url', 'https://x.org/?a=1&b=2']);
  });

  test('valeurs typées : booléens, nombres, null, JSON ; le texte reste texte', () => {
    expect(valeurCli('true')).toBe(true);
    expect(valeurCli('false')).toBe(false);
    expect(valeurCli('null')).toBeNull();
    expect(valeurCli('2026')).toBe(2026);
    expect(valeurCli('"2026"')).toBe('2026');
    expect(valeurCli('[1,2]')).toEqual([1, 2]);
    expect(valeurCli('{"a":1}')).toEqual({ a: 1 });
    expect(valeurCli('Entrée')).toBe('Entrée');
  });

  test('outil inconnu, paramètre sans « = », clé vide ou JSON invalide : ErreurUsage', () => {
    expect(() => analyser(['inconnu'])).toThrow(ErreurUsage);
    expect(() => analyser(['lire', 'filtre'])).toThrow('paramètre attendu : cle=valeur');
    expect(() => analyser(['lire', '=tout'])).toThrow(ErreurUsage);
    expect(() => analyser(['executer', 'js={oops'])).toThrow('JSON invalide');
  });

  test('l’aide nomme chaque outil', () => {
    const aide = texteAide();
    for (const outil of ['ouvrir', 'lire', 'cliquer', 'executer']) expect(aide).toContain(outil);
  });
});

describe('exécution', () => {
  test('succès : résultat en JSON compact sur stdout, code 0', async () => {
    const s = sorties();
    const appels: { outil: OutilNav; args: ArgsNav }[] = [];
    const code = await executerCli(['cliquer', 'ref=ref_3'], s.sorties, async (outil, args) => {
      appels.push({ outil, args });
      return { ok: true, url: 'https://x' };
    });
    expect(code).toBe(0);
    expect(appels).toEqual([{ outil: 'cliquer', args: { ref: 'ref_3' } }]);
    expect(s.sortie).toEqual(['{"ok":true,"url":"https://x"}\n']);
    expect(s.erreur).toEqual([]);
  });

  test('erreur de l’outil : message sur stderr, code 1, rien sur stdout', async () => {
    const s = sorties();
    const code = await executerCli(['lire'], s.sorties, async () => {
      throw new Error('navigateur.lire : Lanterne n’est pas en service');
    });
    expect(code).toBe(1);
    expect(s.sortie).toEqual([]);
    expect(s.erreur).toEqual(['noctis-nav : navigateur.lire : Lanterne n’est pas en service\n']);
  });

  test('outil inconnu : code 1 sans appel', async () => {
    const s = sorties();
    let appele = false;
    const code = await executerCli(['nope'], s.sorties, async () => {
      appele = true;
      return null;
    });
    expect(code).toBe(1);
    expect(appele).toBe(false);
    expect(s.erreur[0]).toContain('outil inconnu : nope');
  });

  test('aide : texte sur stdout, code 0, aucun appel', async () => {
    const s = sorties();
    const code = await executerCli(['aide'], s.sorties, async () => null);
    expect(code).toBe(0);
    expect(s.sortie.join('')).toContain('noctis-nav <outil>');
  });
});
