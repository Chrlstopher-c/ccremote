// Responsabilité : tests de la lecture des déclarations de processus Claude — une déclaration tronquée ne bloque pas
// la découverte des autres sessions.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { processusClaude } from './processus.ts';

const journal = pino({ enabled: false });

function configAvec(fichiers: Record<string, string>): { dossier: string; nettoyer: () => void } {
  const dossier = mkdtempSync(join(tmpdir(), 'decl-claude-'));
  mkdirSync(join(dossier, 'sessions'));
  for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, 'sessions', nom), contenu);
  return { dossier, nettoyer: () => rmSync(dossier, { recursive: true, force: true }) };
}

describe('processusClaude : déclarations illisibles', () => {
  test('une déclaration tronquée est ignorée sans faire échouer la lecture', () => {
    const { dossier, nettoyer } = configAvec({ '999999.json': '{"pid": 999999, "sess' });
    try {
      expect(processusClaude([dossier], journal)).toEqual([]);
    } finally {
      nettoyer();
    }
  });
});
