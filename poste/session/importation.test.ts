import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ficheImportee, transcriptsImportables } from './importation.ts';

const journal = pino({ enabled: false });
const CONNU = 'c0000000-0000-4000-8000-000000000001';
const NOUVEAU = 'c0000000-0000-4000-8000-000000000002';
let racine = '';

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'importation-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

function transcript(config: string, dossier: string, id: string, contenu: string): string {
  const d = join(config, 'projects', dossier);
  mkdirSync(d, { recursive: true });
  const chemin = join(d, `${id}.jsonl`);
  writeFileSync(chemin, contenu);
  return chemin;
}

const LIGNE_CWD = '{"type":"user","cwd":"/travail/projet","message":{"role":"user","content":"bonjour"}}\n';

describe('sessions Claude Code importables', () => {
  test('liste les transcripts inconnus avec leur dossier de travail', () => {
    const config = join(racine, 'config');
    const chemin = transcript(config, '-travail-projet', NOUVEAU, LIGNE_CWD);
    const trouves = transcriptsImportables([config], () => false, journal);
    expect(trouves.map((t) => [t.id, t.cwd, t.chemin])).toEqual([[NOUVEAU, '/travail/projet', chemin]]);
  });

  test('écarte les sessions déjà connues et les transcripts vides', () => {
    const config = join(racine, 'config');
    transcript(config, '-travail-projet', CONNU, LIGNE_CWD);
    transcript(config, '-travail-projet', 'vide-0000-4000-8000-000000000003', '');
    const trouves = transcriptsImportables([config], (id) => id === CONNU, journal);
    expect(trouves).toEqual([]);
  });

  test('un transcript sans champ cwd est ignoré', () => {
    const config = join(racine, 'config');
    transcript(config, '-x', NOUVEAU, '{"type":"summary"}\n');
    expect(transcriptsImportables([config], () => false, journal)).toEqual([]);
  });

  test('une configuration absente ne lève rien', () => {
    expect(transcriptsImportables([join(racine, 'absente')], () => false, journal)).toEqual([]);
  });

  test('la fiche importée est une session fermée, reprenable, sur le moteur tmux', () => {
    const fiche = ficheImportee(
      { machine: 'tour', compte: 'principal', fenetre: 200_000 },
      {
        id: NOUVEAU,
        cwd: '/travail/projet',
        chemin: '/x',
        configDir: null,
        titre: 'Titre',
        modifieLe: '2026-11-18T10:00:00.000Z',
      },
    );
    expect(fiche).toMatchObject({
      id: NOUVEAU,
      statut: 'fermee',
      moteur: 'tmux',
      claudeSessionId: NOUVEAU,
      cwd: '/travail/projet',
    });
  });
});
