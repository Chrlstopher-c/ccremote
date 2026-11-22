// Responsabilité : tests des outils de liaison directe (`reseau_ajouter_direct`, `reseau_transport_pair`,
// `reseau_directe_configurer`, `reseau_aide`) contre une fausse API du nœud — refus de Chris : aucun appel ; accord :
// le bon chemin et le bon corps ; la notice livrée est lue. Données de test seulement.
import { afterEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import { aideReseau, ajouterDirect, configurerDirecte, transportPair } from './reseau-directe-outils.ts';

const journal = pino({ level: 'silent' });
const MEMBRE = 'abcdefabcdef';
let serveur: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  serveur?.stop(true);
  serveur = null;
});

function api(confirmation: 'accordee' | 'refusee') {
  const appels: string[] = [];
  serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const u = new URL(req.url);
      const corps = req.method === 'POST' ? await req.text() : '';
      appels.push(`${req.method} ${u.pathname}${corps ? ` ${corps}` : ''}`);
      if (u.pathname === '/api/confirmations') return Response.json({ id: 'c1' });
      if (u.pathname.startsWith('/api/confirmations/')) return Response.json({ statut: confirmation });
      return Response.json({});
    },
  });
  return { api: { url: `http://127.0.0.1:${serveur.port}`, jeton: 'j' }, appels };
}

describe('outils de liaison directe', () => {
  test('refus de Chris : rien n’est envoyé au nœud', async () => {
    const { api: a, appels } = api('refusee');
    const r = await ajouterDirect(a, '192.0.2.10:47500', journal);
    expect(r.texte).toContain('rien n’a été fait');
    expect(appels.some((x) => x.includes('/api/federation/'))).toBe(false);
  });

  test('accord : l’adresse part vers l’appairage direct', async () => {
    const { api: a, appels } = api('accordee');
    const r = await ajouterDirect(a, '192.0.2.10:47500', journal);
    expect(r.erreur).toBe(false);
    expect(appels).toContain('POST /api/federation/directe/appairer {"adresse":"192.0.2.10:47500"}');
  });

  test('transport d’un pair : adresse ou repli, vers la route du pair', async () => {
    const { api: a, appels } = api('accordee');
    await transportPair(a, MEMBRE, '127.0.0.1:47591', journal);
    await transportPair(a, MEMBRE, null, journal);
    expect(appels).toContain(`POST /api/federation/pairs/${MEMBRE}/transport {"adresse":"127.0.0.1:47591"}`);
    expect(appels).toContain(`POST /api/federation/pairs/${MEMBRE}/transport {"adresse":null}`);
  });

  test('réglage de l’écoute : seuls les champs donnés sont envoyés', async () => {
    const { api: a, appels } = api('accordee');
    await configurerDirecte(a, { ecoute: '127.0.0.1:47500' }, journal);
    expect(appels).toContain('POST /api/federation/directe {"ecoute":"127.0.0.1:47500"}');
  });

  test('la notice livrée se lit et décrit les trois façons de relier', async () => {
    const r = await aideReseau(journal);
    expect(r.erreur).toBe(false);
    expect(r.texte).toContain('Par un aiguilleur');
    expect(r.texte).toContain('tunnel ssh');
    expect(r.texte).toContain('Réseau local seul');
  });
});
