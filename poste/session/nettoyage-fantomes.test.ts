import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistee } from './faux-sdk.ts';
import { nettoyer } from './nettoyage-fantomes.ts';

let dossier = '';
const fiche = (id: string, claude: string | null, titre: string) => {
  const base = persistee(null);
  return { ...base, resume: { ...base.resume, id, claudeSessionId: claude, titre } };
};

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'fantomes-'));
});
afterEach(() => rmSync(dossier, { recursive: true, force: true }));

describe('nettoyer', () => {
  test('sans --appliquer : liste, ne touche rien', () => {
    const avant = [fiche('tmux-a', 'X', 'a'), fiche('X', 'X', 'fantome')];
    writeFileSync(join(dossier, 'sessions.json'), JSON.stringify(avant));
    expect(nettoyer(dossier, false).map((f) => f.resume.titre)).toEqual(['fantome']);
    expect(readFileSync(join(dossier, 'sessions.json'), 'utf8')).toBe(JSON.stringify(avant));
  });

  test('--appliquer : retire seulement les fantômes, sauvegarde avant', () => {
    writeFileSync(join(dossier, 'sessions.json'), JSON.stringify([fiche('tmux-a', 'X', 'a'), fiche('X', 'X', 'fantome'), fiche('Z', 'Z', 'ok')]));
    nettoyer(dossier, true);
    const apres = JSON.parse(readFileSync(join(dossier, 'sessions.json'), 'utf8')) as { resume: { id: string } }[];
    expect(apres.map((s) => s.resume.id)).toEqual(['tmux-a', 'Z']);
    expect(existsSync(join(dossier, 'sessions.json.avant-fantomes'))).toBe(true);
  });

  test('fichier illisible : erreur, rien écrit', () => {
    writeFileSync(join(dossier, 'sessions.json'), '{"pas":"un tableau"}');
    expect(() => nettoyer(dossier, true)).toThrow();
    expect(readFileSync(join(dossier, 'sessions.json'), 'utf8')).toBe('{"pas":"un tableau"}');
  });
});
