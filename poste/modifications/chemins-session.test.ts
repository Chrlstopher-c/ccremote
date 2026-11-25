// Responsabilité : tests des chemins d'une session suivie hors de Lanterne (fichiers de ses tours clos, relus du
// transcript) — relu seulement quand le transcript a changé.
import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { cheminsDuTranscript } from './chemins-session.ts';

const journal = pino({ enabled: false });
const FIXTURE = join(import.meta.dir, '..', 'session', 'fixtures', 'tours-edition.jsonl');

describe('chemins du transcript d’une session suivie', () => {
  test('les fichiers des tours clos, dans l’ordre de leur première écriture', () => {
    expect(cheminsDuTranscript(FIXTURE, journal)).toEqual(['/repo/src/a.ts', '/repo/src/nouveau.ts']);
  });

  test('un transcript illisible : aucun chemin, sans erreur', () => {
    expect(cheminsDuTranscript(join(import.meta.dir, 'absent.jsonl'), journal)).toEqual([]);
  });

  test('lu au fil de l’eau : une suite écrite en morceaux (ligne coupée) donne les mêmes chemins qu’une lecture entière', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'chemins-'));
    try {
      const complet = readFileSync(FIXTURE);
      const fichier = join(dossier, 't.jsonl');
      writeFileSync(fichier, '');
      expect(cheminsDuTranscript(fichier, journal)).toEqual([]);
      for (let i = 0; i < complet.length; i += 97) {
        appendFileSync(fichier, complet.subarray(i, i + 97));
        cheminsDuTranscript(fichier, journal);
      }
      expect(cheminsDuTranscript(fichier, journal)).toEqual(['/repo/src/a.ts', '/repo/src/nouveau.ts']);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('un transcript remplacé par plus court est relu depuis le début', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'chemins-'));
    try {
      const fichier = join(dossier, 't.jsonl');
      writeFileSync(fichier, readFileSync(FIXTURE));
      expect(cheminsDuTranscript(fichier, journal)).toHaveLength(2);
      writeFileSync(fichier, '');
      expect(cheminsDuTranscript(fichier, journal)).toEqual([]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
