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
      { ts: '2026-11-01T11:00:00.000Z', texte: 'Premier résumé', avant: null, apres: null },
      { ts: '2026-11-02T09:00:00.000Z', texte: 'Second\nrésumé', avant: null, apres: null },
    ]);
  });

  // Les jetons du marqueur `compact_boundary` qui précède le résumé identifient la compaction : ils sont les mêmes
  // que ceux de l'événement `compaction` du relais (fil). Un résumé sans marqueur juste avant n'en a pas.
  test('jetons avant et après pris sur le marqueur de compaction qui précède le résumé', () => {
    const marqueur = {
      type: 'system',
      subtype: 'compact_boundary',
      timestamp: '2026-11-01T10:59:00.000Z',
      compactMetadata: { trigger: 'manual', preTokens: 100000, postTokens: 20000 },
    };
    const resume = { type: 'user', isCompactSummary: true, timestamp: '2026-11-01T11:00:00.000Z', message: { content: 'R' } };
    const sansMarqueur = { type: 'user', isCompactSummary: true, timestamp: '2026-11-02T11:00:00.000Z', message: { content: 'S' } };
    const contenu = [JSON.stringify(marqueur), JSON.stringify(resume), JSON.stringify(sansMarqueur)].join('\n');
    expect(resumesDeTranscript(contenu, journal)).toEqual([
      { ts: '2026-11-01T11:00:00.000Z', texte: 'R', avant: 100000, apres: 20000 },
      { ts: '2026-11-02T11:00:00.000Z', texte: 'S', avant: null, apres: null },
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
      expect(lireResumesCompaction(chemin, journal)).toEqual([{ ts: 't1', texte: 'Résumé', avant: null, apres: null }]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
