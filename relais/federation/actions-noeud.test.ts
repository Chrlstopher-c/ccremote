// Actions de chef sur une machine de nœud, sur deux nœuds reliés par l'aiguilleur réel : un non-chef est refusé, un
// chef agit (commandes factices), la pause refuse les sessions d'un pair comme la création locale, la reprise les
// rend ; la route des machines liste soi et le pair avec son état reçu ; un pair hors ligne répond 409.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { ReseauxConnus } from '../entretien/reseaux.ts';
import { Reveil } from '../entretien/reveil.ts';
import { routesMachinesReseau } from './api-machines-reseau.ts';
import { attendre, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';
import { PauseNoeud, refusCreationSession } from './pause-noeud.ts';

type Requete = Request & { params: Record<string, string> };
const sansProtection = (g: (req: Requete) => Response | Promise<Response>) => g;
const journal = pino({ enabled: false });
const NVIDIA_ABSENT = ['/chemin/inexistant/nvidia-smi-factice'];
const MAC_A = '02:00:00:00:00:0a';
const MAC_B = '02:00:00:00:00:0b';
const DIFFUSION = '192.0.2.255';

let monte: Monte;
let noeuds: Noeud[] = [];
let dossier: string;
let chefs: Set<string>;

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
  dossier = mkdtempSync(join(tmpdir(), 'actions-noeud-'));
  chefs = new Set();
  delete process.env['LANTERNE_MOTEUR_AUTONOME'];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
  delete process.env['LANTERNE_MOTEUR_AUTONOME'];
});

async function nouveau(nom: string, options: Parameters<typeof creerNoeud>[1] = {}): Promise<Noeud> {
  const n = creerNoeud(nom, { commandes: { nvidiaSmi: NVIDIA_ABSENT }, ...options });
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function enLignePour(vu: Noeud, cible: string): Promise<void> {
  await attendre(async () => (await vu.federation.etat()).membres.some((m) => m.id === cible && m.enLigne));
}

/** Appairage complet : `a` demande, `b` accepte (Chris chez b), le lien chiffré s'ouvre des deux côtés. */
async function appairer(a: Noeud, b: Noeud): Promise<{ idA: string; idB: string }> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await enLignePour(a, idB);
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  b.federation.decider(demande?.id ?? '', true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  return { idA, idB };
}

interface Duo {
  readonly a: Noeud;
  readonly b: Noeud;
  readonly idA: string;
  readonly idB: string;
  readonly reseaux: ReseauxConnus;
}

/** La tour (a) : chefs mutables du test, commandes factices, réveil banc (fichier, rien n’est envoyé). */
async function tourEtPortable(marque: string): Promise<Duo> {
  const reseaux = new ReseauxConnus(join(dossier, 'reveil.json'), journal);
  const reveil = new Reveil({
    wol: new Map(),
    diffusionWol: DIFFUSION,
    reseaux,
    envoyerPar: async () => {
      throw new Error('pas de poste délégué dans ce test');
    },
    factice: join(dossier, 'reveil-factice.json'),
    journal,
  });
  const a = await nouveau('tour', {
    estChef: (membre) => chefs.has(membre),
    commandes: { nvidiaSmi: NVIDIA_ABSENT, extinction: ['touch', marque], redemarrage: ['true'] },
    reseauLocal: () => ({ mac: MAC_A, diffusion: DIFFUSION }),
    reseaux,
    reveil,
    postesEnLigne: () => [],
  });
  const b = await nouveau('portable', { reseauLocal: () => ({ mac: MAC_B, diffusion: DIFFUSION }) });
  const { idA, idB } = await appairer(a, b);
  return { a, b, idA, idB, reseaux };
}

describe('actions de chef', () => {
  test('un non-chef est refusé : la pause n’est pas posée', async () => {
    const { a, b, idA } = await tourEtPortable(join(dossier, 'arret'));
    const r = await b.federation.agirSurMachine(idA, 'pause', 'local');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.statut).toBe(403);
    expect(a.federation.enPause()).toBe(false);
  });

  test('un chef agit : pause puis reprise ; pendant la pause, un pair ne peut pas ouvrir de session', async () => {
    const { a, b, idA, idB } = await tourEtPortable(join(dossier, 'arret'));
    chefs.add(idB);
    expect((await b.federation.agirSurMachine(idA, 'pause', 'local')).ok).toBe(true);
    expect(a.federation.enPause()).toBe(true);
    const refus = await b.federation.distantes.ouvrir(idA, 'tour', '/projets/x', 'un plan');
    expect(refus.ok).toBe(false);
    expect(a.appels.ouvrir).toEqual([]);
    expect(refusCreationSession(a.federation)?.status).toBe(409);
    expect((await b.federation.agirSurMachine(idA, 'reprendre', 'local')).ok).toBe(true);
    expect(a.federation.enPause()).toBe(false);
    expect(refusCreationSession(a.federation)).toBeNull();
    expect((await b.federation.distantes.ouvrir(idA, 'tour', '/projets/x', 'un plan')).ok).toBe(true);
    expect(a.appels.ouvrir).toEqual([{ chemin: '/projets/x', message: 'un plan' }]);
  });

  test('un chef arrête la machine : la commande factice est exécutée ; un non-chef, non', async () => {
    const marque = join(dossier, 'arret-marque');
    const { b, idA, idB } = await tourEtPortable(marque);
    expect((await b.federation.agirSurMachine(idA, 'arreter', 'local')).ok).toBe(false);
    expect(existsSync(marque)).toBe(false);
    chefs.add(idB);
    expect((await b.federation.agirSurMachine(idA, 'arreter', 'local')).ok).toBe(true);
    expect(existsSync(marque)).toBe(true);
  });

  test('redémarrage : refusé hors mode autonome, accepté en mode autonome (commande factice)', async () => {
    const { a, idA } = await tourEtPortable(join(dossier, 'arret'));
    const refus = await a.federation.agirSurMachine(idA, 'redemarrer', 'local');
    expect(refus.ok).toBe(false);
    process.env['LANTERNE_MOTEUR_AUTONOME'] = '1';
    expect((await a.federation.agirSurMachine(idA, 'redemarrer', 'local')).ok).toBe(true);
  });

  test('réveiller un pair : MAC apprise par son état, envoi au banc (fichier factice)', async () => {
    const { a, idB, reseaux } = await tourEtPortable(join(dossier, 'arret'));
    await attendre(() => reseaux.de('portable') !== null);
    expect((await a.federation.agirSurMachine(idB, 'reveiller', 'local')).ok).toBe(true);
    expect(existsSync(join(dossier, 'reveil-factice.json'))).toBe(true);
  });
});

