import { describe, expect, test } from 'bun:test';
import {
  comptesNumstat,
  compterLignes,
  etatsNameStatus,
  hunkNouveauFichier,
  hunksUnifies,
  lignesDe,
} from './analyse-diff.ts';

describe('lecture des sorties de git', () => {
  test('name-status -z : états et chemins par paires NUL', () => {
    expect(etatsNameStatus('M\0src/a.ts\0A\0b.md\0D\0c.txt\0')).toEqual([
      { etat: 'modifie', chemin: 'src/a.ts' },
      { etat: 'ajoute', chemin: 'b.md' },
      { etat: 'supprime', chemin: 'c.txt' },
    ]);
  });

  test('numstat -z : comptes, binaire sans compte, chemin contenant une tabulation', () => {
    expect(comptesNumstat('3\t1\tsrc/a.ts\0-\t-\tlogo.png\0')).toEqual([
      { chemin: 'src/a.ts', ajouts: 3, suppressions: 1, binaire: false },
      { chemin: 'logo.png', ajouts: 0, suppressions: 0, binaire: true },
    ]);
    expect(comptesNumstat('1\t0\ta\tb.txt\0')[0]?.chemin).toBe('a\tb.txt');
  });
});

describe('hunks d’un diff unifié', () => {
  const sortie = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,3 +2,4 @@\n a\n-b\n+c\n+d\n e\n';

  test('numérote les lignes d’ancien et de nouveau fichier', () => {
    const hunks = hunksUnifies(sortie);
    expect(hunks).toHaveLength(1);
    expect([hunks[0]?.ancienDebut, hunks[0]?.nouveauDebut]).toEqual([2, 2]);
    expect(hunks[0]?.lignes).toEqual([
      { genre: 'contexte', ancien: 2, nouveau: 2, texte: 'a' },
      { genre: 'retrait', ancien: 3, nouveau: null, texte: 'b' },
      { genre: 'ajout', ancien: null, nouveau: 3, texte: 'c' },
      { genre: 'ajout', ancien: null, nouveau: 4, texte: 'd' },
      { genre: 'contexte', ancien: 4, nouveau: 5, texte: 'e' },
    ]);
  });

  test('les en-têtes de fichier ne deviennent jamais des lignes', () => {
    const lignes = hunksUnifies(sortie).flatMap((h) => h.lignes);
    expect(lignes.some((l) => l.texte.startsWith('-- a/x') || l.texte.startsWith('++ b/x'))).toBe(false);
  });

  test('un nouveau fichier est un seul hunk d’ajouts', () => {
    expect(hunkNouveauFichier('un\ndeux\n')).toEqual([
      {
        ancienDebut: 0,
        nouveauDebut: 1,
        lignes: [
          { genre: 'ajout', ancien: null, nouveau: 1, texte: 'un' },
          { genre: 'ajout', ancien: null, nouveau: 2, texte: 'deux' },
        ],
      },
    ]);
    expect(hunkNouveauFichier('')).toEqual([]);
  });

  test('lignes et comptage comme `str::lines` : pas de ligne vide finale', () => {
    expect(lignesDe('a\nb\n')).toEqual(['a', 'b']);
    expect(lignesDe('a\r\nb')).toEqual(['a', 'b']);
    expect(compterLignes('')).toBe(0);
    expect(compterLignes('a\n\n')).toBe(2);
  });
});
