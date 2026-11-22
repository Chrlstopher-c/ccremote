// Responsabilité : synchronisations sur demande entre deux nœuds fédérés (aiguilleur réel sur 127.0.0.1) —
// demande, accord, refus, expiration, périmètre, paquets forcés ou hors périmètre, journal, routes. Données de test.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessageSynchro, PaquetSynchro } from '../../commun/synchro.ts';
import {
  attendre,
  creerNoeud,
  ficheDe,
  MAJ,
  monterAiguilleur,
  type Monte,
  type Noeud,
  relier,
} from '../federation/banc-federation.ts';
import { routesSynchro, type Gestionnaire } from './api-synchro.ts';
import { JournalSynchro } from './journal.ts';
import { ServiceSynchro } from './service.ts';

const silencieux = pino({ enabled: false });
const DELAI_TEST_MS = 400;
const SANS_JETON = (g: Gestionnaire): Gestionnaire => g;

interface Pose {
  readonly noeud: Noeud;
  readonly service: ServiceSynchro;
  readonly fichier: string;
  readonly id: string;
  readonly envoyes: string[];
}

let monte: Monte;
let noeuds: Noeud[] = [];
let services: ServiceSynchro[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
  services = [];
});

afterEach(() => {
  for (const s of services) s.arreter();
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

async function nouveau(nom: string): Promise<Noeud> {
  const n = creerNoeud(nom);
  noeuds.push(n);
  await relier(n, monte, 'alice');
  return n;
}

async function idDe(n: Noeud): Promise<string> {
  const id = (await n.federation.etat()).aiguilleur?.id;
  if (!id) throw new Error('nœud non relié');
  return id;
}

/** Appairage complet : A demande, B accepte, le lien chiffré s'ouvre des deux côtés. */
async function appairer(a: Noeud, b: Noeud): Promise<void> {
  const idB = await idDe(b);
  const idA = await idDe(a);
  await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));
  expect(a.federation.appairer(idB).ok).toBe(true);
  await attendre(async () => (await b.federation.etat()).demandes.length === 1);
  const demande = (await b.federation.etat()).demandes[0];
  expect(b.federation.decider(demande?.id ?? '', true).ok).toBe(true);
  await attendre(async () => (await a.federation.etat()).noeuds.some((n) => n.id === idB && n.liaisonOuverte));
  await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.id === idA && n.liaisonOuverte));
}

/** Branche le service de synchro d'un nœud ; enregistre les messages qu'il envoie (pour prouver l'absence d'envoi). */
function poser(n: Noeud, id: string, delaiMs = DELAI_TEST_MS): Pose {
  const dossier = mkdtempSync(join(tmpdir(), `synchro-${n.nom}-`));
  const fichier = join(dossier, 'synchro-journal.json');
  const envoyes: string[] = [];
  const service = new ServiceSynchro({
    registre: n.registre,
    diffusion: n.diffusion,
    lien: {
      identifiant: () => n.federation.identifiantLocal(),
      envoyer: (membre: string, message: MessageSynchro) => {
        envoyes.push(message.t);
        return n.federation.envoyerSynchro(membre, message);
      },
    },
    journal: new JournalSynchro(fichier, silencieux),
    logger: silencieux,
    delaiMs,
  });
  n.federation.brancherSynchro((membre, brut) => service.recevoir(membre, brut));
  services.push(service);
  return { noeud: n, service, fichier, id, envoyes };
}

/** Deux nœuds appairés. A (source) : favoris, catégorie, groupe masqué. B : une catégorie et une session à lui. */
async function duo(delaiMs?: number): Promise<{ a: Pose; b: Pose }> {
  const na = await nouveau('a');
  const nb = await nouveau('b');
  await appairer(na, nb);
  const a = poser(na, await idDe(na), delaiMs);
  const b = poser(nb, await idDe(nb), delaiMs);
  na.registre.enregistrerSession(ficheDe('s1', 'a', 'un'));
  na.registre.enregistrerSession(ficheDe('s2', 'a', 'deux'));
  na.registre.enregistrerSession(ficheDe('s3', 'a', 'trois'));
  na.registre.definirEpinglee('s1', true);
  na.registre.definirEpinglee('s3', true);
  na.registre.enregistrerCategories([{ id: 'c1', nom: 'Projets', replie: false, sessions: ['s1', 's2'] }]);
  na.registre.enregistrerGroupesMasques([
    { cle: 'categorie:c1', libelle: 'Projets', genre: 'categorie', machine: null, dossier: null, masqueLe: MAJ },
  ]);
  nb.registre.enregistrerSession(ficheDe('s1', 'b', 'un'));
  nb.registre.enregistrerSession(ficheDe('s9', 'b', 'neuf'));
  nb.registre.definirEpinglee('s9', true);
  nb.registre.enregistrerCategories([{ id: 'c9', nom: 'Local', replie: true, sessions: ['s9'] }]);
  return { a, b };
}

