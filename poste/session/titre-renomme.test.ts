// Responsabilité : un renommage (Noctis ou outil de l'agent) écrit dans le transcript survit au redémarrage : il
// l'emporte sur le titre généré quand le poste relit le titre.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ecrireTitreRenomme, titreGenereDuTranscript } from './titre-transcript.ts';

const journal = pino({ level: 'silent' });

describe('renommage écrit dans le transcript', () => {
  test('relu après coup, il l’emporte sur le titre généré, même généré plus tard', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'titre-renomme-'));
    const chemin = join(dossier, 's.jsonl');
    try {
      writeFileSync(chemin, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Ancien titre', sessionId: 's' })}\n`);
      ecrireTitreRenomme(chemin, 's', 'Nouveau titre', journal);
      writeFileSync(chemin, `${readFileSync(chemin, 'utf8')}${JSON.stringify({ type: 'ai-title', aiTitle: 'Autre', sessionId: 's' })}\n`);
      expect(titreGenereDuTranscript(chemin, '/projets/app', journal)).toBe('Nouveau titre');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('sans transcript encore écrit : rien n’est créé', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'titre-renomme-'));
    try {
      ecrireTitreRenomme(join(dossier, 'absent.jsonl'), 's', 'X', journal);
      expect(titreGenereDuTranscript(join(dossier, 'absent.jsonl'), '/projets/app', journal)).toBeNull();
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
