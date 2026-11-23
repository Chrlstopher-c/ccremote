import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { TAILLE_MAX_FICHIER } from '../../commun/presentation.ts';
import { cheminsImagesDuResultat, lecteurImagesChemin } from './images-chemin.ts';

const journal = pino({ enabled: false });
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const CHAMPS = ['path', 'filename', 'file_path', 'filePath', 'screenshot'] as const;

const resultat = (contenu: unknown): Record<string, unknown> => ({
  type: 'tool_result',
  tool_use_id: 't1',
  content: contenu,
});
const json = (objet: Record<string, unknown>): string => JSON.stringify(objet);

describe('cheminsImagesDuResultat : repérage pur des chemins d’image', () => {
  test('résultat JSON Playwright : le champ path', () => {
    const texte = '{"success":true,"path":"/tmp/nr/g2.png","full_page":false}';
    expect(cheminsImagesDuResultat([resultat(texte)])).toEqual(['/tmp/nr/g2.png']);
  });

  test('chacun des champs chemin est lu, extension en majuscules comprise', () => {
    const blocs = CHAMPS.map((champ) => resultat(json({ [champ]: `/srv/x-${champ}.JPG` })));
    expect(cheminsImagesDuResultat(blocs)).toEqual(CHAMPS.map((champ) => `/srv/x-${champ}.JPG`));
  });

  test('un texte qui n’est qu’un chemin (une ligne), dans un tableau de blocs text', () => {
    const contenu = [{ type: 'text', text: '  /home/u/capture.webp \n' }];
    expect(cheminsImagesDuResultat([resultat(contenu)])).toEqual(['/home/u/capture.webp']);
  });

  test('URL, chemin relatif, extension non image et chemin dans un texte multiligne refusés', () => {
    const textes = [
      'https://exemple.test/a.png',
      'file:///tmp/a.png',
      'images/a.png',
      './a.png',
      '/tmp/a.pdf',
      '/tmp/a.svg',
      '/tmp/sans-extension',
      json({ path: 'relatif/b.png' }),
      'sortie\n/tmp/a.png',
    ];
    expect(cheminsImagesDuResultat(textes.map(resultat))).toEqual([]);
  });

  test('sans doublon : même chemin dans plusieurs champs ou résultats', () => {
    const texte = json({ path: '/tmp/p/0.png', filename: '/tmp/p/0.png', file_path: '/tmp/p/1.png' });
    const attendu = ['/tmp/p/0.png', '/tmp/p/1.png'];
    expect(cheminsImagesDuResultat([resultat(texte), resultat('/tmp/p/1.png')])).toEqual(attendu);
  });

  test('au plus 8 chemins par ligne, dans l’ordre des résultats', () => {
    const blocs = Array.from({ length: 12 }, (_, i) => resultat(json({ path: `/tmp/p/${i}.png` })));
    expect(cheminsImagesDuResultat(blocs)).toEqual(Array.from({ length: 8 }, (_, i) => `/tmp/p/${i}.png`));
  });

  test('seuls les blocs tool_result comptent ; contenu inattendu ignoré', () => {
    expect(cheminsImagesDuResultat([{ type: 'text', text: '/tmp/a.png' }])).toEqual([]);
    expect(cheminsImagesDuResultat('/tmp/a.png')).toEqual([]);
    expect(cheminsImagesDuResultat(undefined)).toEqual([]);
    expect(cheminsImagesDuResultat([resultat(42)])).toEqual([]);
  });
});

describe('lecteurImagesChemin : lecture bornée sur le poste', () => {
  let racine: string;
  let voisin: string;
  let horsRacine: string;

  beforeAll(() => {
    racine = mkdtempSync(join(tmpdir(), 'images-chemin-'));
    voisin = `${racine}-voisin`;
    horsRacine = mkdtempSync(join(tmpdir(), 'images-chemin-hors-'));
    mkdirSync(voisin);
    mkdirSync(join(racine, 'sous'));
    writeFileSync(join(racine, 'a.png'), PNG_1x1);
    writeFileSync(join(racine, 'note.txt'), 'texte');
    writeFileSync(join(racine, 'sous', 'b.JPEG'), PNG_1x1);
    writeFileSync(join(voisin, 'c.png'), PNG_1x1);
    writeFileSync(join(horsRacine, 'secret.png'), PNG_1x1);
    writeFileSync(join(racine, 'grosse.png'), Buffer.alloc(TAILLE_MAX_FICHIER + 1));
    writeFileSync(join(racine, 'pile.png'), Buffer.alloc(TAILLE_MAX_FICHIER));
    symlinkSync(join(horsRacine, 'secret.png'), join(racine, 'lien-sortant.png'));
    symlinkSync(join(racine, 'a.png'), join(racine, 'lien-interne.png'));
  });

  afterAll(() => {
    for (const dossier of [racine, voisin, horsRacine]) rmSync(dossier, { recursive: true, force: true });
  });

  test('session normale (racines null) : tout chemin lisible est permis, mime selon l’extension', () => {
    const lire = lecteurImagesChemin(null, journal);
    expect(lire(join(horsRacine, 'secret.png'))).toEqual({ mime: 'image/png', base64: PNG_1x1.toString('base64'), nom: 'secret.png' });
    expect(lire(join(racine, 'sous', 'b.JPEG'))?.mime).toBe('image/jpeg');
  });

  test('racines données : un fichier sous une racine est lu, lien interne compris', () => {
    const lire = lecteurImagesChemin([racine], journal);
    expect(lire(join(racine, 'a.png'))?.base64).toBe(PNG_1x1.toString('base64'));
    expect(lire(join(racine, 'sous', 'b.JPEG'))).not.toBeNull();
    expect(lire(join(racine, 'lien-interne.png'))).not.toBeNull();
  });

  test('racines données : un fichier hors racine est refusé', () => {
    expect(lecteurImagesChemin([racine], journal)(join(horsRacine, 'secret.png'))).toBeNull();
  });

  test('racines données : un lien symbolique qui sort des racines est refusé', () => {
    expect(lecteurImagesChemin([racine], journal)(join(racine, 'lien-sortant.png'))).toBeNull();
  });

  test('racines données : un dossier voisin de même préfixe n’est pas permis', () => {
    expect(lecteurImagesChemin([racine], journal)(join(voisin, 'c.png'))).toBeNull();
  });

  test('taille : au-delà de TAILLE_MAX_FICHIER refusé, à la limite accepté', () => {
    const lire = lecteurImagesChemin(null, journal);
    expect(lire(join(racine, 'grosse.png'))).toBeNull();
    expect(lire(join(racine, 'pile.png'))).not.toBeNull();
  });

  test('absent, dossier ou extension non image : null, sans exception', () => {
    const lire = lecteurImagesChemin(null, journal);
    expect(lire(join(racine, 'absent.png'))).toBeNull();
    expect(lire(join(racine, 'sous'))).toBeNull();
    expect(lire(join(racine, 'note.txt'))).toBeNull();
  });
});
