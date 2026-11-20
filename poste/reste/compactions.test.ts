// Responsabilité : tests des résumés de compaction (B5) — lignes `user` marquées `isCompactSummary`, texte chaîne ou
// blocs, ordre du fichier, lignes illisibles et transcript absent ignorés.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { lireResumesCompaction, resumesDeTranscript } from './compactions.ts';

const journal = pino({ level: 'silent' });

describe('résumés de compaction', () => {
  test('lignes user marquées, texte chaîne ou blocs, plus ancien d’abord', () => {
    const contenu = [
      JSON.stringify({ type: 'user', timestamp: '2026-11-01T10:00:00.000Z', message: { content: 'bonjour' } }),
      JSON.stringify({
        type: 'user',
        isCompactSummary: true,
        timestamp: '2026-11-01T11:00:00.000Z',
        message: { content: 'Premier résumé' },
      }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'réponse' }] } }),
      JSON.stringify({
        type: 'user',
        isCompactSummary: true,
        timestamp: '2026-11-02T09:00:00.000Z',
        message: { content: [{ type: 'text', text: 'Second' }, { type: 'image' }, { type: 'text', text: 'résumé' }] },
      }),
    ].join('\n');
    expect(resumesDeTranscript(contenu, journal)).toEqual([
      { ts: '2026-11-01T11:00:00.000Z', texte: 'Premier résumé' },
      { ts: '2026-11-02T09:00:00.000Z', texte: 'Second\nrésumé' },
    ]);
  });

  test('une citation échappée et une ligne tronquée ne sont pas des résumés', () => {
    const contenu = [
      '{"type":"user","message":{"content":"cite \\"isCompactSummary\\":true"}}',
      '{"type":"user","isCompactSummary":true,"message":',
      '{"type":"assistant","isCompactSummary":true,"message":{"content":"pas un user"}}',
    ].join('\n');
    expect(resumesDeTranscript(contenu, journal)).toEqual([]);
  });

  test('transcript absent ou session sans conversation : liste vide', () => {
    expect(lireResumesCompaction(null, journal)).toEqual([]);
    expect(lireResumesCompaction('/chemin/qui/n-existe/pas.jsonl', journal)).toEqual([]);
  });

  test('transcript sur disque : lu et filtré', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'compactions-'));
    try {
      const chemin = join(dossier, 'session.jsonl');
      const ligne = { type: 'user', isCompactSummary: true, timestamp: 't1', message: { content: 'Résumé' } };
      writeFileSync(chemin, `${JSON.stringify(ligne)}\n`);
      expect(lireResumesCompaction(chemin, journal)).toEqual([{ ts: 't1', texte: 'Résumé' }]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
