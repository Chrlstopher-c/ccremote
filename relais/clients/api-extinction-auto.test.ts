// Responsabilité : tests des routes de l'extinction automatique et de son réglage (table du nœud) — GET par défaut à
// null, PUT puis GET, refus d'une valeur hors bornes, refus d'un corps non JSON, persistance entre deux instances.
import { describe, expect, test } from 'bun:test';
import { ouvrirBase } from '../registre/base.ts';
import { ReglageExtinctionAuto } from '../sessions/extinction-auto-reglage.ts';
import { lireExtinctionAuto, remplacerExtinctionAuto } from './api-extinction-auto.ts';

const URL_ROUTE = 'http://relais.test/api/machines/tour/extinction-auto';

function corps(valeur: unknown): Request {
  return new Request(URL_ROUTE, { method: 'PUT', body: JSON.stringify(valeur) });
}

function nouveauReglage(): ReglageExtinctionAuto {
  return new ReglageExtinctionAuto(ouvrirBase(':memory:'));
}

describe('routes de l’extinction automatique', () => {
  test('GET avant toute écriture : jamais (null)', async () => {
    const rep = lireExtinctionAuto(nouveauReglage());
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ delaiMinutes: null });
  });

  test('PUT rend le réglage, et GET le relit', async () => {
    const reglage = nouveauReglage();
    const rep = await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: 45 }));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toEqual({ delaiMinutes: 45 });
    expect(await lireExtinctionAuto(reglage).json()).toEqual({ delaiMinutes: 45 });
  });

  test('PUT null remet « jamais »', async () => {
    const reglage = nouveauReglage();
    await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: 10 }));
    await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: null }));
    expect(await lireExtinctionAuto(reglage).json()).toEqual({ delaiMinutes: null });
  });

  test('bornes 1 et 10080 acceptées', async () => {
    const reglage = nouveauReglage();
    expect((await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: 1 }))).status).toBe(200);
    expect((await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: 10080 }))).status).toBe(200);
  });

  test('valeur hors bornes, non entière ou de mauvais type : refusée, réglage inchangé', async () => {
    const reglage = nouveauReglage();
    await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: 20 }));
    for (const invalide of [0, -5, 10081, 1.5, '30', {}]) {
      const rep = await remplacerExtinctionAuto(reglage, corps({ delaiMinutes: invalide }));
      expect(rep.status).toBe(400);
    }
    expect(await lireExtinctionAuto(reglage).json()).toEqual({ delaiMinutes: 20 });
  });

  test('corps sans la clé delaiMinutes, ou non JSON : refusé', async () => {
    const reglage = nouveauReglage();
    expect((await remplacerExtinctionAuto(reglage, corps({}))).status).toBe(400);
    const brut = new Request(URL_ROUTE, { method: 'PUT', body: 'pas du json' });
    expect((await remplacerExtinctionAuto(reglage, brut)).status).toBe(400);
  });

  test('le réglage tenu en base survit à une nouvelle instance sur la même base', async () => {
    const base = ouvrirBase(':memory:');
    await remplacerExtinctionAuto(new ReglageExtinctionAuto(base), corps({ delaiMinutes: 120 }));
    expect(new ReglageExtinctionAuto(base).delai()).toBe(120);
  });
});
