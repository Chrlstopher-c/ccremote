import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { SessionsSupprimees, supprimerTranscript, transcriptsDeLaSession } from './suppression.ts';

const journal = pino({ enabled: false });
const ID = 'a1b2c3d4-0000-4000-8000-000000000001';
let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'suppression-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

// Une configuration Claude factice : <racine>/projects/<dossier>/<id>.jsonl, avec sous-agents et voisin.
function configAvec(id: string): { config: string; transcript: string; sousAgent: string; voisin: string } {
  const config = join(racine, 'config');
  const dossier = join(config, 'projects', '-travail-projet');
  mkdirSync(join(dossier, id, 'subagents'), { recursive: true });
  const transcript = join(dossier, `${id}.jsonl`);
  const sousAgent = join(dossier, id, 'subagents', 'agent-x.jsonl');
  const voisin = join(dossier, 'autre-session.jsonl');
  writeFileSync(transcript, '{"cwd":"/travail/projet"}\n');
  writeFileSync(sousAgent, '{}\n');
  writeFileSync(voisin, '{}\n');
  return { config, transcript, sousAgent, voisin };
}

describe('suppression d un transcript', () => {
  test('retire le jsonl et le dossier des sous-agents, sans toucher aux autres sessions', () => {
    const f = configAvec(ID);
    const retires = supprimerTranscript(f.transcript, ID, journal);
    expect(retires.length).toBe(2);
    expect(existsSync(f.transcript)).toBe(false);
    expect(existsSync(join(f.transcript, '..', ID))).toBe(false);
    expect(existsSync(f.voisin)).toBe(true);
  });

  test('un chemin qui ne nomme pas l identifiant est refusé, rien n est effacé', () => {
    const f = configAvec(ID);
    expect(() => supprimerTranscript(f.voisin, ID, journal)).toThrow();
    expect(existsSync(f.voisin)).toBe(true);
  });

  test('un fichier hors d un dossier projects est refusé', () => {
    const hors = join(racine, `${ID}.jsonl`);
    writeFileSync(hors, '{}\n');
    expect(() => supprimerTranscript(hors, ID, journal)).toThrow();
    expect(existsSync(hors)).toBe(true);
  });

  test('un identifiant malformé est refusé', () => {
    const f = configAvec(ID);
    expect(() => supprimerTranscript(f.transcript, '../x', journal)).toThrow();
    expect(existsSync(f.transcript)).toBe(true);
  });

  test('une session sans transcript ne lève rien', () => {
    expect(transcriptsDeLaSession(ID, [join(racine, 'vide')])).toEqual([]);
  });

  test('les transcripts sont cherchés dans les configurations données', () => {
    const f = configAvec(ID);
    expect(transcriptsDeLaSession(ID, [f.config])).toEqual([f.transcript]);
  });
});

describe('sessions supprimées retenues', () => {
  test('l identifiant reste retenu après redémarrage du poste', () => {
    const dossier = join(racine, 'donnees');
    new SessionsSupprimees(dossier).ajouter(ID);
    expect(new SessionsSupprimees(dossier).has(ID)).toBe(true);
    expect(new SessionsSupprimees(dossier).has('autre')).toBe(false);
  });

  test('un fichier corrompu ne bloque pas le démarrage', () => {
    const dossier = join(racine, 'donnees');
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, 'supprimees.json'), '{pas du json');
    expect(new SessionsSupprimees(dossier).has(ID)).toBe(false);
  });
});
