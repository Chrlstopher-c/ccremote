import { describe, expect, test } from 'bun:test';
import { ecrireFrontmatter, lireFrontmatter } from './frontmatter.ts';

describe('frontmatter', () => {
  test('lit les clés simples, avec ou sans guillemets', () => {
    const texte = '---\nname: "Mon style"\ndescription: court\n---\n\nCorps';
    expect(lireFrontmatter(texte)).toEqual({ name: 'Mon style', description: 'court' });
  });

  test('rejoint une valeur écrite sur plusieurs lignes (style `>`)', () => {
    const texte = '---\nname: x\ndescription: >\n  Première partie\n  seconde partie\n---\n';
    expect(lireFrontmatter(texte)['description']).toBe('Première partie seconde partie');
  });

  test('sans frontmatter ou sans fin, rend un objet vide', () => {
    expect(lireFrontmatter('# Titre')).toEqual({});
    expect(lireFrontmatter('---\nname: x\n')).toEqual({});
  });

  test('ce qu’on écrit se relit à l’identique', () => {
    const texte = ecrireFrontmatter({ name: 'Ton "sobre"', description: 'a: b' }, 'Corps\n');
    expect(lireFrontmatter(texte)).toEqual({ name: 'Ton "sobre"', description: 'a: b' });
  });
});
