import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { modeleDuTranscript } from './modele-transcript.ts';

const journal = pino({ enabled: false });

function transcript(lignes: string[]): { chemin: string; nettoyer: () => void } {
  const dossier = mkdtempSync(join(tmpdir(), 'modele-transcript-'));
  const chemin = join(dossier, 'session.jsonl');
  writeFileSync(chemin, lignes.join('\n') + '\n');
  return { chemin, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

const assistant = (modele: string): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: modele, content: [] } });

describe('modèle d’une conversation lu dans son transcript', () => {
  test('le modèle du dernier message assistant', () => {
    const t = transcript([
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'bonjour' } }),
      assistant('claude-opus-5-5'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'encore' } }),
      assistant('claude-fable-5-2'),
    ]);
    try {
      expect(modeleDuTranscript(t.chemin, journal)).toBe('claude-fable-5-2');
    } finally {
      t.nettoyer();
    }
  });

  test('les messages synthétiques (<synthetic>) sont ignorés', () => {
    const t = transcript([assistant('claude-sonnet-5'), assistant('<synthetic>')]);
    try {
      expect(modeleDuTranscript(t.chemin, journal)).toBe('claude-sonnet-5');
    } finally {
      t.nettoyer();
    }
  });

  test('pas de message assistant, ou fichier absent : null', () => {
    const t = transcript([JSON.stringify({ type: 'user', message: { role: 'user', content: 'seul' } })]);
    try {
      expect(modeleDuTranscript(t.chemin, journal)).toBeNull();
    } finally {
      t.nettoyer();
    }
    expect(modeleDuTranscript('/inexistant/session.jsonl', journal)).toBeNull();
  });
});
