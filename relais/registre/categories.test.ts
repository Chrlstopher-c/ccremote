// Responsabilité : tests des catégories de la barre latérale persistées par le relais — normalisation (une session
// = une catégorie), persistance après réouverture de la base, lecture vide ou document illisible.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { type Categorie, normaliserCategories } from '../../commun/categories.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const journal = pino({ level: 'silent' });
let dossier = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'quart-categories-'));
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function cat(id: string, sessions: string[], nom = id.toUpperCase(), replie = false): Categorie {
  return { id, nom, replie, sessions };
}

describe('normalisation : une session n appartient qu a une catégorie', () => {
  test('une session dans deux catégories reste dans la première (catégories puis sessions, dans l ordre)', () => {
    const n = normaliserCategories([cat('a', ['s1', 's2']), cat('b', ['s2', 's3', 's3'])]);
    expect(n.map((c) => c.sessions)).toEqual([['s1', 's2'], ['s3']]);
  });

  test('un doublon dans la même catégorie est retiré, la première occurrence gagne', () => {
    const n = normaliserCategories([cat('a', ['s1', 's2', 's1'])]);
    expect(n[0]?.sessions).toEqual(['s1', 's2']);
  });

  test('l ordre des sessions est celui voulu par l utilisateur', () => {
    const n = normaliserCategories([cat('a', ['c', 'a', 'b'])]);
    expect(n[0]?.sessions).toEqual(['c', 'a', 'b']);
  });

  test('nom, replie et id ne changent pas ; une catégorie vide reste (sans session)', () => {
    const n = normaliserCategories([cat('a', ['s1'], 'Travail', true), cat('b', ['s1'])]);
    expect(n[0]).toEqual({ id: 'a', nom: 'Travail', replie: true, sessions: ['s1'] });
    expect(n[1]).toEqual({ id: 'b', nom: 'B', replie: false, sessions: [] });
  });
});

describe('persistance des catégories', () => {
  test('lecture vide tant que rien n a été écrit', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    expect(r.categories()).toEqual([]);
  });

  test('enregistrer rend la liste normalisée et la relire donne la même chose', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    const rendue = r.enregistrerCategories([cat('a', ['s2', 's1', 's2']), cat('b', ['s1', 's3'])]);
    expect(rendue.map((c) => c.sessions)).toEqual([['s2', 's1'], ['s3']]);
    expect(r.categories()).toEqual(rendue);
  });

  test('remplacer écrase tout le document précédent', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    r.enregistrerCategories([cat('a', ['s1'])]);
    r.enregistrerCategories([cat('b', ['s2'])]);
    expect(r.categories()).toEqual([cat('b', ['s2'])]);
  });

  test('survit à la réouverture d une base fichier', () => {
    const chemin = join(dossier, 'persistance.db');
    const premiere = ouvrirBase(chemin);
    new Registre(premiere, journal).enregistrerCategories([cat('a', ['s9', 's1'], 'Projet', true)]);
    premiere.close();
    const seconde = ouvrirBase(chemin);
    expect(new Registre(seconde, journal).categories()).toEqual([cat('a', ['s9', 's1'], 'Projet', true)]);
    seconde.close();
  });

  test('un document illisible se lit comme une liste vide', () => {
    const db = ouvrirBase(':memory:');
    db.query('INSERT INTO categories (id, document, maj_le) VALUES (1, $d, $m)').run({
      d: '{pas du json',
      m: '2026-11-20T10:00:00.000Z',
    });
    expect(new Registre(db, journal).categories()).toEqual([]);
  });

  test('un document lisible mais de mauvaise forme se lit comme une liste vide', () => {
    const db = ouvrirBase(':memory:');
    db.query('INSERT INTO categories (id, document, maj_le) VALUES (1, $d, $m)').run({
      d: JSON.stringify([{ id: 'mauvais espace', nom: 'x', replie: 'oui', sessions: [] }]),
      m: '2026-11-20T10:00:00.000Z',
    });
    expect(new Registre(db, journal).categories()).toEqual([]);
  });
});
