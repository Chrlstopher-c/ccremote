// Responsabilité : tests des outils `reseau_invite_*` contre une fausse API du nœud — confirmation de Chris avant tout
// changement, fusion des seuls champs donnés, réglages invalides refusés sans appel, activité en lecture seule.
import { afterEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import { reglagesParDefaut } from '../../commun/invites.ts';
import { activiteInvite, aideInvites, inviter, reglerInvite } from './reseau-invites-outils.ts';

const journal = pino({ level: 'silent' });
const MEMBRE = 'abcdefabcdef';
let serveur: ReturnType<typeof Bun.serve> | null = null;

interface Reponses {
  readonly confirmation: 'accordee' | 'refusee';
  readonly charte?: unknown;
  readonly activite?: unknown;
}

function api(r: Reponses) {
  const appels: string[] = [];
  serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const u = new URL(req.url);
      const corps = req.method === 'POST' ? await req.text() : '';
      appels.push(`${req.method} ${u.pathname}${corps ? ` ${corps}` : ''}`);
      if (u.pathname === '/api/confirmations') return Response.json({ id: 'c1' });
      if (u.pathname.startsWith('/api/confirmations/')) return Response.json({ statut: r.confirmation });
      if (u.pathname === '/api/reseau/charte') return Response.json(r.charte ?? { charte: null });
      if (u.pathname.endsWith('/activite')) return Response.json(r.activite ?? { telemetrie: true, activite: null });
      return Response.json({});
    },
  });
  return { api: { url: `http://127.0.0.1:${serveur.port}`, jeton: 'j' }, appels };
}

function charteAvecInvite(): unknown {
  return {
    charte: { membres: [{ id: MEMBRE, invite: reglagesParDefaut(MEMBRE) }] },
    moi: null,
    chef: true,
    peutCreer: false,
  };
}

afterEach(() => {
  serveur?.stop(true);
  serveur = null;
});

describe('reseau_invite_regler', () => {
  test('ne change que les champs donnés, après confirmation', async () => {
    const { api: a, appels } = api({ confirmation: 'accordee', charte: charteAvecInvite() });
    const r = await reglerInvite(a, { membre: MEMBRE, part5h: 40 }, journal);
    expect(r.erreur).toBe(false);
    const post = appels.find((x) => x.startsWith(`POST /api/reseau/charte/membres/${MEMBRE}/invite`));
    expect(post).toBeDefined();
    const envoye = JSON.parse((post ?? '').slice(post?.indexOf('{') ?? 0)) as { reglages: { part5h: number; simultanees: number } };
    expect(envoye.reglages.part5h).toBe(40);
    expect(envoye.reglages.simultanees).toBe(2);
    expect(appels.findIndex((x) => x.includes('/api/confirmations'))).toBeLessThan(appels.indexOf(post ?? ''));
  });

  test('refus de Chris : aucun POST', async () => {
    const { api: a, appels } = api({ confirmation: 'refusee', charte: charteAvecInvite() });
    await reglerInvite(a, { membre: MEMBRE, part5h: 40 }, journal);
    expect(appels.some((x) => x.startsWith('POST /api/reseau/charte'))).toBe(false);
  });

  test('réglage invalide (part hors 0-100) : erreur, aucun POST', async () => {
    const { api: a, appels } = api({ confirmation: 'accordee', charte: charteAvecInvite() });
    const r = await reglerInvite(a, { membre: MEMBRE, part5h: 150 }, journal);
    expect(r.erreur).toBe(true);
    expect(appels.some((x) => x.startsWith('POST'))).toBe(false);
  });

  test('membre non invité : erreur claire, aucun POST', async () => {
    const charte = { charte: { membres: [{ id: MEMBRE }] }, moi: null, chef: true, peutCreer: false };
    const { api: a, appels } = api({ confirmation: 'accordee', charte });
    const r = await reglerInvite(a, { membre: MEMBRE, part5h: 40 }, journal);
    expect(r.erreur).toBe(true);
    expect(r.texte).toContain('reseau_inviter');
    expect(appels.some((x) => x.startsWith('POST'))).toBe(false);
  });

  test('acces fusionné champ par champ ; rien à changer : pas de confirmation', async () => {
    const { api: a, appels } = api({ confirmation: 'accordee', charte: charteAvecInvite() });
    const r = await reglerInvite(a, { membre: MEMBRE, acces: { modules: true } }, journal);
    const post = appels.find((x) => x.includes('/invite ')) ?? '';
    expect(post).toContain('"modules":true');
    expect(post).toContain('"terminaux":false');
    expect(r.erreur).toBe(false);
    const rien = api({ confirmation: 'accordee', charte: charteAvecInvite() });
    await reglerInvite(rien.api, { membre: MEMBRE, part5h: 25 }, journal);
    expect(rien.appels.some((x) => x.startsWith('POST /api/confirmations'))).toBe(false);
  });
});

describe('reseau_inviter', () => {
  test('confirmation puis POST ; refus : rien n’est envoyé', async () => {
    const ok = api({ confirmation: 'accordee' });
    expect((await inviter(ok.api, MEMBRE, journal)).erreur).toBe(false);
    expect(ok.appels.at(-1)).toBe(`POST /api/reseau/invites {"membre":"${MEMBRE}"}`);
    const non = api({ confirmation: 'refusee' });
    await inviter(non.api, MEMBRE, journal);
    expect(non.appels.some((x) => x.startsWith('POST /api/reseau/invites'))).toBe(false);
  });
});

describe('reseau_invite_activite et aide', () => {
  test('activité : lecture sans confirmation, texte lisible', async () => {
    const activite = { telemetrie: true, activite: { actifAujourdhui: true, sessionsAujourdhui: 2, sessionsEnCours: 1,
      jetonsAujourdhui: 1234, part5h: { consomme: 12, part: 25 } } };
    const { api: a, appels } = api({ confirmation: 'refusee', activite });
    const r = await activiteInvite(a, MEMBRE);
    expect(r.texte).toContain('Sessions aujourd’hui : 2 (en cours : 1)');
    expect(r.texte).toContain('Limite 5 h : consommé 12, part 25');
    expect(appels.some((x) => x.includes('/api/confirmations'))).toBe(false);
  });

  test('télémétrie coupée : le texte le dit', async () => {
    const { api: a } = api({ confirmation: 'accordee', activite: { telemetrie: false, activite: null } });
    expect((await activiteInvite(a, MEMBRE)).texte).toContain('Télémétrie coupée');
  });

  test('aide : le fichier livré, ou un message clair s’il manque', async () => {
    const r = await aideInvites(journal);
    expect(r.erreur ? r.texte.includes('ressources/aide/invites.md') : r.texte.length > 0).toBe(true);
  });
});
