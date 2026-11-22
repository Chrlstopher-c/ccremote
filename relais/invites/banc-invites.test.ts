// Responsabilité : la politique des invités sur le banc réel — chef (A), nœud qui fait tourner les sessions (B),
// invité (G) : ouverture, limites, filtre du fil et de l'instantané, garde des gestes, activité télémétrée.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exporterIdentitePublique, genererIdentite } from '../../commun/chiffrement/identite.ts';
import { type Charte, changerInvite, creerCharte, inviterMembre, membreDe, signerCharte } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { reglagesParDefaut, type ReglagesInvite } from '../../commun/invites.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { CanalNoeud } from '../federation/canal.ts';
import type { Canaux } from '../federation/canaux.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  type Gestes,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from '../federation/banc-federation.ts';
import { ApiInvites, type PortApiInvites } from './api-invites.ts';
import type { CorpsOuverture } from '../clients/api-sessions.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';

let monte: Monte;
let noeuds: Noeud[] = [];
let racine: string;
const ouvertes: { corps: CorpsOuverture; cadre: CadreInvite }[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
  racine = mkdtempSync(join(tmpdir(), 'invites-racine-'));
  ouvertes.length = 0;
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
  rmSync(racine, { recursive: true, force: true });
});

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MAJ = '2026-11-22T10:00:00.000Z';
const REINIT = '2026-11-22T15:00:00.000Z';

/** Un compte connecté sur la machine (défaut), avec sa fenêtre de 5 h relevée. */
function poserCompteLocal(n: Noeud, pourcent: number, reinit: string): void {
  n.registre.enregistrerMachine({
    id: n.nom,
    description: n.nom,
    racines: [],
    projets: [],
    comptes: ['defaut'],
    version: 'test',
    derniereVue: MAJ,
  });
  n.registre.majComptes(n.nom, [
    {
      id: 'defaut',
      defaut: true,
      connecte: true,
      email: null,
      organisation: null,
      abonnement: 'max',
      session: { libelle: '5 h', pourcent, reinitialiseLe: reinit },
      semaine: null,
      autres: [],
      probleme: null,
      releveLe: MAJ,
      connexion: null,
      distant: false,
      cle: 'compte@test',
      usageLe: MAJ,
      prochainReleve: null,
    },
  ]);
}
const CORPS_HAIKU = {
  machine: 'x',
  projet: { machine: 'x', chemin: '/x', nom: 'x' },
  message: 'bonjour',
  modele: 'haiku',
  effort: 'low',
};

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

/** Appairage : Chris accepte chez `b` ; `reconnu` = `b` a déjà ce membre dans sa charte (admis d'office). */
async function appairer(a: Noeud, b: Noeud, reconnu = false): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  if (!reconnu) {
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    const demande = (await b.federation.etat()).demandes[0];
    expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  }
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return { idA, idB };
}

