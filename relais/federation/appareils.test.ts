// Responsabilité : le service d'API pour appareil — routes avec paramètres, refus des routes d'accès et de
// fédération, réponse inconnue, erreur de route convertie en 500.
import { expect, test } from 'bun:test';
import pino from 'pino';
import { cheminRefuse, correspondance, servirAppareil } from './appareils.ts';
import type { TableInterne } from './executeur.ts';

const silencieux = pino({ enabled: false });
const TABLE: TableInterne = {
  '/api/sessions/:id/taches/:tache': {
    GET: (req) => Response.json({ id: req.params['id'], tache: req.params['tache'] }),
  },
  '/api/corps': { POST: async (req) => Response.json({ recu: await req.text() }) },
  '/api/casse': { GET: () => { throw new Error('boum'); } },
};

test('les paramètres de la route sont extraits, les chemins refusés ne sont jamais servis', async () => {
  const servir = servirAppareil(TABLE, silencieux);
  expect(correspondance('/api/sessions/:id/taches/:tache', '/api/sessions/s1/taches/t9')).toEqual({
    id: 's1',
    tache: 't9',
  });
  expect(correspondance('/api/etat', '/api/autre')).toBeNull();
  expect(await servir({ methode: 'GET', chemin: '/api/sessions/s1/taches/t9' })).toEqual({
    statut: 200,
    corps: JSON.stringify({ id: 's1', tache: 't9' }),
  });
  expect((await servir({ methode: 'GET', chemin: '/api/federation/revoquer' })).statut).toBe(403);
  expect((await servir({ methode: 'POST', chemin: '/api/connexion' })).statut).toBe(403);
  expect((await servir({ methode: 'GET', chemin: '/api/inconnue' })).statut).toBe(404);
  expect((await servir({ methode: 'DELETE', chemin: '/api/corps' })).statut).toBe(404);
});

test('le corps d’une requête POST est transmis ; une route en échec donne 500, sans fuite', async () => {
  const servir = servirAppareil(TABLE, silencieux);
  expect(await servir({ methode: 'POST', chemin: '/api/corps', corps: '{"a":1}' })).toEqual({
    statut: 200,
    corps: JSON.stringify({ recu: '{"a":1}' }),
  });
  expect(await servir({ methode: 'GET', chemin: '/api/casse' })).toEqual({
    statut: 500,
    corps: JSON.stringify({ erreur: 'erreur interne' }),
  });
});

test('cheminRefuse couvre l’accès, la fédération, le duo et la synchro, sans confondre les préfixes', () => {
  expect(cheminRefuse('/api/acces/jetons')).toBe(true);
  expect(cheminRefuse('/api/duo')).toBe(true);
  expect(cheminRefuse('/api/synchro/demandes')).toBe(true);
  expect(cheminRefuse('/api/reseau/ajouts')).toBe(true);
  expect(cheminRefuse('/api/reseau/ajouts/tour/accepter')).toBe(true);
  expect(cheminRefuse('/api/federationx')).toBe(false);
  expect(cheminRefuse('/api/etat')).toBe(false);
});
