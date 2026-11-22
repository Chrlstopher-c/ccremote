// Sessions des autres nœuds vues par l'appli : liste fusionnée, gestes relayés par les routes ordinaires, direct annoncé
// sur le flux des clients, copies SSH masquées. Deux nœuds sur un aiguilleur réel (127.0.0.1), données de test.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MessageClient } from '../../commun/api-clients.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  MAJ,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from './banc-federation.ts';

const SESSION_A = 'session-a';
let monte: Monte;
let noeuds: Noeud[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

async function nouveau(nom: string): Promise<Noeud> {
  const n = creerNoeud(nom);
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

function poser(n: Noeud, fiche: ReturnType<typeof ficheDe>): void {
  n.registre.enregistrerSession(fiche);
  n.diffusion.diffuser({ type: 'session', session: fiche });
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

async function appairer(a: Noeud, b: Noeud): Promise<string> {
  const idA = await idDe(a);
  const idB = await idDe(b);
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  b.federation.decider((await b.federation.etat()).demandes[0]?.id ?? '', true);
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
  return idA;
}

/** A tient « tour » et sa session ; B la voit. */
async function paire(): Promise<{ a: Noeud; b: Noeud; idA: string }> {
  const a = await nouveau('tour');
  const b = await nouveau('portable');
  const idA = await appairer(a, b);
  poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
  await attendre(() => b.federation.distantes.estDistante(SESSION_A));
  return { a, b, idA };
}

function requete(chemin: string, methode = 'GET', corps?: unknown): Request {
  const init: RequestInit = { method: methode };
  if (corps !== undefined) init.body = JSON.stringify(corps);
  return new Request(`http://local${chemin}`, init);
}

describe('vue de l’appli', () => {
  test('la session de A et sa machine sont dans la vue de B, routées vers A', async () => {
    const { b, idA } = await paire();
    const v = b.federation.distantes.vue(b.registre.sessions(false), []);
    expect(v.sessions.map((s) => s.id)).toContain(SESSION_A);
    expect(v.routage.get(SESSION_A)).toBe(idA);
    const tour = v.machines.find((m) => m.id === 'tour');
    expect(tour?.enLigne).toBe(true);
    expect(tour?.acces?.etat).toBe('connecte');
  });

  test('une copie SSH de la machine tenue par A est masquée chez B, et ne passe pas sur le flux', async () => {
    const { b } = await paire();
    const copie = ficheDe('copie-ssh', 'tour', 'Copie');
    b.registre.enregistrerSession(copie);
    const v = b.federation.distantes.vue(b.registre.sessions(false), []);
    expect(v.sessions.map((s) => s.id)).not.toContain('copie-ssh');
    expect(b.federation.distantes.laisserPasser({ type: 'session', session: copie })).toBe(false);
  });

  test('les changements de A arrivent sur le flux des clients de B', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const recus: MessageClient[] = [];
    b.diffusion.ecouter((m) => recus.push(m));
    await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    await attendre(() => recus.some((m) => m.type === 'session' && m.session.id === SESSION_A));
    expect(recus.some((m) => m.type === 'machine' && m.machine.id === 'tour')).toBe(true);
  });
});

describe('copies périmées d’une machine tenue par un nœud', () => {
  test('la vue de B montre la version fédérée (statut, majLe), jamais la copie locale ; le fil part vers A', async () => {
    const { a, b } = await paire();
    const perimee = { ...ficheDe(SESSION_A, 'tour', 'Titre A'), statut: 'fermee', majLe: '2026-11-22T10:00:00.000Z' };
    b.registre.enregistrerSession(perimee as ReturnType<typeof ficheDe>);
    b.registre.enregistrerSession(ficheDe('locale-disparue', 'tour', 'Disparue'));
    poser(a, { ...ficheDe(SESSION_A, 'tour', 'Titre A'), statut: 'travail', majLe: '2026-11-22T14:00:00.000Z' } as ReturnType<typeof ficheDe>);
    await attendre(() => b.federation.distantes.sessions().some((x) => x.session.statut === 'travail'));
    const v = b.federation.distantes.vue(b.registre.sessions(true), []);
    const vue = v.sessions.find((s) => s.id === SESSION_A);
    expect(vue?.statut).toBe('travail');
    expect(vue?.majLe).toBe('2026-11-22T14:00:00.000Z');
    expect(v.sessions.filter((s) => s.id === SESSION_A)).toHaveLength(1);
    expect(v.sessions.map((s) => s.id)).not.toContain('locale-disparue');
    await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/evenements`));
    expect(a.appels.gestes.some((g) => g.geste === 'evenements' && g.session === SESSION_A)).toBe(true);
  });
});

/** Un client du flux (WebSocket) qui consigne ce qu'il reçoit ; le filtre est celui de bin.ts. */
function clientDuFlux(b: Noeud): string[] {
  const textes: string[] = [];
  b.diffusion.filtre = (m) => b.federation.distantes.laisserPasser(m);
  const ws = { send: (texte: string) => textes.push(texte) } as unknown as Parameters<typeof b.diffusion.ajouter>[0];
  b.diffusion.ajouter(ws);
  return textes;
}

describe('bascule : les copies existent avant que le nœud ne soit en ligne', () => {
  test('A garde ses copies, le nœud se relie : la vue et le flux montrent la version du nœud', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const textes = clientDuFlux(b);
    b.registre.enregistrerSession({ ...ficheDe(SESSION_A, 'tour', 'Ancienne'), statut: 'fermee' } as ReturnType<typeof ficheDe>);
    b.registre.enregistrerSession(ficheDe('locale-disparue', 'tour', 'Disparue'));
    const idA = await appairer(a, b);
    poser(a, { ...ficheDe(SESSION_A, 'tour', 'Titre A'), statut: 'travail', majLe: '2026-11-22T14:00:00.000Z' } as ReturnType<typeof ficheDe>);
    await attendre(() => b.federation.distantes.sessions().some((x) => x.session.statut === 'travail'));
    const v = b.federation.distantes.vue(b.registre.sessions(true), []);
    expect(v.sessions.find((s) => s.id === SESSION_A)?.statut).toBe('travail');
    expect(v.sessions.map((s) => s.id)).not.toContain('locale-disparue');
    expect(v.routage.get(SESSION_A)).toBe(idA);
    expect(textes.some((t) => t.includes('"statut":"fermee"'))).toBe(false);
  });
});

describe('flux : copies périmées refusées, version fédérée et direct relayés', () => {
  test('la copie locale d’une session tenue par A ne part pas au client ; la version fédérée oui', async () => {
    const { a, b } = await paire();
    const textes = clientDuFlux(b);
    const perimee = { ...ficheDe(SESSION_A, 'tour', 'Titre A'), statut: 'fermee', majLe: '2026-11-22T10:00:00.000Z' };
    b.registre.enregistrerSession(perimee as ReturnType<typeof ficheDe>);
    b.diffusion.diffuser({ type: 'session', session: perimee as ReturnType<typeof ficheDe> });
    expect(textes.some((t) => t.includes('"statut":"fermee"'))).toBe(false);
    poser(a, { ...ficheDe(SESSION_A, 'tour', 'Titre A'), statut: 'travail', majLe: '2026-11-22T14:00:00.000Z' } as ReturnType<typeof ficheDe>);
    await attendre(() => textes.some((t) => t.includes('"statut":"travail"') && t.includes('2026-11-22T14:00:00.000Z')));
    expect(textes.some((t) => t.includes('"statut":"fermee"'))).toBe(false);
  });

  test('un événement local d’une session tenue par A ne part pas au client ; le direct de A, si', async () => {
    const { a, b } = await paire();
    const textes = clientDuFlux(b);
    const copie = { seq: 1, sessionId: SESSION_A, ts: MAJ, evt: { type: 'message', texte: 'copie locale' } };
    b.diffusion.diffuser({ type: 'evenement', evenement: copie } as MessageClient);
    expect(textes.some((t) => t.includes('copie locale'))).toBe(false);
    await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/evenements?attendre=25`));
    const e = a.registre.ajouterEvenement(SESSION_A, MAJ, { type: 'message', texte: 'en direct' });
    a.diffusion.diffuser({ type: 'evenement', evenement: e });
    await attendre(() => textes.some((t) => t.includes('en direct')));
  });
});

