import { describe, expect, test } from 'bun:test';
import { tailleFichier } from '../../shared/format.ts';
import { apercuDe, estEditable, extension } from './genre.ts';

describe('genre d’un fichier', () => {
  test('extension : la dernière, en minuscules ; un fichier caché sans point garde son nom', () => {
    expect(extension('Photo.JPG')).toBe('jpg');
    expect(extension('archive.tar.gz')).toBe('gz');
    expect(extension('.bashrc')).toBe('bashrc');
    expect(extension('Makefile')).toBe('');
  });

  test('aperçu selon le type', () => {
    expect(apercuDe('vacances.jpeg')).toBe('image');
    expect(apercuDe('film.mp4')).toBe('video');
    expect(apercuDe('note.md')).toBe('markdown');
    expect(apercuDe('deploy.sh')).toBe('texte');
    expect(apercuDe('Dockerfile')).toBe('texte');
    expect(apercuDe('base.sqlite')).toBe('binaire');
    expect(estEditable('serveur.ts')).toBe(true);
    expect(estEditable('photo.png')).toBe(false);
  });

  test('taille lisible', () => {
    expect(tailleFichier(68)).toBe('68 o');
    expect(tailleFichier(1229)).toBe('1,2 Ko');
    expect(tailleFichier(9437184)).toBe('9,0 Mo');
    expect(tailleFichier(250 * 1024 ** 3)).toBe('250 Go');
  });
});
