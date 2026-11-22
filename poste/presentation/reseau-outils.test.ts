// Outils `reseau_*` contre une fausse API : la confirmation de Chris précède tout geste ; l'accord exige des empreintes
// identiques ; refus de Chris = rien n'est envoyé.
import { afterEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { VueAjout } from '../../commun/ajout-noeud.ts';
import { accepterAjout, ajouterAuReseau, retourArriere, suivreAjouts } from './reseau-outils.ts';

const journal = pino({ level: 'silent' });
let serveur: ReturnType<typeof Bun.serve> | null = null;

function vue(etat: VueAjout['etat'], concordance: VueAjout['concordance']): VueAjout {
  return { machine: 'tour', nom: 'Tour', etape: 'accord', etat, message: null, bascule: true, membre: 'abcdefabcdef',
    empreinteSsh: 'AAAA', empreinteVueParLeNoeud: 'BBBB', empreinteDemande: 'AAAA', concordance, reprise: null,
    majLe: '' };
}

function api(statutConfirmation: string, vues: VueAjout[]) {
  const appels: string[] = [];
  serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const u = new URL(req.url);
      appels.push(`${req.method} ${u.pathname}${req.method === 'POST' ? ` ${await req.text()}` : ''}`);
      if (u.pathname === '/api/confirmations') return Response.json({ id: 'c1' });
      if (u.pathname.startsWith('/api/confirmations/')) return Response.json({ statut: statutConfirmation });
      if (u.pathname === '/api/reseau/ajouts' && req.method === 'GET') return Response.json(vues);
      if (u.pathname === '/api/reseau/ajouts') return Response.json(vue('en_cours', null), { status: 202 });
      return Response.json({});
    },
  });
  return { api: { url: `http://127.0.0.1:${serveur.port}`, jeton: 'j' }, appels };
}

afterEach(() => {
  serveur?.stop(true);
  serveur = null;
});

describe('outils réseau', () => {
  test('ajouter : confirmation puis corps sans SSH pour une machine configurée', async () => {
    const { api: a, appels } = api('accordee', []);
    const r = await ajouterAuReseau(a, { machine: 'tour', nom: 'Tour' }, journal);
    expect(r.erreur).toBe(false);
    expect(appels[0]).toContain('POST /api/confirmations');
    expect(appels.at(-1)).toBe('POST /api/reseau/ajouts {"machine":"tour","nom":"Tour"}');
  });

  test('ajouter une machine neuve : accès SSH transmis', async () => {
    const { api: a, appels } = api('accordee', []);
    await ajouterAuReseau(a, { machine: 'vps', nom: 'VPS', hote: 'vps.exemple.test', utilisateur: 'chris', cle: '/k' },
      journal);
    expect(appels.at(-1)).toContain('"ssh":{"hote":"vps.exemple.test","port":22,"utilisateur":"chris","cle":"/k"}');
  });

  test('refus de Chris : rien n’est lancé', async () => {
    const { api: a, appels } = api('refusee', []);
    await ajouterAuReseau(a, { machine: 'tour', nom: 'Tour' }, journal);
    await retourArriere(a, 'tour', journal);
    expect(appels.some((x) => x.startsWith('POST /api/reseau'))).toBe(false);
  });

  test('accepter : seulement avec des empreintes identiques', async () => {
    const differente = api('accordee', [vue('accord_attendu', 'differente')]);
    expect((await accepterAjout(differente.api, 'tour', journal)).erreur).toBe(true);
    expect(differente.appels.some((x) => x.includes('/accepter'))).toBe(false);
    serveur?.stop(true);
    const identique = api('accordee', [vue('accord_attendu', 'identique')]);
    expect((await accepterAjout(identique.api, 'tour', journal)).erreur).toBe(false);
    expect(identique.appels.at(-1)).toContain('POST /api/reseau/ajouts/tour/accepter');
  });

  test('suivre : étape, empreintes et suite à donner', async () => {
    const { api: a } = api('accordee', [vue('accord_attendu', 'identique')]);
    const r = await suivreAjouts(a);
    expect(r.texte).toContain('Concordance : identique');
    expect(r.texte).toContain('reseau_accepter_ajout');
  });
});