describe('pause persistante', () => {
  test('le drapeau écrit est relu par un nœud neuf sur le même dossier', () => {
    const dossierPause = join(dossier, 'federation');
    const premier = new PauseNoeud(dossierPause, journal);
    expect(premier.mettreEnPause(true)).toBe(true);
    expect(new PauseNoeud(dossierPause, journal).enPause()).toBe(true);
    expect(premier.mettreEnPause(false)).toBe(true);
    expect(new PauseNoeud(dossierPause, journal).enPause()).toBe(false);
  });
});

describe('route des machines', () => {
  test('liste soi et le pair avec son état reçu ; action vers un pair hors ligne : 409', async () => {
    const { a, b, idA, idB, reseaux } = await tourEtPortable(join(dossier, 'arret'));
    const routes = routesMachinesReseau(a.federation, sansProtection);
    await attendre(async () => (await a.federation.machinesReseau()).some((m) => m.membre === idB && m.etat !== null));
    const reponse = await routes['/api/reseau/machines']?.GET?.(requeteGet('/api/reseau/machines'));
    const corps = (await reponse?.json()) as { machines: { membre: string; moi: boolean; etat: unknown }[] };
    expect(corps.machines.map((m) => [m.membre, m.moi])).toEqual([
      [idA, true],
      [idB, false],
    ]);
    expect(corps.machines[0]?.etat).not.toBeNull();
    expect(reseaux.de('portable')?.mac).toBe(MAC_B);

    b.federation.arreter();
    await attendre(async () => !(await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte), 6000);
    const hors = await routes['/api/reseau/machines/:membre/action']?.POST?.(
      requetePost(`/api/reseau/machines/${idB}/action`, { action: 'pause' }, { membre: idB }),
    );
    expect(hors?.status).toBe(409);
  });
});

function requeteGet(url: string): Requete {
  return Object.assign(new Request(`http://local${url}`), { params: {} });
}

function requetePost(url: string, corps: unknown, params: Record<string, string>): Requete {
  const r = new Request(`http://local${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return Object.assign(r, { params });
}