async function nouveau(nom: string, options = {}, gestes?: Gestes): Promise<Noeud> {
  const n = creerNoeud(nom, { invitesRacine: racine, ...options }, gestes);
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

function reglagesG(machines: string[], surcharge: Partial<ReglagesInvite> = {}): ReglagesInvite {
  return {
    ...reglagesParDefaut(null),
    modeles: { haiku: ['low', 'medium'] },
    part5h: 10,
    partSemaine: 25,
    simultanees: 2,
    machines,
    ...surcharge,
  };
}

/** Un chef (A, réseau créé par la reprise), B qui fait tourner les sessions, G invité sur B. */
async function reseau(surcharge: Partial<ReglagesInvite> = {}) {
  let b: Noeud | undefined;
  const gestes: Gestes = (g) => {
    if (!g.invite || b === undefined) return undefined;
    return b.federation.invites.executerOuverture(g, async (corps, cadre) => {
      ouvertes.push({ corps, cadre });
      const id = `session-${ouvertes.length}`;
      poser(b as Noeud, id, 'tour', cadre.membre, cadre.nom, 'attente');
      return Response.json({ id }, { status: 201 });
    });
  };
  b = await nouveau('tour', {}, gestes);
  const a = await nouveau('portable', { peutReprendre: true });
  const g = await nouveau('elie');
  const { idA, idB } = await appairer(a, b);
  await attendre(() => b.federation.charte.charte() !== null);
  const idG = await idDe(g);
  await appairer(a, g);
  const charteA = a.federation.charte.charte();
  if (charteA === null) throw new Error('charte absente');
  const invite = { id: idG, nom: 'Elie', identite: exporterIdentitePublique((await genererIdentite()).publique) };
  const reglages = reglagesG([idB], surcharge);
  const r = await a.federation.charte.editer((c, moi, le) =>
    inviterMembre(c, moi, { ...invite, identite: membreDe(c, idG)?.identite ?? invite.identite }, reglages, le),
  );
  expect(r.ok).toBe(true);
  await attendre(
    () => b.federation.charte.charte()?.membres.some((m) => m.id === idG && m.invite !== undefined) === true,
  );
  await appairer(g, b, true);
  await attendre(() => g.federation.charte.charte() !== null);
  return { a, b, g, idA, idB, idG };
}

type Reseau = Awaited<ReturnType<typeof reseau>>;

function poser(
  n: Noeud,
  id: string,
  machine: string,
  membre: string | null,
  nom: string,
  statut: ResumeSession['statut'],
): void {
  const fiche: ResumeSession = {
    ...ficheDe(id, machine, `Titre ${id}`),
    statut,
    ...(membre ? { invite: { membre, nom } } : {}),
  };
  n.registre.enregistrerSession(fiche);
  n.diffusion.diffuser({ type: 'session', session: fiche });
}

async function ouvrirChezB(r: Reseau, corps: Record<string, unknown> = CORPS_HAIKU): Promise<Response> {
  return r.g.federation.ouvrirChez(r.idB, JSON.stringify(corps));
}

describe('ouverture par l’invité', () => {
  test('haiku en low : ouverte sur B, corps réécrit, cadre sous la racine des espaces, mode default', async () => {
    const r = await reseau();
    const rep = await ouvrirChezB(r);
    expect(rep.status).toBe(201);
    expect(ouvertes).toHaveLength(1);
    const [ouverte] = ouvertes;
    expect(ouverte?.corps.mode).toBe('default');
    expect(ouverte?.corps.bac_a_sable).toBeUndefined();
    expect(ouverte?.cadre.espace.startsWith(racine)).toBe(true);
    expect(ouverte?.cadre.membre).toBe(r.idG);
    expect(ouverte?.corps.modele).toBe('haiku');
  });

  test('opus refusé (modèle non permis)', async () => {
    const r = await reseau();
    const rep = await ouvrirChezB(r, { ...CORPS_HAIKU, modele: 'opus' });
    expect(rep.status).toBe(403);
    expect(ouvertes).toHaveLength(0);
  });

  test('haiku en high refusé (effort non permis)', async () => {
    const r = await reseau();
    expect((await ouvrirChezB(r, { ...CORPS_HAIKU, effort: 'high' })).status).toBe(403);
  });

  test('consommation ≥ part (fenêtre de 5 h du compte relevée) : ouverture refusée', async () => {
    const r = await reseau();
    poserCompteLocal(r.b, 30, REINIT);
    r.b.federation.invites.compteurs.miseAJour(r.idG, (m) => ({ ...m, session: { cle: REINIT, consomme: 12 } }));
    expect((await ouvrirChezB(r)).status).toBe(403);
  });

  test('troisième session en cours : refusée', async () => {
    const r = await reseau();
    poser(r.b, 'en-cours-1', 'tour', r.idG, 'Elie', 'travail');
    poser(r.b, 'en-cours-2', 'tour', r.idG, 'Elie', 'travail');
    expect((await ouvrirChezB(r)).status).toBe(403);
  });

  test('ouvrir chez le chef (machine non permise) : refusé', async () => {
    const r = await reseau();
    expect((await r.g.federation.ouvrirChez(r.idA, JSON.stringify(CORPS_HAIKU))).status).toBe(403);
  });

  test('un corps HTTP local avec `invite` le perd (le schéma public ne le connaît pas)', async () => {
    const { CorpsOuverture: Schema } = await import('../clients/api-sessions.ts');
    const lu = Schema.parse({ ...CORPS_HAIKU, invite: { membre: 'aaaaaaaaaaaa', nom: 'x' } });
    expect('invite' in lu).toBe(false);
  });

  test('ouverture locale (G est invité) : relayée à B, la même politique', async () => {
    const r = await reseau();
    const port: PortApiInvites = {
      invites: r.g.federation.invites,
      charte: () => r.g.federation.charte.charte(),
      moi: () => r.g.federation.charte.moi(),
      chefLocal: () => false,
      editer: (fn) => r.g.federation.charte.editer(fn),
      appairer: (m) => r.g.federation.appairer(m),
      ouvrirAvec: async () => new Response('non', { status: 500 }),
      ouvrirChez: (m, texte) => r.g.federation.ouvrirChez(m, texte),
      enLigne: (m) => r.g.federation.machineEnLigne(m),
      commander: async () => ({ ok: true, donnees: {} }),
      session: (id) => r.g.registre.session(id),
      repli: async () => new Response('repli', { status: 500 }),
    };
    const api = new ApiInvites(port);
    const rep = await api.ouvrirSession(
      new Request('http://g/api/sessions', { method: 'POST', body: JSON.stringify(CORPS_HAIKU) }),
    );
    expect(rep.status).toBe(201);
    expect(ouvertes).toHaveLength(1);
  });
});

describe('ce que l’invité peut lire et écrire', () => {
  test('fil d’une session non invitée de B ou du chef : refusé (sessionsAutres coupé)', async () => {
    const r = await reseau();
    poser(r.b, 'session-b-libre', 'tour', null, '', 'attente');
    expect((await r.g.federation.distantes.fil(r.idB, 'session-b-libre')).ok).toBe(false);
    expect((await r.g.federation.distantes.fil(r.idA, 'session-du-chef')).ok).toBe(false);
  });

  test('instantané reçu par G : seulement ses sessions', async () => {
    const r = await reseau();
    poser(r.b, 'session-b-libre', 'tour', null, '', 'attente');
    poser(r.b, 'session-g', 'tour', r.idG, 'Elie', 'attente');
    await attendre(() => r.g.federation.distantes.sessions().some((s) => s.session.id === 'session-g'));
    const vues = r.g.federation.distantes
      .sessions()
      .filter((s) => s.membre === r.idB)
      .map((s) => s.session.id);
    expect(vues).toContain('session-g');
    expect(vues).not.toContain('session-b-libre');
  });

  test('le chef A voit la session de G masquée, son fil lui est refusé, interrompre permis', async () => {
    const r = await reseau();
    poser(r.b, 'session-g', 'tour', r.idG, 'Elie', 'attente');
    await attendre(() => r.a.federation.distantes.sessions().some((s) => s.session.id === 'session-g'));
    const vue = r.a.federation.distantes.sessions().find((s) => s.session.id === 'session-g');
    expect(vue?.session.titre).toBe('Conversation de Elie');
    expect(vue?.session.cwd).toBe('');
    expect((await r.a.federation.distantes.fil(r.idB, 'session-g')).ok).toBe(false);
    expect((await r.a.federation.distantes.interrompre(r.idB, 'session-g')).ok).toBe(true);
    expect(r.b.appels.interrompre).toContain('session-g');
  });

  test('geste hors liste blanche (mode) : 403 ; remote-control : 403', async () => {
    const r = await reseau();
    poser(r.b, 'session-g', 'tour', r.idG, 'Elie', 'attente');
    await attendre(() => r.g.federation.distantes.sessions().some((s) => s.session.id === 'session-g'));
    const mode = await r.g.federation.distantes.intercepter(
      new Request('http://g/api/sessions/session-g/mode', { method: 'POST', body: JSON.stringify({ mode: 'plan' }) }),
    );
    expect(mode?.status).toBe(403);
    const rc = await r.g.federation.distantes.intercepter(
      new Request('http://g/api/sessions/session-g/remote-control', {
        method: 'POST',
        body: JSON.stringify({ actif: true }),
      }),
    );
    expect(rc?.status).toBe(403);
  });

  test('G n’est pas chef : sa charte forgée et son action de chef sont refusées', async () => {
    const r = await reseau();
    const version = r.b.federation.charte.charte()?.version;
    const lien = r.g.federation as unknown as { canaux: Canaux };
    const canal: CanalNoeud | null = lien.canaux.liaisonOuverteAvec(r.idB);
    const forgee: MessageChiffre = { t: 'action_noeud', ref: 'aaaaaaaaaaaaaaaa', action: 'pause' };
    canal?.envoyer(forgee);
    await pause(200);
    expect(r.b.federation.enPause()).toBe(false);
    expect(r.b.federation.charte.charte()?.version).toBe(version);
  });

  test('l’appli locale du chef ne lit pas une session d’invité, ni ses événements', async () => {
    const r = await reseau();
    poser(r.b, 'session-g', 'tour', r.idG, 'Elie', 'attente');
    const masquee = r.b.federation.invites
      .sessionsPour(null, r.b.registre.sessions(true))
      .find((s) => s.id === 'session-g');
    expect(masquee?.titre).toBe('Conversation de Elie');
    expect(r.b.federation.invites.gardeLocale('http://tour/api/sessions/session-g/evenements')?.status).toBe(403);
    expect(r.b.federation.invites.gardeLocale('http://tour/api/sessions/session-g/interrompre')).toBeNull();
    const evt = r.b.federation.invites.vueAppli({ type: 'evenement', evenement: { sessionId: 'session-g' } as never });
    expect(evt).toBeNull();
  });
});

describe('télémétrie', () => {
  test('ouverture d’un invité : activite_invites arrive chez le chef, GET activite compte la session', async () => {
    const r = await reseau();
    await ouvrirChezB(r);
    r.b.federation.invites.emettreActivites();
    await attendre(() => r.a.federation.invites.activitePour(r.idG).activite?.sessionsAujourdhui === 1, 4000);
    const act = r.a.federation.invites.activitePour(r.idG);
    expect(act.telemetrie).toBe(true);
    expect(act.activite?.sessionsAujourdhui).toBeGreaterThanOrEqual(1);
  });

  test('télémétrie coupée : activité absente', async () => {
    const r = await reseau();
    const charte: Charte | null = r.a.federation.charte.charte();
    if (charte === null) throw new Error('charte absente');
    const coupee = { ...reglagesG([r.idB]), telemetrie: false };
    expect((await r.a.federation.charte.editer((c, moi, le) => changerInvite(c, moi, r.idG, coupee, le))).ok).toBe(
      true,
    );
    expect(r.a.federation.invites.activitePour(r.idG)).toEqual({ telemetrie: false, activite: null });
  });
});
