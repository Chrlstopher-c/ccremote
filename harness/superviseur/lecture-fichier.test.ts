/**
 * Tests unitaires de `lireFichier` — les BORNES, pas le cas nominal seul.
 *
 * `☠` Ce module rend du CONTENU, pas des noms : chaque borne qui tombe ici est
 * une fuite de fichier, pas un listing bavard. Les cas hors racine, lien
 * symbolique sortant, binaire et plafond sont donc testés comme des invariants,
 * pas comme des cas limites.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireFichier, PLAFOND_LECTURE_OCTETS } from './lecture-fichier.ts';

async function racineAvecFichiers(): Promise<{ racine: string; horsRacine: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'ccremote-lecture-'));
  const racine = join(parent, 'projets');
  const horsRacine = join(parent, 'secrets');
  await mkdir(racine);
  await mkdir(horsRacine);
  await mkdir(join(racine, 'vela'));
  await writeFile(join(racine, 'vela', 'main.ts'), 'export const x = 1;\n');
  await writeFile(join(horsRacine, 'credentials.json'), '{"token":"secret"}');
  return { racine, horsRacine };
}

describe('lireFichier — cas nominal', () => {
  test('rend le contenu réel depuis un chemin relatif à la racine', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, 'vela/main.ts');
    expect(r.ok).toBe(true);
    expect(r.contenu).toBe('export const x = 1;\n');
    expect(r.tronque).toBe(false);
    expect(r.note).toBeUndefined();
    expect(r.octets).toBe(20);
  });

  test('accepte aussi un chemin absolu — celui que rend explorer_projets', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, join(racine, 'vela', 'main.ts'));
    expect(r.ok).toBe(true);
    expect(r.chemin).toContain('main.ts');
  });

  test('un fichier vide est lu, pas refusé — vide et illisible ne se confondent jamais', async () => {
    const { racine } = await racineAvecFichiers();
    await writeFile(join(racine, 'vide.txt'), '');
    const r = lireFichier(racine, 'vide.txt');
    expect(r.ok).toBe(true);
    expect(r.contenu).toBe('');
  });
});

describe('lireFichier — confinement à la racine', () => {
  test('☠ un `..` sortant de la racine est refusé', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, '../secrets/credentials.json');
    expect(r.ok).toBe(false);
    expect(r.contenu).toBe('');
    expect(r.note).toContain('refusé');
  });

  test('☠ un chemin absolu hors racine est refusé', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, '/etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.note).toContain('refusé');
  });

  test('☠ un LIEN SYMBOLIQUE sortant de la racine est refusé — le contrôle lexical seul le laisse passer', async () => {
    const { racine, horsRacine } = await racineAvecFichiers();
    await symlink(join(horsRacine, 'credentials.json'), join(racine, 'innocent.json'));
    const r = lireFichier(racine, 'innocent.json');
    expect(r.ok).toBe(false);
    expect(r.contenu).toBe('');
    expect(r.note).toContain('après résolution des liens');
    // Le refus ne révèle pas non plus OÙ mène le lien.
    expect(r.note).not.toContain('credentials.json');
  });

  test('un lien symbolique INTERNE reste lisible — la garde borne, elle ne casse pas les projets', async () => {
    const { racine } = await racineAvecFichiers();
    await symlink(join(racine, 'vela', 'main.ts'), join(racine, 'raccourci.ts'));
    const r = lireFichier(racine, 'raccourci.ts');
    expect(r.ok).toBe(true);
    expect(r.contenu).toBe('export const x = 1;\n');
  });
});

describe('lireFichier — refus lisibles par l’orchestrateur', () => {
  test('fichier inexistant : refus explicite, jamais un contenu vide', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, 'vela/absent.ts');
    expect(r.ok).toBe(false);
    expect(r.note).toContain('inexistant');
  });

  test('un répertoire renvoie vers explorer_projets', async () => {
    const { racine } = await racineAvecFichiers();
    const r = lireFichier(racine, 'vela');
    expect(r.ok).toBe(false);
    expect(r.note).toContain('explorer_projets');
  });

  test('chemin vide : refusé, pas replié sur la racine', async () => {
    const { racine } = await racineAvecFichiers();
    expect(lireFichier(racine, '   ').ok).toBe(false);
  });

  test('☠ un binaire est refusé au lieu d’être décodé en charabia', async () => {
    const { racine } = await racineAvecFichiers();
    await writeFile(join(racine, 'app.bin'), new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x00, 0x00, 0x01]));
    const r = lireFichier(racine, 'app.bin');
    expect(r.ok).toBe(false);
    expect(r.note).toContain('binaire');
    expect(r.octets).toBe(8);
  });
});

describe('lireFichier — plafond de taille', () => {
  test('☠ au-delà du plafond : tronqué ET annoncé, jamais tronqué en silence', async () => {
    const { racine } = await racineAvecFichiers();
    const taille = PLAFOND_LECTURE_OCTETS + 5_000;
    await writeFile(join(racine, 'gros.log'), 'a'.repeat(taille));
    const r = lireFichier(racine, 'gros.log');
    expect(r.ok).toBe(true);
    expect(r.tronque).toBe(true);
    expect(r.contenu.length).toBe(PLAFOND_LECTURE_OCTETS);
    expect(r.octets).toBe(taille);
    expect(r.note).toContain('TRONQUÉ');
  });

  test('☠ une coupure au milieu d’un caractère UTF-8 ne produit aucun caractère de remplacement', async () => {
    const { racine } = await racineAvecFichiers();
    // « é » (2 octets) commence à PLAFOND-1 : la coupure tombe entre ses deux octets.
    await writeFile(join(racine, 'utf8.txt'), `${'a'.repeat(PLAFOND_LECTURE_OCTETS - 1)}éfin`);
    const r = lireFichier(racine, 'utf8.txt');
    expect(r.tronque).toBe(true);
    expect(r.contenu).not.toContain('�');
    expect(r.contenu.length).toBe(PLAFOND_LECTURE_OCTETS - 1);
  });
});
