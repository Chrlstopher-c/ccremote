// Responsabilité : tests de la bibliothèque d'une session (index des ressources et frise), sur des fils construits
// à la main.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { EvenementDate, Evenement } from './contrat';
import { cibleRm, fileEvenements, indexerBibliotheque } from './bibliotheque';

let seq = 0;

function outil(ts: string, nom: string, entree: Record<string, string>, resume = ''): EvenementDate {
  seq += 1;
  const evt: Evenement = {
    type: 'outil',
    id: `o${seq}`,
    nom,
    resume: resume || Object.values(entree)[0] || '',
    detail: JSON.stringify(entree, null, 1),
  };
  return { seq, sessionId: 's1', ts, evt };
}

function texte(ts: string): EvenementDate {
  seq += 1;
  return { seq, sessionId: 's1', ts, evt: { type: 'texte', texte: 'je regarde' } };
}

describe('indexerBibliotheque : fichiers', () => {
  test('un fichier écrit puis modifié est en avant, touché deux fois, avec ses horodatages', () => {
    const fil = [
      outil('2026-11-15T10:00:00Z', 'Write', { file_path: 'src/a.ts' }),
      outil('2026-11-15T10:05:00Z', 'Edit', { file_path: 'src/a.ts' }),
    ];
    const { enAvant, lues } = indexerBibliotheque(fil);
    expect(lues).toEqual([]);
    expect(enAvant).toEqual([
      {
        genre: 'fichier',
        cible: 'src/a.ts',
        touches: 2,
        premierTs: '2026-11-15T10:00:00Z',
        dernierTs: '2026-11-15T10:05:00Z',
        ecrite: true,
      },
    ]);
  });

  test('un fichier seulement lu est en rayon secondaire, pas en avant', () => {
    const { enAvant, lues } = indexerBibliotheque([outil('2026-11-15T10:00:00Z', 'Read', { file_path: 'docs/x.md' })]);
    expect(enAvant).toEqual([]);
    expect(lues.map((r) => [r.cible, r.ecrite])).toEqual([['docs/x.md', false]]);
  });

  test('lu puis modifié : la ressource passe en avant', () => {
    const fil = [
      outil('2026-11-15T10:00:00Z', 'Read', { file_path: 'b.ts' }),
      outil('2026-11-15T10:01:00Z', 'MultiEdit', { file_path: 'b.ts' }),
    ];
    const { enAvant, lues } = indexerBibliotheque(fil);
    expect(enAvant.map((r) => r.cible)).toEqual(['b.ts']);
    expect(lues).toEqual([]);
  });

  test('un notebook modifié utilise son propre champ', () => {
    const { enAvant } = indexerBibliotheque([outil('t', 'NotebookEdit', { notebook_path: 'n.ipynb' })]);
    expect(enAvant.map((r) => r.cible)).toEqual(['n.ipynb']);
  });

  test('les ressources les plus récentes viennent en tête', () => {
    const fil = [
      outil('2026-11-15T10:00:00Z', 'Write', { file_path: 'vieux.ts' }),
      outil('2026-11-15T11:00:00Z', 'Write', { file_path: 'recent.ts' }),
    ];
    expect(indexerBibliotheque(fil).enAvant.map((r) => r.cible)).toEqual(['recent.ts', 'vieux.ts']);
  });
});

