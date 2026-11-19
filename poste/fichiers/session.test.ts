import { afterAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { executerFichiersSession } from './session.ts';

const journal = pino({ level: 'silent' });
const racine = mkdtempSync(join(tmpdir(), 'quart-session-'));
const hors = mkdtempSync(join(tmpdir(), 'quart-hors-'));
afterAll(() => {
  rmSync(racine, { recursive: true, force: true });
  rmSync(hors, { recursive: true, force: true });
});

writeFileSync(join(racine, 'notes.md'), 'bonjour\n');
writeFileSync(join(racine, '.cache'), 'x');
writeFileSync(join(racine, 'image.bin'), Buffer.from([0, 1, 2]));
mkdirSync(join(racine, 'src'));
mkdirSync(join(racine, '.git'));
writeFileSync(join(hors, 'secret.txt'), 'secret');
symlinkSync(hors, join(racine, 'lien-dehors'));
symlinkSync(join(racine, 'notes.md'), join(racine, 'lien-dedans'));

describe('panneau Fichiers de session (poste)', () => {
  test('arbre : dossiers d’abord, cachés visibles, .git masqué, pas de lien sortant', async () => {
    const r = await executerFichiersSession(
      { kind: 'session_arbre', id: 'r', sessionId: 's', chemin: '' },
      racine,
      journal,
    );
    expect(r.ok).toBe(true);
    const noms = (r.donnees as { entrees: { nom: string; type: string; cache: boolean }[] }).entrees;
    expect(noms.slice(0, 2).map((e) => e.nom)).toEqual(['lien-dehors', 'src']);
    expect(noms.map((e) => e.nom)).not.toContain('.git');
    expect(noms.find((e) => e.nom === '.cache')?.cache).toBe(true);
    expect(noms.find((e) => e.nom === 'lien-dehors')?.type).toBe('dossier');
    const sousDossier = await executerFichiersSession(
      { kind: 'session_arbre', id: 'r', sessionId: 's', chemin: 'src' },
      racine,
      journal,
    );
    expect((sousDossier.donnees as { parent: string | null }).parent).toBe('');
  });

  test('lire : texte, binaire signalé, sortie du dossier refusée', async () => {
    const texte = await executerFichiersSession(
      { kind: 'session_lire', id: 'r', sessionId: 's', chemin: 'notes.md' },
      racine,
      journal,
    );
    expect((texte.donnees as { texte: string }).texte).toBe('bonjour\n');
    const binaire = await executerFichiersSession(
      { kind: 'session_lire', id: 'r', sessionId: 's', chemin: 'image.bin' },
      racine,
      journal,
    );
    expect((binaire.donnees as { binaire: boolean; texte: string | null }).binaire).toBe(true);
    const parent = await executerFichiersSession(
      { kind: 'session_lire', id: 'r', sessionId: 's', chemin: '../x' },
      racine,
      journal,
    );
    expect(parent.ok).toBe(false);
    const absolu = await executerFichiersSession(
      { kind: 'session_lire', id: 'r', sessionId: 's', chemin: '/etc/passwd' },
      racine,
      journal,
    );
    expect(absolu.ok).toBe(false);
    const lien = await executerFichiersSession(
      { kind: 'session_lire', id: 'r', sessionId: 's', chemin: 'lien-dehors/secret.txt' },
      racine,
      journal,
    );
    expect(lien.ok).toBe(false);
  });

  test('écrire : atomique, mode conservé, lien interne suivi, refus hors dossier et de dossier', async () => {
    chmodSync(join(racine, 'notes.md'), 0o640);
    const r = await executerFichiersSession(
      { kind: 'session_ecrire', id: 'r', sessionId: 's', chemin: 'notes.md', texte: 'nouveau\n' },
      racine,
      journal,
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(racine, 'notes.md'), 'utf8')).toBe('nouveau\n');
    expect(statSync(join(racine, 'notes.md')).mode & 0o777).toBe(0o640);
    const viaLien = await executerFichiersSession(
      { kind: 'session_ecrire', id: 'r', sessionId: 's', chemin: 'lien-dedans', texte: 'par le lien' },
      racine,
      journal,
    );
    expect(viaLien.ok).toBe(true);
    expect(readFileSync(join(racine, 'notes.md'), 'utf8')).toBe('par le lien');
    const dehors = await executerFichiersSession(
      { kind: 'session_ecrire', id: 'r', sessionId: 's', chemin: 'lien-dehors/nouveau.txt', texte: 'x' },
      racine,
      journal,
    );
    expect(dehors.ok).toBe(false);
    expect(readdirSync(hors)).toEqual(['secret.txt']);
    const dossier = await executerFichiersSession(
      { kind: 'session_ecrire', id: 'r', sessionId: 's', chemin: 'src', texte: 'x' },
      racine,
      journal,
    );
    expect(dossier.ok).toBe(false);
    expect(readdirSync(racine).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
