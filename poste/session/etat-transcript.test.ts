// Responsabilité : tests de la lecture de l'état d'un transcript absent — un processus sans transcript ne doit pas
// remplir le journal à chaque passage du balayage.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { etatDuTranscript } from './etat-transcript.ts';

function journalCapture(): { journal: pino.Logger; avertissements: () => number } {
  const lignes: string[] = [];
  const journal = pino({ level: 'debug' }, { write: (ligne: string) => void lignes.push(ligne) });
  return { journal, avertissements: () => lignes.filter((l) => l.includes('"level":40')).length };
}

describe('etatDuTranscript : transcript absent', () => {
  test('null, sans avertissement, à chaque passage du balayage', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'etat-transcript-'));
    const { journal, avertissements } = journalCapture();
    try {
      const chemin = join(dossier, 'absent.jsonl');
      for (let passage = 0; passage < 5; passage++) expect(etatDuTranscript(chemin, journal)).toBeNull();
      expect(avertissements()).toBe(0);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
