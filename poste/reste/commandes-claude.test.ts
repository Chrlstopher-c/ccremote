// Responsabilité : tests des commandes personnelles Claude — listage (sous-dossiers, description), création sans
// écrasement, nom validé. Dossier de configuration temporaire.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { creerCommande, listerCommandes } from './commandes-claude.ts';

const journal = pino({ enabled: false });
let config = '';

beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'commandes-claude-'));
});
afterEach(() => {
  rmSync(config, { recursive: true, force: true });
});

function fichier(rel: string, contenu: string): void {
  const chemin = join(config, 'commands', rel);
  mkdirSync(join(chemin, '..'), { recursive: true });
  writeFileSync(chemin, contenu);
}

describe('liste des commandes', () => {
  test('nom = chemin sans .md, / devient :, triée, description du frontmatter ou première ligne', () => {
    fichier('revue.md', '---\ndescription: "Relit le diff"\n---\n\nCorps');
    fichier('git/sync.md', '\n\nSynchronise le dépôt\nplus de détails');
    fichier('notes.txt', 'ignoré');
    const liste = listerCommandes(config, journal);
    expect(liste).toEqual([
      { nom: 'git:sync', description: 'Synchronise le dépôt', chemin: join('commands', 'git', 'sync.md') },
      { nom: 'revue', description: 'Relit le diff', chemin: join('commands', 'revue.md') },
    ]);
  });

  test('dossier absent : liste vide', () => {
    expect(listerCommandes(join(config, 'rien'), journal)).toEqual([]);
  });
});

describe('création d une commande', () => {
  test('écrit le fichier avec son frontmatter, puis la commande est listée', () => {
    expect(
      creerCommande(config, { nom: 'bilan', description: 'Fait le bilan', contenu: 'Résume la semaine' }, journal),
    ).toEqual({ ok: true, nom: 'bilan' });
    const texte = readFileSync(join(config, 'commands', 'bilan.md'), 'utf8');
    expect(texte).toContain('description: "Fait le bilan"');
    expect(texte).toContain('Résume la semaine');
    expect(listerCommandes(config, journal).map((c) => c.nom)).toEqual(['bilan']);
  });

  test('un fichier existant n est jamais écrasé', () => {
    fichier('bilan.md', 'original');
    expect(creerCommande(config, { nom: 'bilan', description: '', contenu: 'nouveau' }, journal)).toEqual({
      ok: false,
      erreur: 'commande_existante',
    });
    expect(readFileSync(join(config, 'commands', 'bilan.md'), 'utf8')).toBe('original');
  });

  test('un nom hors de la forme attendue est refusé sans rien écrire', () => {
    for (const nom of ['../evil', 'Majuscule', 'a:b', '-debut', 'trop-long-'.repeat(5)]) {
      expect(creerCommande(config, { nom, description: '', contenu: 'x' }, journal)).toEqual({
        ok: false,
        erreur: 'nom de commande invalide',
      });
    }
    expect(existsSync(join(config, 'commands'))).toBe(false);
  });
});
