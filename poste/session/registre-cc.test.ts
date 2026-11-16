import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { dossierRegistreCc, lireRegistreCc } from './registre-cc.ts';

const journal = pino({ level: 'silent' });
let racine = '';
let dossier = '';

const fiche = (id: string, creeLe: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, nom: `nom-${id}`, cwd: '/home/x/alpha', tmux: null, lanceur: 'quart', creeLe, ...extra });

beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), 'registre-cc-'));
  dossier = join(racine, 'cc', 'sessions');
  await mkdir(dossier, { recursive: true });
  await writeFile(join(dossier, 'aaaa1111.json'), fiche('aaaa1111', '2026-10-10T08:00:00Z'));
  await writeFile(
    join(dossier, 'bbbb2222.json'),
    fiche('bbbb2222', '2026-10-12T09:00:00Z', { tmux: 'claude-alpha', lanceur: 'kitty', nom: 'Reprise du projet' }),
  );
  await writeFile(join(dossier, 'cccc3333.json'), fiche('cccc3333', '2026-10-11T07:00:00Z', { lanceur: 'inconnu' }));
  await writeFile(join(dossier, 'dddd4444.json'), '{ pas du json');
  await writeFile(join(dossier, '.eeee5555.9.tmp'), fiche('eeee5555', '2026-10-12T10:00:00Z'));
});

afterAll(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('lireRegistreCc', () => {
  test('fiches valides, la plus récente d abord ; invalides et fichiers temporaires ignorés', () => {
    const entrees = lireRegistreCc(dossier, journal);
    expect(entrees.map((e) => e.id)).toEqual(['bbbb2222', 'aaaa1111']);
  });

  test('porte le nom, le nom tmux et le lanceur tels qu écrits par cc', () => {
    const [recente] = lireRegistreCc(dossier, journal);
    expect(recente).toEqual({
      id: 'bbbb2222',
      nom: 'Reprise du projet',
      cwd: '/home/x/alpha',
      tmux: 'claude-alpha',
      lanceur: 'kitty',
      creeLe: '2026-10-12T09:00:00Z',
    });
  });

  test('dossier absent : aucune session cc, pas d erreur', () => {
    expect(lireRegistreCc(join(racine, 'absent'), journal)).toEqual([]);
  });
});

describe('dossierRegistreCc', () => {
  test('suit XDG_STATE_HOME, sinon ~/.local/state', () => {
    expect(dossierRegistreCc({ XDG_STATE_HOME: '/tmp/etat' })).toBe('/tmp/etat/cc/sessions');
    expect(dossierRegistreCc({})).toMatch(/\.local\/state\/cc\/sessions$/);
  });
});
