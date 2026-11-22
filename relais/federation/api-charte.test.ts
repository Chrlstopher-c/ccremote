// Responsabilité : routes de la charte — forme des réponses, codes (200, 400, 403, 409), et garde des appareils sur
// `/api/reseau`. Port factice : les règles sont testées dans charte-noeud.test.ts, ici seulement le relais HTTP.
import { describe, expect, test } from 'bun:test';
import { type Charte, TOUS_DROITS } from '../../commun/charte.ts';
import { routesCharte, type PortRoutesCharte } from './api-charte.ts';
import { cheminRefuse } from './appareils.ts';
import { echec, ok, type Resultat } from './resultat.ts';

const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';
const CHARTE: Charte = {
  format: 1,
  reseau: '111111111111',
  nom: 'Maison',
  version: 1,
  chefs: [A],
  membres: [{ id: A, nom: 'a', sorte: 'pair', identite: 'x', droits: { ...TOUS_DROITS }, compte: null }],
  le: '2026-11-22T00:00:00.000Z',
  par: A,
  origine: 'creation',
};

type Requete = Request & { params: Record<string, string> };

type Parametres = { charte: Charte | null; moi: string | null; chef: boolean; resultat?: Resultat<Charte> };

function faux(p: Parametres): PortRoutesCharte {
  const resultat = p.resultat ?? ok(CHARTE);
  return {
    charte: () => p.charte,
    moi: () => p.moi,
    chefLocal: () => p.chef,
    creer: async () => resultat,
    editer: async () => resultat,
  };
}

function requete(methode: string, chemin: string, corps?: unknown, params: Record<string, string> = {}): Requete {
  const init: RequestInit = { method: methode, headers: { 'content-type': 'application/json' } };
  if (corps !== undefined) init.body = JSON.stringify(corps);
  return Object.assign(new Request(`http://noeud.interne${chemin}`, init), { params });
}

const protege = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => g(req);

describe('lecture', () => {
  test('GET : sans aiguilleur, pas de réseau à créer ; relié et sans charte, la création est possible', async () => {
    const sans = routesCharte(faux({ charte: null, moi: null, chef: false }), protege)['/api/reseau/charte'].GET;
    expect(await (await sans(requete('GET', '/api/reseau/charte'))).json()).toEqual({
      charte: null,
      moi: null,
      chef: false,
      peutCreer: false,
    });
    const relie = routesCharte(faux({ charte: null, moi: A, chef: false }), protege)['/api/reseau/charte'].GET;
    expect(await (await relie(requete('GET', '/api/reseau/charte'))).json()).toEqual({
      charte: null,
      moi: A,
      chef: false,
      peutCreer: true,
    });
  });
});

describe('écriture', () => {
  test('création : 200 avec la charte ; corps invalide : 400', async () => {
    const routes = routesCharte(faux({ charte: CHARTE, moi: A, chef: true }), protege);
    const bon = await routes['/api/reseau/charte'].POST(requete('POST', '/api/reseau/charte', { nom: 'Maison' }));
    expect(bon.status).toBe(200);
    expect(((await bon.json()) as { charte: Charte }).charte.reseau).toBe('111111111111');
    const mauvais = await routes['/api/reseau/charte'].POST(requete('POST', '/api/reseau/charte', { nom: '' }));
    expect(mauvais.status).toBe(400);
  });

  test('refus d’édition : le statut et le motif du port passent tels quels', async () => {
    const refus = echec(403, 'ce nœud n’est pas chef du réseau');
    const routes = routesCharte(faux({ charte: CHARTE, moi: B, chef: false, resultat: refus }), protege);
    const r = await routes['/api/reseau/charte/chefs'].POST(requete('POST', '/x', { membre: B, chef: true }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erreur: 'ce nœud n’est pas chef du réseau' });
    const conflit = echec(409, 'un serveur ne peut pas être chef');
    const autre = routesCharte(faux({ charte: CHARTE, moi: A, chef: true, resultat: conflit }), protege);
    const reponse = await autre['/api/reseau/charte/chefs'].POST(requete('POST', '/x', { membre: B, chef: true }));
    expect(reponse.status).toBe(409);
  });

  test('membre : identifiant invalide dans le chemin → 400 ; retrait et réglage → 200', async () => {
    const routes = routesCharte(faux({ charte: CHARTE, moi: A, chef: true }), protege);
    const invalide = await routes['/api/reseau/charte/membres/:membre'].POST(
      requete('POST', '/x', { compte: 'pro' }, { membre: 'pas-un-id' }),
    );
    expect(invalide.status).toBe(400);
    const regle = await routes['/api/reseau/charte/membres/:membre'].POST(
      requete('POST', '/x', { droits: { ...TOUS_DROITS, piloter: false } }, { membre: B }),
    );
    expect(regle.status).toBe(200);
    const retire = await routes['/api/reseau/charte/membres/:membre/retirer'].POST(
      requete('POST', '/x', undefined, { membre: B }),
    );
    expect(retire.status).toBe(200);
  });
});

describe('garde', () => {
  test('les routes de /api/reseau ne sont jamais servies à un appareil', () => {
    expect(cheminRefuse('/api/reseau/charte')).toBe(true);
    expect(cheminRefuse('/api/reseau/charte/membres/' + B + '/retirer')).toBe(true);
    expect(cheminRefuse('/api/sessions')).toBe(false);
  });
});
