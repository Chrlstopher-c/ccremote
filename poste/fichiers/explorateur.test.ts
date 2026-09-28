import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { cheminAbsolu, executerFichiers } from './explorateur.ts';

const journal = pino({ level: 'silent' });
const dossier = mkdtempSync(join(tmpdir(), 'quart-fichiers-'));
afterAll(() => rmSync(dossier, { recursive: true, force: true }));

describe('explorateur de fichiers', () => {
  test('les chemins partent du dossier personnel', () => {
    expect(cheminAbsolu(undefined)).toBe(homedir());
    expect(cheminAbsolu('~/a/b')).toBe(join(homedir(), 'a/b'));
    expect(cheminAbsolu('/etc/../tmp')).toBe('/tmp');
  });

  test('lister : dossiers, fichiers, cachés, parent', async () => {
    writeFileSync(join(dossier, 'script.sh'), 'echo ok\n');
    writeFileSync(join(dossier, '.cache'), '');
    await executerFichiers({ kind: 'dossier_creer', chemin: join(dossier, 'photos') }, journal);
    const r = await executerFichiers({ kind: 'fichiers_lister', chemin: dossier }, journal);
    expect(r.ok).toBe(true);
    const liste = r.donnees as { parent: string; entrees: { nom: string; type: string; cache: boolean }[] };
    expect(liste.parent).toBe(tmpdir());
    const parNom = Object.fromEntries(liste.entrees.map((e) => [e.nom, e]));
    expect(parNom['photos']?.type).toBe('dossier');
    expect(parNom['script.sh']?.type).toBe('fichier');
    expect(parNom['.cache']?.cache).toBe(true);
  });

  test('écrire en deux morceaux puis relire une plage', async () => {
    const f = join(dossier, 'gros.bin');
    await executerFichiers({ kind: 'fichier_ecrire', chemin: f, base64: btoa('abcdef'), ajout: false }, journal);
    await executerFichiers({ kind: 'fichier_ecrire', chemin: f, base64: btoa('ghij'), ajout: true }, journal);
    expect(readFileSync(f, 'utf8')).toBe('abcdefghij');
    const r = await executerFichiers({ kind: 'fichier_lire', chemin: f, debut: 3, longueur: 4 }, journal);
    expect(r.donnees).toEqual({ taille: 10, base64: btoa('defg') });
    const fin = await executerFichiers({ kind: 'fichier_lire', chemin: f, debut: 10, longueur: 4 }, journal);
    expect(fin.donnees).toEqual({ taille: 10, base64: '' });
  });

  test('renommer n’écrase jamais un fichier existant', async () => {
    writeFileSync(join(dossier, 'a.txt'), 'A');
    writeFileSync(join(dossier, 'b.txt'), 'B');
    const r = await executerFichiers(
      { kind: 'fichier_renommer', de: join(dossier, 'a.txt'), vers: join(dossier, 'b.txt') },
      journal,
    );
    expect(r).toEqual({ ok: false, erreur: 'existe déjà' });
    expect(readFileSync(join(dossier, 'b.txt'), 'utf8')).toBe('B');
  });

  test('une erreur devient un refus lisible', async () => {
    const r = await executerFichiers({ kind: 'fichiers_lister', chemin: join(dossier, 'absent') }, journal);
    expect(r).toEqual({ ok: false, erreur: 'introuvable' });
  });

  test('supprimer un dossier et son contenu', async () => {
    const d = join(dossier, 'photos');
    writeFileSync(join(d, 'x.jpg'), 'x');
    expect((await executerFichiers({ kind: 'fichier_supprimer', chemin: d }, journal)).ok).toBe(true);
    const r = await executerFichiers({ kind: 'fichiers_lister', chemin: d }, journal);
    expect(r.ok).toBe(false);
  });
});