describe('gestes relayés', () => {
  test('le modèle, les permissions et les réponses passent par la route du nœud qui tient la session', async () => {
    const { a, b } = await paire();
    for (const geste of ['modele', 'mode', 'repondre', 'messages', 'interrompre']) {
      const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/${geste}`, 'POST', {}));
      expect(r?.status).toBe(200);
    }
    expect(a.appels.gestes.map((g) => g.geste)).toEqual(['modele', 'mode', 'repondre', 'messages', 'interrompre']);
    expect(a.appels.gestes[0]?.corps).toBe('{}');
  });

  test('un geste hors liste est refusé sans rien envoyer ; une session locale n’est pas interceptée', async () => {
    const { a, b } = await paire();
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/supprimer`, 'POST', {}));
    expect(r?.status).toBe(409);
    expect(a.appels.gestes).toEqual([]);
    expect(await b.federation.distantes.intercepter(requete('/api/sessions/locale/messages', 'POST', {}))).toBeNull();
  });

  test('ouvrir une session sur la machine de A depuis B', async () => {
    const { a, b } = await paire();
    const r = await b.federation.distantes.intercepter(
      requete('/api/sessions', 'POST', { machine: 'tour', projet: { machine: 'tour', chemin: '/p', nom: 'p' } }),
    );
    expect(r?.status).toBe(201);
    expect(((await r?.json()) as { id: string }).id).toBe('ouverte-par-geste'); // réponse de la route d’ouverture
    expect(a.appels.gestes[0]?.geste).toBe('ouvrir');
    // Routée tout de suite : l'appli règle l'effort de la session neuve dès la réponse.
    expect(b.federation.distantes.estDistante('ouverte-par-geste')).toBe(true);
    const locale = await b.federation.distantes.intercepter(requete('/api/sessions', 'POST', { machine: 'portable' }));
    expect(locale).toBeNull();
  });

  test('lire le fil abonne au direct : les événements de A arrivent chez B avec leur numéro', async () => {
    const { a, b } = await paire();
    const recus: MessageClient[] = [];
    b.diffusion.ecouter((m) => recus.push(m));
    await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/evenements?attendre=25`));
    expect(a.appels.gestes[0]?.requete).toBeUndefined();
    const e = a.registre.ajouterEvenement(SESSION_A, MAJ, { type: 'message', texte: 'en direct' });
    a.diffusion.diffuser({ type: 'evenement', evenement: e });
    await attendre(() => recus.some((m) => m.type === 'evenement' && m.evenement.sessionId === SESSION_A));
    const recu = recus.find((m) => m.type === 'evenement');
    expect(recu?.type === 'evenement' && recu.evenement.seq).toBe(e.seq);
  });

  test('A hors ligne : un geste rend 409 et la machine passe hors ligne', async () => {
    const { a, b } = await paire();
    a.federation.arreter();
    await attendre(() => b.federation.distantes.sessions()[0]?.enLigne === false, 6000);
    const r = await b.federation.distantes.intercepter(requete(`/api/sessions/${SESSION_A}/messages`, 'POST', {}));
    expect(r?.status).toBe(409);
    const v = b.federation.distantes.vue([], []);
    expect(v.machines.find((m) => m.id === 'tour')?.enLigne).toBe(false);
  });
});

describe('appairage vu de l’ouvrant', () => {
  test('l’ouvrant voit le nom et l’empreinte du nœud visé, identiques à celles qu’affiche sa demande', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    const idB = await idDe(b);
    await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
    a.federation.appairer(idB);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    await attendre(async () => (await a.federation.etat()).appairages[0]?.empreinte != null);
    const enCours = (await a.federation.etat()).appairages[0];
    const demande = (await b.federation.etat()).demandes[0];
    expect(enCours?.nom).toBe('portable');
    expect(enCours?.empreinte).toBe(demande?.empreinteLocale);
    expect((await a.federation.etat()).empreinteLocale).toBe(demande?.empreinte ?? 'absente');
  });
});

describe('machine annoncée', () => {
  test('ses projets passent ; « Cet ordinateur » devient le nom du nœud chez le pair', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    a.registre.enregistrerMachine({
      id: 'tour',
      description: 'Cet ordinateur',
      racines: ['/projets'],
      projets: [{ machine: 'tour', chemin: '/projets/x', nom: 'x' }],
      comptes: ['defaut'],
      version: '1',
      derniereVue: MAJ,
    });
    await appairer(a, b);
    poser(a, ficheDe(SESSION_A, 'tour', 'Titre A'));
    await attendre(() => b.federation.distantes.estDistante(SESSION_A));
    const tour = b.federation.distantes.vue([], []).machines.find((m) => m.id === 'tour');
    expect(tour?.description).toBe('tour');
    expect(tour?.projets).toEqual([{ machine: 'tour', chemin: '/projets/x', nom: 'x' }]);
  });
});

describe('instantané au-delà de 150 sessions', () => {
  test('A tient 240 sessions : B les voit toutes, la tête et les pages réunies', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    for (let i = 0; i < 240; i += 1) a.registre.enregistrerSession(ficheDe(`t-${i}`, 'tour', `Titre ${i}`));
    await appairer(a, b);
    await attendre(() => b.federation.distantes.sessions().length === 240, 8000);
    const ids = new Set(b.federation.distantes.sessions().map((s) => s.session.id));
    expect(ids.size).toBe(240);
    expect(ids.has('t-0') && ids.has('t-239')).toBe(true);
  });
});

describe('copie archivée ici et version vivante chez le nœud', () => {
  test('la copie archivée ne passe pas sur le flux : la version vivante de A la remplace', async () => {
    const { b } = await paire();
    const archivee = { ...ficheDe(SESSION_A, 'tour', 'Copie rangée'), archivee: true };
    b.registre.enregistrerSession(archivee);
    const v = b.federation.distantes.vue(b.registre.sessions(true), []);
    expect(v.routage.get(SESSION_A)).toBeDefined();
    expect(b.federation.distantes.laisserPasser({ type: 'session', session: archivee })).toBe(false);
  });
});