async function demandeRecue(a: Pose): Promise<string> {
  await attendre(() => a.service.lister().recues.length > 0);
  return a.service.lister().recues[0]?.id ?? '';
}

async function etatEnvoyee(b: Pose, etat: string): Promise<void> {
  await attendre(() => b.service.lister().envoyees[0]?.etat === etat);
}

describe('demande, accord, fusion', () => {
  test('les favoris demandés sont appliqués en fusion, sans toucher au reste', async () => {
    const { a, b } = await duo();
    const r = b.service.demander(a.id, ['favoris']);
    expect(r.ok).toBe(true);
    expect(a.service.decider(await demandeRecue(a), true)).toBe(true);
    await etatEnvoyee(b, 'appliquee');
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(true);
    expect(b.noeud.registre.session('s9')?.epinglee).toBe(true);
    expect(b.noeud.registre.categories().map((c) => c.id)).toEqual(['c9']);
  });

  test('favoris reçus : une jumelle épinglée passe à la fiche de poste de sa conversation', async () => {
    const { a, b } = await duo();
    const distant = {
      compte: 'principal',
      idDistant: 'cse_b',
      connexion: 'connectee' as const,
      probleme: null,
      conversation: 'conv-9',
    };
    const jumelle = { ...ficheDe('cse_b', 'a', 'jumelle'), id: 'cse_b', distant };
    a.noeud.registre.enregistrerSession(jumelle);
    a.noeud.registre.definirEpinglee('cse_b', true);
    b.noeud.registre.enregistrerSession({ ...ficheDe('cse_b', 'b', 'jumelle'), id: 'cse_b', distant });
    b.noeud.registre.enregistrerSession({
      ...ficheDe('sb', 'b', 'poste'),
      terminal: true,
      claudeSessionId: 'conv-9',
    });
    b.service.demander(a.id, ['favoris']);
    a.service.decider(await demandeRecue(a), true);
    await etatEnvoyee(b, 'appliquee');
    expect(b.noeud.registre.session('sb')?.epinglee).toBe(true);
    expect(b.noeud.registre.session('cse_b')?.epinglee).toBe(false);
    expect(b.noeud.registre.sessions(false).map((s) => s.id)).not.toContain('cse_b');
  });

  test('le périmètre est respecté : rien d autre ne bouge si seuls les favoris sont demandés', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    a.service.decider(await demandeRecue(a), true);
    await etatEnvoyee(b, 'appliquee');
    expect(b.noeud.registre.groupesMasques()).toEqual([]);
    expect(b.noeud.registre.categories().map((c) => c.id)).toEqual(['c9']);
  });

  test('catégories et groupes masqués : fusion, les inconnus sont ignorés et comptés', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['categories', 'masquees']);
    a.service.decider(await demandeRecue(a), true);
    await etatEnvoyee(b, 'appliquee');
    const c1 = b.noeud.registre.categories().find((c) => c.id === 'c1');
    expect(c1?.sessions).toEqual(['s1']);
    expect(b.noeud.registre.categories().find((c) => c.id === 'c9')?.sessions).toEqual(['s9']);
    expect(b.noeud.registre.groupesMasques().map((g) => g.cle)).toEqual(['categorie:c1']);
  });

  test('le journal des deux côtés garde qui a demandé quoi, la décision et ce qui a été appliqué', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    a.service.decider(await demandeRecue(a), true);
    await etatEnvoyee(b, 'appliquee');
    const jb = b.service.journal();
    expect(jb.map((e) => e.sens)).toEqual(['demandee', 'accordee', 'appliquee']);
    expect(jb[2]?.bilan).toEqual({ appliques: 1, dejaPresents: 0, ignores: 1 });
    expect(a.service.journal().map((e) => e.sens)).toEqual(['recue', 'accordee', 'envoyee']);
    expect(a.service.journal()[0]?.quoi).toEqual(['favoris']);
  });

  test('le journal survit au redémarrage du service', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    a.service.decider(await demandeRecue(a), true);
    await etatEnvoyee(b, 'appliquee');
    const relu = new JournalSynchro(b.fichier, silencieux).lister();
    expect(relu.map((e) => e.sens)).toEqual(['demandee', 'accordee', 'appliquee']);
  });
});

