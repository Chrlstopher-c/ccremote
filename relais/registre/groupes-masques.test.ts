// Responsabilité : tests des groupes masqués persistés par le relais — normalisation (une clé = un groupe),
// persistance après réouverture de la base, lecture vide ou illisible, migration d'une base existante.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { GroupeMasque } from '../../commun/groupes-masques.ts';
import { MIGRATIONS, ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const journal = pino({ level: 'silent' });
let dossier = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'quart-groupes-masques-'));
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function groupe(cle: string, libelle = cle.toUpperCase()): GroupeMasque {
  return {
    cle,
    libelle,
    genre: 'dossier',
    machine: 'tour',
    dossier: `/projets/${cle}`,
    masqueLe: '2026-11-20T10:00:00.000Z',
  };
}

describe('persistance des groupes masqués', () => {
  test('lecture vide tant que rien n a été écrit', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    expect(r.groupesMasques()).toEqual([]);
  });

  test('enregistrer rend la liste normalisée et la relire donne la même chose', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    const rendue = r.enregistrerGroupesMasques([groupe('a'), groupe('b'), groupe('a', 'Doublon')]);
    expect(rendue).toEqual([groupe('a'), groupe('b')]);
    expect(r.groupesMasques()).toEqual(rendue);
  });

  test('remplacer écrase tout le document précédent', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    r.enregistrerGroupesMasques([groupe('a')]);
    r.enregistrerGroupesMasques([groupe('b')]);
    expect(r.groupesMasques()).toEqual([groupe('b')]);
  });

  test('survit à la réouverture d une base fichier', () => {
    const chemin = join(dossier, 'persistance.db');
    const premiere = ouvrirBase(chemin);
    new Registre(premiere, journal).enregistrerGroupesMasques([groupe('x', 'Projet')]);
    premiere.close();
    const seconde = ouvrirBase(chemin);
    expect(new Registre(seconde, journal).groupesMasques()).toEqual([groupe('x', 'Projet')]);
    seconde.close();
  });

  test('un document illisible se lit comme une liste vide', () => {
    const db = ouvrirBase(':memory:');
    db.query('INSERT INTO groupes_masques (id, document, maj_le) VALUES (1, $d, $m)').run({
      d: '{pas du json',
      m: '2026-11-20T10:00:00.000Z',
    });
    expect(new Registre(db, journal).groupesMasques()).toEqual([]);
  });

  test('un document lisible mais de mauvaise forme se lit comme une liste vide', () => {
    const db = ouvrirBase(':memory:');
    db.query('INSERT INTO groupes_masques (id, document, maj_le) VALUES (1, $d, $m)').run({
      d: JSON.stringify([{ cle: '', libelle: 'x', genre: 'session' }]),
      m: '2026-11-20T10:00:00.000Z',
    });
    expect(new Registre(db, journal).groupesMasques()).toEqual([]);
  });

  test('une base d avant cette table reçoit la migration sans perdre ses catégories', () => {
    const chemin = join(dossier, 'migration.db');
    const ancienne = new Database(chemin, { create: true, strict: true });
    for (const sql of MIGRATIONS.slice(0, -1)) ancienne.exec(sql);
    ancienne.exec(`PRAGMA user_version = ${MIGRATIONS.length - 1}`);
    ancienne.query('INSERT INTO categories (id, document, maj_le) VALUES (1, $d, $m)').run({
      d: '[]',
      m: '2026-11-20T10:00:00.000Z',
    });
    ancienne.close();
    const migree = ouvrirBase(chemin);
    const r = new Registre(migree, journal);
    expect(r.groupesMasques()).toEqual([]);
    expect(r.enregistrerGroupesMasques([groupe('m')])).toEqual([groupe('m')]);
    const { user_version: version } = migree.query('PRAGMA user_version').get() as { user_version: number };
    expect(version).toBe(MIGRATIONS.length);
    migree.close();
  });
});