describe('indexerBibliotheque : web, recherches, commandes', () => {
  test('les URL, recherches et commandes ont chacune leur liste', () => {
    const fil = [
      outil('t1', 'WebFetch', { url: 'https://exemple.test/doc' }),
      outil('t2', 'WebSearch', { query: 'mcp sse' }),
      outil('t3', 'Grep', { pattern: 'SourceMonde' }),
      outil('t4', 'Glob', { pattern: 'src/**/*.ts' }),
      outil('t5', 'Bash', { command: 'bun test src/donnees' }),
    ];
    const b = indexerBibliotheque(fil);
    expect(b.web.map((r) => r.cible)).toEqual(['https://exemple.test/doc']);
    expect(b.recherches.map((r) => r.cible).sort()).toEqual(['SourceMonde', 'mcp sse', 'src/**/*.ts']);
    expect(b.commandes.map((r) => r.cible)).toEqual(['bun test src/donnees']);
    expect(b.enAvant).toEqual([]);
  });

  test('une même URL consultée deux fois compte deux touches', () => {
    const fil = [
      outil('t1', 'WebFetch', { url: 'https://x.test' }),
      outil('t2', 'WebFetch', { url: 'https://x.test' }),
    ];
    expect(indexerBibliotheque(fil).web[0]?.touches).toBe(2);
  });

  test('un outil hors liste (ex. Task) est ignoré, comme les événements qui ne sont pas des outils', () => {
    const fil: EvenementDate[] = [
      outil('t1', 'Task', { description: 'sous-tâche' }),
      texte('t2'),
    ];
    const b = indexerBibliotheque(fil);
    expect([b.enAvant, b.lues, b.web, b.recherches, b.commandes].every((l) => l.length === 0)).toBe(true);
  });

  test('un détail tronqué (JSON illisible) retombe sur le résumé', () => {
    seq += 1;
    const tronque: EvenementDate = {
      seq,
      sessionId: 's1',
      ts: 't',
      evt: { type: 'outil', id: 'x', nom: 'Read', resume: 'src/long.ts', detail: '{"file_path": "src/lo…' },
    };
    expect(indexerBibliotheque([tronque]).lues.map((r) => r.cible)).toEqual(['src/long.ts']);
  });
});

describe('fileEvenements : la frise', () => {
  test('une touche par action, typée, dans l ordre du fil', () => {
    const fil = [
      outil('10:00', 'Read', { file_path: 'a.ts' }),
      outil('10:01', 'Write', { file_path: 'b.ts' }),
      outil('10:02', 'Edit', { file_path: 'b.ts' }),
      outil('10:03', 'NotebookEdit', { notebook_path: 'n.ipynb' }),
      outil('10:04', 'Grep', { pattern: 'toto' }),
      outil('10:05', 'WebFetch', { url: 'https://x.test' }),
      outil('10:06', 'Bash', { command: 'git status' }),
    ];
    expect(fileEvenements(fil)).toEqual([
      { type: 'lecture', ts: '10:00', cible: 'a.ts' },
      { type: 'ecriture', ts: '10:01', cible: 'b.ts' },
      { type: 'modification', ts: '10:02', cible: 'b.ts' },
      { type: 'modification', ts: '10:03', cible: 'n.ipynb' },
      { type: 'recherche', ts: '10:04', cible: 'toto' },
      { type: 'web', ts: '10:05', cible: 'https://x.test' },
      { type: 'commande', ts: '10:06', cible: 'git status' },
    ]);
  });

  test('un rm dans Bash ajoute une touche de suppression par cible', () => {
    const fil = [outil('10:00', 'Bash', { command: 'rm -rf dist && rm old.ts' })];
    expect(fileEvenements(fil).map((t) => [t.type, t.cible])).toEqual([
      ['commande', 'rm -rf dist && rm old.ts'],
      ['suppression', 'dist'],
      ['suppression', 'old.ts'],
    ]);
  });

  test('la suppression compte comme écriture : le fichier passe en avant', () => {
    const { enAvant } = indexerBibliotheque([outil('10:00', 'Bash', { command: 'rm vieux.ts' })]);
    expect(enAvant.map((r) => r.cible)).toEqual(['vieux.ts']);
  });
});

describe('cibleRm', () => {
  test('ignore les options et ne lit que les segments commençant par rm', () => {
    expect(cibleRm('rm -f a.ts b.ts; echo rm c.ts')).toEqual(['a.ts', 'b.ts']);
  });

  test('une commande sans rm ne rend aucune cible', () => {
    expect(cibleRm('ls -la')).toEqual([]);
  });
});
