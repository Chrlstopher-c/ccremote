// Routes des invités : réglages partiels (fusion champ par champ, 404 si non invité) et invitation tout-en-un (chef
// seulement). Table de routes réelle, port simulé sur une charte construite à la main (sans signature).
import { describe, expect, test } from 'bun:test';
import { AUCUN_DROIT, type Charte, type Edition, type MembreCharte } from '../../commun/charte.ts';
import { reglagesParDefaut } from '../../commun/invites.ts';
import { ok, echec, type Resultat } from '../federation/resultat.ts';
import type { NoeudInvites } from './noeud-invites.ts';
import { type PortApiInvites, routesInvites } from './api-invites.ts';

const CHEF = 'aaaaaaaaaaaa';
const INVITE = 'bbbbbbbbbbbb';
const LE = '2026-11-23T10:00:00.000Z';

function charte(): Charte {
  const chef: MembreCharte = {
    id: CHEF,
    nom: 'tour',
    sorte: 'serveur',
    identite: 'identite-chef',
    droits: { ...AUCUN_DROIT },
    compte: null,
  };
  const invite: MembreCharte = {
    id: INVITE,
    nom: 'portable',
    sorte: 'pair',
    identite: 'identite-invite',
    droits: { ...AUCUN_DROIT },
    compte: null,
    invite: reglagesParDefaut(CHEF),
  };
  return {
    format: 1,
    reseau: '111111111111',
    nom: 'Mon réseau',
    version: 1,
    chefs: [CHEF],
    membres: [chef, invite],
    le: LE,
    par: CHEF,
    origine: 'creation',
  };
}

interface Montage {
  readonly table: ReturnType<typeof routesInvites>;
  readonly sortie: { charte: Charte | null };
  readonly port: PortApiInvites;
}

function monter(options: { chef: boolean; avecCharte: boolean; codes?: PortApiInvites['codes'] }): Montage {
  const sortie: { charte: Charte | null } = { charte: null };
  const courante = options.avecCharte ? charte() : null;
  const codesParDefaut: PortApiInvites['codes'] = {
    configuration: () => null,
    creer: async () => echec(409, 'non relié'),
    demanderVpn: async () => echec(409, 'non relié'),
  };
  const port: PortApiInvites = {
    // Seules les routes ci-dessous sont appelées : les autres services ne servent pas ici.
    invites: null as unknown as NoeudInvites,
    charte: () => courante,
    moi: () => CHEF,
    chefLocal: () => options.chef,
    editer: async (fn): Promise<Resultat<Charte>> => {
      if (courante === null) return echec(409, 'aucun réseau sur ce nœud');
      const e: Edition = fn(courante, CHEF, LE);
      if (!e.ok) return echec(409, e.raison);
      sortie.charte = e.charte;
      return ok(e.charte);
    },
    appairer: () => echec(409, 'hors test'),
    ouvrirAvec: async () => new Response('hors test', { status: 500 }),
    ouvrirChez: async () => new Response('hors test', { status: 500 }),
    enLigne: () => false,
    commander: async () => ({ ok: false, erreur: 'hors test' }),
    session: () => null,
    repli: async () => new Response('hors test', { status: 500 }),
    codes: options.codes ?? codesParDefaut,
  };
  return { table: routesInvites(port, (g) => g), sortie, port };
}

function requete(corps: unknown, params: Record<string, string>): Request & { params: Record<string, string> } {
  return Object.assign(
    new Request('http://local/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params },
  );
}

const ROUTE_INVITE = '/api/reseau/charte/membres/:membre/invite';
const ROUTE_INVITATION = '/api/reseau/invites/invitation';

describe('réglages partiels d’un invité', () => {
  test('un seul champ : les autres réglages restent, le changement est enregistré dans la charte', async () => {
    const m = monter({ chef: true, avecCharte: true });
    const rep = await m.table[ROUTE_INVITE].POST(requete({ reglages: { part5h: 40 } }, { membre: INVITE }));
    expect(rep.status).toBe(200);
    const invite = m.sortie.charte?.membres.find((x) => x.id === INVITE)?.invite;
    expect(invite).toEqual({ ...reglagesParDefaut(CHEF), part5h: 40 });
  });

  test('acces fusionné champ par champ : les autres accès gardent leur valeur', async () => {
    const m = monter({ chef: true, avecCharte: true });
    await m.table[ROUTE_INVITE].POST(requete({ reglages: { acces: { terminaux: true } } }, { membre: INVITE }));
    const acces = m.sortie.charte?.membres.find((x) => x.id === INVITE)?.invite?.acces;
    expect(acces).toEqual({ ...reglagesParDefaut(CHEF).acces, terminaux: true });
  });

  test('modeles donné : remplace la liste entière', async () => {
    const m = monter({ chef: true, avecCharte: true });
    await m.table[ROUTE_INVITE].POST(requete({ reglages: { modeles: { opus: ['low'] } } }, { membre: INVITE }));
    expect(m.sortie.charte?.membres.find((x) => x.id === INVITE)?.invite?.modeles).toEqual({ opus: ['low'] });
  });

  test('valeur hors bornes : 400, rien n’est modifié', async () => {
    const m = monter({ chef: true, avecCharte: true });
    const rep = await m.table[ROUTE_INVITE].POST(requete({ reglages: { part5h: 999 } }, { membre: INVITE }));
    expect(rep.status).toBe(400);
    expect(m.sortie.charte).toBeNull();
  });

  test('membre non invité (ou aucun réseau) : 404', async () => {
    const m = monter({ chef: true, avecCharte: true });
    const rep = await m.table[ROUTE_INVITE].POST(requete({ reglages: { part5h: 10 } }, { membre: CHEF }));
    expect(rep.status).toBe(404);
    const sansReseau = monter({ chef: true, avecCharte: false });
    const rep2 = await sansReseau.table[ROUTE_INVITE].POST(requete({ reglages: { part5h: 10 } }, { membre: INVITE }));
    expect(rep2.status).toBe(404);
  });
});

describe('invitation tout-en-un : POST /api/reseau/invites/invitation', () => {
  test('un nœud qui n’est pas chef : 403', async () => {
    const m = monter({ chef: false, avecCharte: true });
    const rep = await m.table[ROUTE_INVITATION].POST(requete({}, {}));
    expect(rep.status).toBe(403);
  });

  test('chef : la création passe par les codes du nœud ; ses refus sont rendus tels quels', async () => {
    const m = monter({ chef: true, avecCharte: true });
    const rep = await m.table[ROUTE_INVITATION].POST(requete({}, {}));
    expect(rep.status).toBe(409);
    expect(await rep.json()).toEqual({ erreur: 'nœud non relié à un aiguilleur' });
  });

  test('corps non vide refusé (le corps attendu est {})', async () => {
    const m = monter({ chef: true, avecCharte: true });
    const rep = await m.table[ROUTE_INVITATION].POST(requete({ extra: 1 }, {}));
    expect(rep.status).toBe(400);
  });
});
