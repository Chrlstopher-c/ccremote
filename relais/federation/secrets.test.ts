// Secrets de la fédération : écriture 600, relecture, fichier altéré ignoré sans rien exposer.
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { SecretsNoeud } from './secrets.ts';

const journal = pino({ enabled: false });
const CONFIG = { url: 'http://127.0.0.1:9', jeton: 'j'.repeat(43), id: 'a1b2c3d4e5f6', nom: 'tour' };
let dossier = '';

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'fede-secrets-'));
});

describe('secrets du nœud', () => {
  test('la configuration de l’aiguilleur se relit, en fichier 600', () => {
    const s = new SecretsNoeud(dossier, journal);
    expect(s.lireAiguilleur()).toBeNull();
    s.ecrireAiguilleur(CONFIG);
    expect(s.lireAiguilleur()).toEqual(CONFIG);
    const mode = statSync(join(dossier, 'federation', 'aiguilleur.json')).mode & 0o777;
    expect(mode).toBe(0o600);
    s.effacerAiguilleur();
    expect(s.lireAiguilleur()).toBeNull();
  });

  test('l’identité privée et les pairs se relisent ; les pairs sont en 600', () => {
    const s = new SecretsNoeud(dossier, journal);
    s.ecrireIdentitePrivee('{"version":1}');
    expect(s.lireIdentitePrivee()).toBe('{"version":1}');
    s.ecrirePairs([
      { id: 'a1b2c3d4e5f6', nom: 'portable', identite: 'a'.repeat(86), creeLe: '2026-11-22T00:00:00Z', genre: 'noeud' },
    ]);
    expect(s.lirePairs()).toHaveLength(1);
    expect(statSync(join(dossier, 'federation', 'pairs.json')).mode & 0o777).toBe(0o600);
  });

  test('un fichier qui ne respecte pas le schéma est ignoré', () => {
    mkdirSync(join(dossier, 'federation'), { recursive: true });
    writeFileSync(join(dossier, 'federation', 'aiguilleur.json'), '{"url":"pas une adresse"}');
    writeFileSync(join(dossier, 'federation', 'pairs.json'), 'pas du json');
    const s = new SecretsNoeud(dossier, journal);
    expect(s.lireAiguilleur()).toBeNull();
    expect(s.lirePairs()).toEqual([]);
  });
});
