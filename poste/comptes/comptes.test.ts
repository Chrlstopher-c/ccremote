import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { DetailCompte } from '../../commun/compte-detail.ts';
import type { ConfigPoste } from '../config.ts';
import { Comptes } from './comptes.ts';
import { LecteurCompte } from './lecture-compte.ts';

const journal = pino({ enabled: false });

function comptes(appels: string[]): Comptes {
  const config = { machine: 'tour', comptes: { principal: null, travail: '/x/travail' } } as unknown as ConfigPoste;
  const lecteur = new LecteurCompte({ journal, jeton: () => null });
  const detail = (nom: string, dossier: string | null): Promise<DetailCompte> => {
    appels.push(`${nom}:${String(dossier)}`);
    return Promise.resolve({ compte: nom } as unknown as DetailCompte);
  };
  Object.assign(lecteur, { detail });
  return new Comptes({
    config,
    journal,
    publier: () => undefined,
    enUsage: () => false,
    lecteur,
    usageSdk: async () => null,
  });
}

describe('vue et réinitialisation par compte', () => {
  test('compte inconnu : erreur claire, aucune lecture', async () => {
    const appels: string[] = [];
    const c = comptes(appels);
    expect(await c.detail('absent')).toEqual({ ok: false, erreur: 'compte absent inconnu sur tour' });
    expect(await c.reinitialiser('constructor', 'full-reset-2611')).toMatchObject({ ok: false });
    expect(appels).toEqual([]);
  });

  test('compte connu : lecture avec son dossier (null pour le compte par défaut)', async () => {
    const appels: string[] = [];
    const c = comptes(appels);
    expect(await c.detail('principal')).toEqual({ ok: true, donnees: { compte: 'principal' } });
    await c.detail('travail');
    expect(appels).toEqual(['principal:null', 'travail:/x/travail']);
  });
});
