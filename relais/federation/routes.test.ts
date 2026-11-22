// Routes de la fédération : sans aiguilleur, rien ne part ; corps invalides refusés ; réponses en JSON.
import { afterEach, describe, expect, test } from 'bun:test';
import { creerNoeud } from './banc-federation.ts';
import { routesFederation } from './api-federation.ts';
import type { Federation } from './federation.ts';

type Requete = Request & { params: Record<string, string> };
const sansProtection = (g: (req: Requete) => Response | Promise<Response>) => g;

const noeud = creerNoeud('seul');
const routes = routesFederation(noeud.federation as Federation, sansProtection);

afterEach(() => noeud.federation.arreter());

function requete(url: string, corps?: unknown, params: Record<string, string> = {}): Requete {
  const r = new Request(`http://local${url}`, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return Object.assign(r, { params });
}

describe('routes de la fédération', () => {
  test('état et sessions distantes lisibles, même sans aiguilleur', async () => {
    const etat = await routes['/api/federation']?.GET?.(requete('/api/federation'));
    expect(etat?.status).toBe(200);
    expect(((await etat?.json()) as { aiguilleur: unknown }).aiguilleur).toBeNull();
    const sessions = await routes['/api/federation/sessions']?.GET?.(requete('/api/federation/sessions'));
    expect(await sessions?.json()).toEqual([]);
  });

  test('appairage sans aiguilleur : refusé ; corps invalide : 400', async () => {
    const membre = 'a1b2c3d4e5f6';
    const refus = await routes['/api/federation/appairer']?.POST?.(requete('/api/federation/appairer', { membre }));
    expect(refus?.status).toBe(409);
    const invalide = await routes['/api/federation/appairer']?.POST?.(
      requete('/api/federation/appairer', { membre: 'x' }),
    );
    expect(invalide?.status).toBe(400);
  });

  test('décision sur une demande inconnue : 404', async () => {
    const reponse = await routes['/api/federation/demandes/:id']?.POST?.(
      requete('/api/federation/demandes/x', { accord: true }, { id: 'inconnue' }),
    );
    expect(reponse?.status).toBe(404);
  });
});
