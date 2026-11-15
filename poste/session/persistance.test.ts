import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResumeSession } from '../../commun/session.ts';
import { PersistanceSessions, type SessionPersistee } from './persistance.ts';

const resume: ResumeSession = {
  id: 'quart-1',
  machine: 'tour',
  projet: { machine: 'tour', chemin: '/projets/app', nom: 'app' },
  cwd: '/projets/app',
  titre: 'Test',
  objectif: null,
  modele: 'défaut',
  compte: 'principal',
  autonomie: false,
  statut: 'travail',
  contexte: { tokens: 0, max: 1_000_000 },
  etapes: 0,
  compactions: 0,
  claudeSessionId: 'claude-abc',
  moteur: 'sdk',
  tmux: null,
  attachee: false,
  pilotee: true,
  creeLe: '2026-11-15T00:00:00.000Z',
  majLe: '2026-11-15T00:00:00.000Z',
};

const session: SessionPersistee = {
  resume,
  consignes: 'Consignes ccremote',
  configDir: null,
  transcript: null,
  position: 0,
  aReprendre: true,
};

describe('PersistanceSessions', () => {
  test('le drapeau de reprise survit à l’écriture et à la relecture', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'persistance-'));
    const persistance = new PersistanceSessions(dossier);
    persistance.ecrire([session]);
    expect(persistance.charger()[0]?.aReprendre).toBe(true);
  });

  test('un fichier d’avant la reprise au démarrage relit ses sessions comme non reprenables', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'persistance-'));
    const persistance = new PersistanceSessions(dossier);
    persistance.ecrire([session]);
    const fichier = join(dossier, 'sessions.json');
    const brut = JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, unknown>[];
    for (const entree of brut) delete entree['aReprendre'];
    writeFileSync(fichier, JSON.stringify(brut));
    expect(persistance.charger()[0]?.aReprendre).toBe(false);
  });
});
