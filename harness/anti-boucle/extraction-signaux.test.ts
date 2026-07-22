import { describe, expect, test } from 'bun:test';
import { extraireSignaux } from './extraction-signaux.ts';
import type { ResumeTour } from './types.ts';

function tour(partiel: Partial<ResumeTour> & { index: number }): ResumeTour {
  return {
    outils: [],
    erreur: null,
    fichiersModifies: [],
    testsEchoues: [],
    ...partiel,
  };
}

describe('extraireSignaux', () => {
  test('aucun signal sur des tours propres et progressifs', () => {
    const tours = [
      tour({ index: 0, outils: [{ nom: 'Edit', cible: 'a.ts' }], fichiersModifies: [{ chemin: 'a.ts' }] }),
      tour({ index: 1, outils: [{ nom: 'Edit', cible: 'b.ts' }], fichiersModifies: [{ chemin: 'b.ts' }] }),
    ];
    const signaux = extraireSignaux(tours);
    expect(signaux.outilsMemeCible).toEqual([]);
    expect(signaux.erreurRepetee).toBeNull();
    expect(signaux.toursSansModification).toBe(0);
    expect(signaux.testsEchouantIdentique).toEqual([]);
    expect(signaux.reecritureAlternee).toEqual([]);
  });

  test('mêmes outils sur la même cible ⇒ signal outilsMemeCible', () => {
    const tours = [
      tour({ index: 0, outils: [{ nom: 'Bash', cible: 'npm test' }] }),
      tour({ index: 1, outils: [{ nom: 'Bash', cible: 'npm test' }] }),
      tour({ index: 2, outils: [{ nom: 'Bash', cible: 'npm test' }] }),
    ];
    const signaux = extraireSignaux(tours);
    expect(signaux.outilsMemeCible).toEqual([{ nom: 'Bash', cible: 'npm test', occurrences: 3 }]);
  });

  test('même erreur répétée ⇒ erreurRepetee non nul', () => {
    const tours = [
      tour({ index: 0, erreur: 'TypeError: x is undefined' }),
      tour({ index: 1, erreur: 'TypeError: x is undefined' }),
    ];
    const signaux = extraireSignaux(tours);
    expect(signaux.erreurRepetee).toEqual({ message: 'TypeError: x is undefined', occurrences: 2 });
  });

  test('une erreur isolée (une seule occurrence) n’est pas un signal', () => {
    const tours = [tour({ index: 0, erreur: 'panne unique' }), tour({ index: 1 })];
    expect(extraireSignaux(tours).erreurRepetee).toBeNull();
  });

  test('aucun fichier modifié depuis plusieurs tours ⇒ streak final compté', () => {
    const tours = [
      tour({ index: 0, fichiersModifies: [{ chemin: 'a.ts' }] }),
      tour({ index: 1, fichiersModifies: [] }),
      tour({ index: 2, fichiersModifies: [] }),
      tour({ index: 3, fichiersModifies: [] }),
    ];
    expect(extraireSignaux(tours).toursSansModification).toBe(3);
  });

  test('une modification récente interrompt le streak même si le début était vide', () => {
    const tours = [
      tour({ index: 0, fichiersModifies: [] }),
      tour({ index: 1, fichiersModifies: [] }),
      tour({ index: 2, fichiersModifies: [{ chemin: 'a.ts' }] }),
    ];
    expect(extraireSignaux(tours).toursSansModification).toBe(0);
  });

  test('tests échouant à l’identique sur plusieurs tours ⇒ signal', () => {
    const tours = [
      tour({ index: 0, testsEchoues: ['suite/a.test.ts'] }),
      tour({ index: 1, testsEchoues: ['suite/a.test.ts', 'suite/b.test.ts'] }),
    ];
    expect(extraireSignaux(tours).testsEchouantIdentique).toEqual(['suite/a.test.ts']);
  });

  test('réécriture alternée : empreintes qui cyclent entre deux valeurs sans progrès', () => {
    const tours = [
      tour({ index: 0, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h1' }] }),
      tour({ index: 1, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h2' }] }),
      tour({ index: 2, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h1' }] }),
      tour({ index: 3, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h2' }] }),
    ];
    expect(extraireSignaux(tours).reecritureAlternee).toEqual(['a.ts']);
  });

  test('progression réelle (nouvelle empreinte à chaque tour) n’est jamais un signal', () => {
    const tours = [
      tour({ index: 0, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h1' }] }),
      tour({ index: 1, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h2' }] }),
      tour({ index: 2, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h3' }] }),
      tour({ index: 3, fichiersModifies: [{ chemin: 'a.ts', empreinte: 'h4' }] }),
    ];
    expect(extraireSignaux(tours).reecritureAlternee).toEqual([]);
  });

  test('nombreTours reflète la fenêtre reçue, jamais un transcript complet', () => {
    const tours = [tour({ index: 0 }), tour({ index: 1 }), tour({ index: 2 })];
    expect(extraireSignaux(tours).nombreTours).toBe(3);
  });
});
