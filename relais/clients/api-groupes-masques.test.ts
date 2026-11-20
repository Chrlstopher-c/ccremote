// Responsabilité : tests des routes des groupes masqués de la barre latérale — GET vide, PUT puis GET, refus d'un corps
// invalide, doublon de clé gardé au premier, corps non JSON refusé.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { lireGroupesMasques, remplacerGroupesMasques } from './api-groupes-masques.ts';

const journal = pino({ level: 'silent' });

function nouveauRegistre(): Registre {
  return new Registre(ouvrirBase(':memory:'), journal);
}

function corps(valeur: unknown): Request {
  return new Request('http://relais.test/api/groupes-masques', { method: 'PUT', body: JSON.stringify(valeur) });
}

function groupe(cle: string, libelle = cle.toUpperCase()): Record<string, unknown> {
  return {
    cle,
    libelle,
    genre: 'dossier',
    machine: 'tour',
    dossier: `/projets/${cle}`,
    masqueLe: '2026-11-20T10:00:00.000Z',
  };
}

describe('routes des groupes masqués', () => {
  test('GET avant toute écriture : liste vide', async () => {
    const rep = lireGroupesMasques(nouveauRegistre());
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ groupes: [] });
  });

  test('PUT rend la liste normalisée, et GET la relit', async () => {
    const r = nouveauRegistre();
    const rep = await remplacerGroupesMasques(r, corps({ groupes: [groupe('a'), groupe('b')] }));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ groupes: [groupe('a'), groupe('b')] });
    expect(await lireGroupesMasques(r).json()).toEqual({ groupes: [groupe('a'), groupe('b')] });
  });

  test('une clé en double garde le premier groupe, sans refuser la requête', async () => {
    const rep = await remplacerGroupesMasques(
      nouveauRegistre(),
      corps({ groupes: [groupe('a', 'Premier'), groupe('a', 'Second')] }),
    );
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ groupes: [groupe('a', 'Premier')] });
  });

  test('genre inconnu : 400, rien n est écrit', async () => {
    const r = nouveauRegistre();
    const rep = await remplacerGroupesMasques(r, corps({ groupes: [{ ...groupe('a'), genre: 'session' }] }));
    expect(rep.status).toBe(400);
    expect(await rep.json()).toHaveProperty('erreur');
    expect(r.groupesMasques()).toEqual([]);
  });

  test('corps invalide (groupes pas une liste) : 400', async () => {
    const rep = await remplacerGroupesMasques(nouveauRegistre(), corps({ groupes: 'pas une liste' }));
    expect(rep.status).toBe(400);
  });

  test('corps non JSON : 400', async () => {
    const rep = await remplacerGroupesMasques(
      nouveauRegistre(),
      new Request('http://relais.test/api/groupes-masques', { method: 'PUT', body: '{' }),
    );
    expect(rep.status).toBe(400);
    expect(await rep.json()).toHaveProperty('erreur');
  });

  test('plus de 500 groupes : 400', async () => {
    const trop = Array.from({ length: 501 }, (_, i) => groupe(`g${i}`));
    const rep = await remplacerGroupesMasques(nouveauRegistre(), corps({ groupes: trop }));
    expect(rep.status).toBe(400);
  });
});
