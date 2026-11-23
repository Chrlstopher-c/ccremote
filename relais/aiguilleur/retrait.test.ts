// Retrait d'un membre de l'annuaire par un nœud de même propriétaire (sorti de la charte) : révoqué, il quitte la
// présence ; refus pour un autre propriétaire, un appareil, soi-même, un inconnu, sans jeton.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { PlafondEchecs } from '../acces/plafond.ts';
import { CHEMIN_RETRAIT_MEMBRE } from '../../commun/aiguilleur.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { creerAiguilleur } from './aiguilleur.ts';
import { executerCommande } from './commande.ts';

interface Identite {
  readonly id: string;
  readonly jeton: string;
}

let annuaire: Annuaire;
let serveur: ReturnType<typeof Bun.serve>;

beforeEach(() => {
  const journal = pino({ enabled: false });
  annuaire = new Annuaire(ouvrirAnnuaire(':memory:'));
  const plafond = new PlafondEchecs(join(mkdtempSync(join(tmpdir(), 'retrait-')), 'echecs.json'), journal);
  const aiguilleur = creerAiguilleur({ annuaire, journal, plafond });
  serveur = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: aiguilleur.fetch, websocket: aiguilleur.websocket });
});

afterEach(() => {
  serveur.stop(true);
});

const url = (chemin: string): string => `http://127.0.0.1:${serveur.port}${chemin}`;

async function membre(proprietaire: string, genre: 'noeud' | 'appareil' = 'noeud'): Promise<Identite> {
  const code = executerCommande(['appairer', proprietaire], annuaire).split('\n')[0] ?? '';
  const rep = await fetch(url('/api/membres/appairer'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: `${proprietaire}-${genre}`, genre, cle: randomBytes(32).toString('base64url') }),
  });
  expect(rep.status).toBe(200);
  return (await rep.json()) as Identite;
}

function retirer(jeton: string | null, membreId: string): Promise<Response> {
  const entetes: Record<string, string> = { 'content-type': 'application/json' };
  if (jeton !== null) entetes['authorization'] = `Bearer ${jeton}`;
  const corps = JSON.stringify({ membre: membreId });
  return fetch(url(CHEMIN_RETRAIT_MEMBRE), { method: 'POST', headers: entetes, body: corps });
}

describe('retrait d’un membre par un nœud', () => {
  test('même propriétaire : le membre est révoqué dans l’annuaire', async () => {
    const chef = await membre('alice');
    const invite = await membre('alice');
    const rep = await retirer(chef.jeton, invite.id);
    expect(rep.status).toBe(200);
    expect(annuaire.membre(invite.id)?.revoqueLe).toBeTruthy();
  });

  test('déjà révoqué : 200, rien ne change', async () => {
    const chef = await membre('alice');
    const invite = await membre('alice');
    expect((await retirer(chef.jeton, invite.id)).status).toBe(200);
    expect((await retirer(chef.jeton, invite.id)).status).toBe(200);
  });

  test('refus : autre propriétaire 403, appareil 403, soi-même 400, inconnu 404, sans jeton 401', async () => {
    const chef = await membre('alice');
    const autre = await membre('bob');
    const appareil = await membre('alice', 'appareil');
    expect((await retirer(chef.jeton, autre.id)).status).toBe(403);
    expect((await retirer(appareil.jeton, chef.id)).status).toBe(403);
    expect((await retirer(chef.jeton, chef.id)).status).toBe(400);
    expect((await retirer(chef.jeton, 'abcdefabcdef')).status).toBe(404);
    expect((await retirer(null, chef.id)).status).toBe(401);
    expect(annuaire.membre(autre.id)?.revoqueLe ?? null).toBeNull();
  });
});
