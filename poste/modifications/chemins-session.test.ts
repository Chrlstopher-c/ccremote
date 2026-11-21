// Responsabilité : tests des chemins d'une session suivie hors de Lanterne (fichiers de ses tours clos, relus du
// transcript) — relu seulement quand le transcript a changé.
import { describe, expect, test } from 'bun:test';
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
});