describe('refus et expiration : rien ne part', () => {
  test('un refus ne transfère rien et se journalise des deux côtés', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris', 'categories']);
    a.service.decider(await demandeRecue(a), false);
    await etatEnvoyee(b, 'refusee');
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(false);
    expect(b.noeud.registre.categories().map((c) => c.id)).toEqual(['c9']);
    expect(a.service.journal().map((e) => e.sens)).toEqual(['recue', 'refusee']);
    expect(a.envoyes).toEqual(['decision']);
  });

  test('sans décision, la demande expire des deux côtés et rien n est envoyé', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    await etatEnvoyee(b, 'expiree');
    await attendre(() => a.service.journal().some((e) => e.sens === 'expiree'));
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(false);
    expect(a.envoyes).toEqual(['decision']);
    expect(a.service.decider(a.service.lister().recues[0]?.id ?? '', true)).toBe(false);
  });
});

describe('rien ne s applique sans accord', () => {
  test('un paquet reçu sans accord est refusé, et une demande forcée côté source aussi', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    const idDemande = await demandeRecue(a);
    const paquet: PaquetSynchro = { t: 'paquet', id: idDemande, favoris: ['s1'] };
    b.service.recevoir(a.id, paquet);
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(false);
    a.service.recevoir(b.id, paquet);
    expect(a.envoyes).toEqual([]);
    const usurpee = {
      t: 'demande',
      id: 'x1',
      genre: 'synchro',
      quoi: ['favoris'],
      de: 'cccccccccccc',
      vers: a.id,
      le: MAJ,
    };
    a.service.recevoir(b.id, usurpee);
    expect(a.service.lister().recues.map((d) => d.id)).toEqual([idDemande]);
    expect(b.service.journal().some((e) => e.sens === 'rejetee')).toBe(true);
    a.service.decider(idDemande, false);
  });

  test('une décision d accord ne suffit pas : un paquet hors périmètre ou malformé est refusé', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    const id = await demandeRecue(a);
    b.service.recevoir(a.id, { t: 'decision', id, accord: true });
    b.service.recevoir(a.id, { t: 'paquet', id, favoris: 'pas une liste' });
    b.service.recevoir(a.id, { t: 'paquet', id, favoris: ['s1'], masquees: [] });
    b.service.recevoir(a.id, { t: 'paquet', id, favoris: ['s1'], categories: [] });
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(false);
    expect(b.service.journal().filter((e) => e.sens === 'rejetee').length).toBe(3);
    expect(b.service.lister().envoyees[0]?.etat).toBe('accordee');
  });

  test('un paquet trop gros est refusé à la réception', async () => {
    const { a, b } = await duo();
    b.service.demander(a.id, ['favoris']);
    const id = await demandeRecue(a);
    b.service.recevoir(a.id, { t: 'decision', id, accord: true });
    const ids = Array.from({ length: 1500 }, (_, i) => `session-${i}-${'x'.repeat(150)}`);
    b.service.recevoir(a.id, { t: 'paquet', id, favoris: ids });
    expect(b.noeud.registre.session('s1')?.epinglee).toBe(false);
    expect(b.service.journal().at(-1)?.detail).toBe('paquet trop grand');
  });
});

describe('demande hors ligne et routes', () => {
  test('une demande vers un nœud non apparié est refusée (409) et ne se journalise pas', async () => {
    const { b } = await duo();
    const r = b.service.demander('000000000000', ['favoris']);
    expect(r.ok).toBe(false);
    expect(b.service.lister().envoyees).toEqual([]);
  });

  test('les routes demandent, listent, décident et rendent le journal', async () => {
    const { a, b } = await duo();
    const routes = routesSynchro(b.service, SANS_JETON);
    const demander = routes['/api/synchro/demandes']?.POST;
    if (!demander) throw new Error('route absente');
    const r = await demander(requete({ vers: a.id, quoi: ['favoris'] }));
    expect(r.status).toBe(201);
    expect((await demander(requete({ vers: a.id, quoi: ['favoris', 'favoris'] }))).status).toBe(400);
    expect((await demander(requete({ vers: 'NON', quoi: ['favoris'] }))).status).toBe(400);
    const lister = routes['/api/synchro/demandes']?.GET;
    const liste = await lister?.(requete());
    expect(liste?.status).toBe(200);
    const journal = routes['/api/synchro/journal']?.GET;
    expect((await journal?.(requete()))?.status).toBe(200);
    const id = await demandeRecue(a);
    const decider = routesSynchro(a.service, SANS_JETON)['/api/synchro/demandes/:id']?.POST;
    expect((await decider?.(requete({ accord: true }, { id })))?.status).toBe(200);
    expect((await decider?.(requete({ accord: true }, { id: 'inconnu' })))?.status).toBe(404);
    expect((await decider?.(requete({ accord: 'oui' }, { id })))?.status).toBe(400);
    await etatEnvoyee(b, 'appliquee');
  });
});

function requete(corps?: unknown, params: Record<string, string> = {}): Request & { params: Record<string, string> } {
  const init: RequestInit = { method: corps === undefined ? 'GET' : 'POST' };
  if (corps !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(corps);
  }
  return Object.assign(new Request('http://127.0.0.1/api/synchro', init), { params });
}
