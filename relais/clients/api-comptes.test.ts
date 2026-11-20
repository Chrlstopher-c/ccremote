import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiComptes } from './api-comptes.ts';

const journal = pino({ enabled: false });

/** Postes simulés : une réponse par machine (absente = hors ligne), et les commandes reçues. */
function api(parMachine: Record<string, ReponsePoste>): { api: ApiComptes; recues: unknown[] } {
  const recues: unknown[] = [];
  const postes = {
    commander: (machine: string, commande: unknown) => {
      recues.push({ machine, commande });
      return Promise.resolve(parMachine[machine] ?? { ok: false, erreur: `${machine} est hors ligne` });
    },
  } as unknown as Postes;
  return { api: new ApiComptes(postes, journal), recues };
}

function requete(nom: string, corps?: unknown): Request & { params: { id: string; nom: string } } {
  const init: RequestInit = corps === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request('http://relais.test/api/machines/tour/comptes/x', init), {
    params: { id: 'tour', nom },
  });
}

describe('vue complète d’un compte (relais)', () => {
  test('transmet compte_detail au poste et rend son détail', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: { compte: 'principal', fenetres: [] } } });
    const reponse = await a.detail(requete('principal'));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({ compte: 'principal' });
    expect(recues).toEqual([{ machine: 'tour', commande: { kind: 'compte_detail', nom: 'principal' } }]);
  });

  test('nom de compte invalide : 400, rien n’est transmis', async () => {
    const { api: a, recues } = api({ tour: { ok: true } });
    expect((await a.detail(requete('Mauvais Nom'))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });

  test('poste hors ligne : 409', async () => {
    const { api: a } = api({});
    expect((await a.detail(requete('principal'))).status).toBe(409);
  });
});

describe('réinitialisation d’une limite (relais)', () => {
  test('transmet compte_reinitialiser avec l’offre, rend le résultat tel quel', async () => {
    const { api: a, recues } = api({ tour: { ok: true, donnees: { resultat: 'reset', efface: ['five_hour'] } } });
    const reponse = await a.reinitialiser(requete('principal', { offre: 'full-reset-2611' }));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toMatchObject({ resultat: 'reset' });
    expect(recues).toEqual([
      {
        machine: 'tour',
        commande: { kind: 'compte_reinitialiser', nom: 'principal', offre: 'full-reset-2611' },
      },
    ]);
  });

  test('offre mal formée : 400, rien n’est transmis', async () => {
    const { api: a, recues } = api({ tour: { ok: true } });
    expect((await a.reinitialiser(requete('principal', { offre: '../autre' }))).status).toBe(400);
    expect((await a.reinitialiser(requete('principal', {}))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });
});

describe('sessions Remote Control d’un compte (relais)', () => {
  test('transmet compte_distant au poste avec l’interrupteur, rend le résultat', async () => {
    const { api: a, recues } = api({ tour: { ok: true } });
    const reponse = await a.distant(requete('principal', { actif: true }));
    expect(reponse.status).toBe(200);
    expect(recues).toEqual([{ machine: 'tour', commande: { kind: 'compte_distant', nom: 'principal', actif: true } }]);
  });

  test('interrupteur absent ou mal typé : 400, rien n’est transmis', async () => {
    const { api: a, recues } = api({ tour: { ok: true } });
    expect((await a.distant(requete('principal', {}))).status).toBe(400);
    expect((await a.distant(requete('principal', { actif: 'oui' }))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });

  test('nom de compte invalide : 400', async () => {
    const { api: a, recues } = api({ tour: { ok: true } });
    expect((await a.distant(requete('Mauvais Nom', { actif: false }))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });
});
