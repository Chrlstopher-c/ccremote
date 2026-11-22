// Responsabilité : tests des routes des catégories de la barre latérale — GET vide, PUT puis GET, refus d un corps
// invalide ou d un identifiant de catégorie en double, session gardée dans la première catégorie.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { lireCategories, remplacerCategories } from './api-categories.ts';

const journal = pino({ level: 'silent' });

function nouveauRegistre(): Registre {
  return new Registre(ouvrirBase(':memory:'), journal);
}

function corps(valeur: unknown): Request {
  return new Request('http://relais.test/api/categories', { method: 'PUT', body: JSON.stringify(valeur) });
}

function brut(texte: string): Request {
  return new Request('http://relais.test/api/categories', { method: 'PUT', body: texte });
}

function cat(id: string, sessions: string[]): { id: string; nom: string; replie: boolean; sessions: string[] } {
  return { id, nom: id.toUpperCase(), replie: false, sessions };
}

describe('routes des catégories', () => {
  test('GET avant toute écriture : liste vide', async () => {
    const rep = lireCategories(nouveauRegistre());
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ categories: [] });
  });

  test('PUT rend la liste normalisée, et GET la relit', async () => {
    const r = nouveauRegistre();
    const rep = await remplacerCategories(r, corps({ categories: [cat('a', ['s1', 's2']), cat('b', ['s3'])] }));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ categories: [cat('a', ['s1', 's2']), cat('b', ['s3'])] });
    expect(await lireCategories(r).json()).toEqual({ categories: [cat('a', ['s1', 's2']), cat('b', ['s3'])] });
  });

  test('une session en double garde la première catégorie, l ordre des sessions est conservé', async () => {
    const r = nouveauRegistre();
    const rep = await remplacerCategories(
      r,
      corps({ categories: [cat('a', ['z', 'm']), cat('b', ['a', 'm', 'z', 'k'])] }),
    );
    expect(await rep.json()).toEqual({ categories: [cat('a', ['z', 'm']), cat('b', ['a', 'k'])] });
  });

  test('une écriture relance le rapprochement des doublons, un refus non', async () => {
    let appels = 0;
    const rapprocher = (): void => {
      appels += 1;
    };
    await remplacerCategories(nouveauRegistre(), corps({ categories: [] }), rapprocher);
    expect(appels).toBe(1);
    await remplacerCategories(nouveauRegistre(), corps({ categories: 'pas une liste' }), rapprocher);
    expect(appels).toBe(1);
  });

  test('corps invalide (sessions pas une liste) : 400 avec erreur', async () => {
    const rep = await remplacerCategories(nouveauRegistre(), corps({ categories: 'pas une liste' }));
    expect(rep.status).toBe(400);
    expect(await rep.json()).toHaveProperty('erreur');
  });

  test('corps non JSON : 400', async () => {
    const rep = await remplacerCategories(nouveauRegistre(), brut('{'));
    expect(rep.status).toBe(400);
    expect(await rep.json()).toHaveProperty('erreur');
  });

  test('identifiant de catégorie hors du format : 400', async () => {
    const rep = await remplacerCategories(nouveauRegistre(), corps({ categories: [cat('mauvais id', [])] }));
    expect(rep.status).toBe(400);
  });

  test('nom vide après rognage : 400', async () => {
    const rep = await remplacerCategories(
      nouveauRegistre(),
      corps({ categories: [{ id: 'a', nom: '   ', replie: false, sessions: [] }] }),
    );
    expect(rep.status).toBe(400);
  });

  test('doublon d identifiant de catégorie : 400, rien n est écrit', async () => {
    const r = nouveauRegistre();
    const rep = await remplacerCategories(r, corps({ categories: [cat('a', ['s1']), cat('a', ['s2'])] }));
    expect(rep.status).toBe(400);
    expect(r.categories()).toEqual([]);
  });

  test('plus de 200 catégories : 400', async () => {
    const trop = Array.from({ length: 201 }, (_, i) => cat(`c${i}`, []));
    const rep = await remplacerCategories(nouveauRegistre(), corps({ categories: trop }));
    expect(rep.status).toBe(400);
  });
});
