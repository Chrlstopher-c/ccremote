// Responsabilité : tests de la salle de réunion côté HQ — la démo répond avec les vraies sessions, le client au relais.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ResumeSession, StatutSession } from './contrat';
import { ClientReunions, creerReunionsDemo, type ReponseReunion } from './reunion';
import { ErreurRelais, type Recuperer } from './transport-http';

const T0 = '2026-11-15T10:00:00.000Z';

function session(id: string, nom: string, titre: string, statut: StatutSession, archivee = false): ResumeSession {
  return {
    id,
    machine: 'poste-a',
    projet: { machine: 'poste-a', chemin: `/demo/${nom}`, nom },
    cwd: `/demo/${nom}`,
    titre,
    objectif: null,
    modele: 'opus',
    compte: 'demo',
    autonomie: false,
    statut,
    contexte: { tokens: 0, max: 200_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: T0,
    majLe: T0,
    archivee,
  };
}

const SESSIONS: readonly ResumeSession[] = [
  session('s-agent', 'agent-hq', 'Moteur SDK', 'travail'),
  session('s-stock', 'stockiop', 'Migration des stocks', 'attente'),
  session('s-vieux', 'vieux-projet', 'Archive', 'attente', true),
  session('s-ferme', 'fermee-projet', 'Fermée', 'fermee'),
];

function horloge(): { now: () => Date; avance: (ms: number) => void } {
  let courant = new Date(T0).getTime();
  return { now: () => new Date(courant), avance: (ms) => (courant += ms) };
}

describe('démo de la salle', () => {
  test('auto : seules les sessions citées (par projet ou titre) répondent, non archivées, non fermées', async () => {
    const api = creerReunionsDemo(horloge().now, () => SESSIONS);
    const r = await api.envoyer({ texte: 'Point sur stockiop', destinataires: 'auto' });
    expect(r.envois).toEqual([{ sessionId: 's-stock', ok: true }]);
    expect(r.reunion.participants).toEqual(['s-stock']);
  });

  test('auto sans citation : toutes les sessions actives répondent, les archivées et fermées non', async () => {
    const h = horloge();
    const api = creerReunionsDemo(h.now, () => SESSIONS);
    const r = await api.envoyer({ texte: 'Bonjour à tous', destinataires: 'auto' });
    expect(r.envois.map((e) => e.sessionId)).toEqual(['s-agent', 's-stock']);
    h.avance(60_000);
    const reunion = await api.ouvrir(r.reunion.id);
    expect(reunion.messages.map((m) => m.auteur)).toEqual(['chris', 's-agent', 's-stock']);
  });

  test('chaque réponse commence par le projet de sa session', async () => {
    const h = horloge();
    const api = creerReunionsDemo(h.now, () => SESSIONS);
    const r = await api.envoyer({ texte: 'Bonjour', destinataires: ['s-stock'] });
    h.avance(60_000);
    const reunion = await api.ouvrir(r.reunion.id);
    expect(reunion.messages[1]?.texte.startsWith('stockiop : ')).toBe(true);
  });

  test('les réponses arrivent après un délai simulé, pas à l envoi', async () => {
    const h = horloge();
    const api = creerReunionsDemo(h.now, () => SESSIONS);
    const r = await api.envoyer({ texte: 'Allô', destinataires: ['s-agent', 's-stock'] });
    expect(r.reunion.messages.map((m) => m.auteur)).toEqual(['chris']);
    h.avance(1_500);
    expect((await api.ouvrir(r.reunion.id)).messages.map((m) => m.auteur)).toEqual(['chris', 's-agent']);
    h.avance(10_000);
    expect((await api.ouvrir(r.reunion.id)).messages.map((m) => m.auteur)).toEqual(['chris', 's-agent', 's-stock']);
  });

  test('une session choisie inconnue est signalée, sans réponse simulée', async () => {
    const api = creerReunionsDemo(horloge().now, () => SESSIONS);
    const r = await api.envoyer({ texte: 'Allô', destinataires: ['fantome'] });
    expect(r.envois).toEqual([{ sessionId: 'fantome', ok: false, erreur: 'session inconnue' }]);
    expect(r.reunion.messages.length).toBe(1);
  });

  test('sans fournisseur, la démo prend les sessions du scénario de démo', async () => {
    const h = horloge();
    const api = creerReunionsDemo(h.now);
    const r = await api.envoyer({ texte: 'Toi', destinataires: ['demo-1', 'demo-atlas'] });
    expect(r.envois).toEqual([
      { sessionId: 'demo-1', ok: true },
      { sessionId: 'demo-atlas', ok: false, erreur: 'session inconnue' },
    ]);
  });

  test('une demande poursuit la réunion ; une réunion inconnue lève ErreurRelais 404', async () => {
    const h = horloge();
    const api = creerReunionsDemo(h.now, () => SESSIONS);
    const premiere = await api.envoyer({ texte: 'Un', destinataires: ['s-stock'] });
    const suite = await api.envoyer({ texte: 'Deux', destinataires: ['s-stock'], reunionId: premiere.reunion.id });
    h.avance(10_000);
    expect((await api.ouvrir(premiere.reunion.id)).messages.length).toBe(4);
    expect((await api.lister()).length).toBe(1);
    expect(suite.reunion.id).toBe(premiere.reunion.id);
    const absente = api.ouvrir('absente');
    await expect(absente).rejects.toBeInstanceOf(ErreurRelais);
    await expect(absente).rejects.toMatchObject({ statut: 404 });
  });
});

interface Appel {
  readonly url: string;
  readonly init: RequestInit;
}

function relaisFactice(reponse: () => Response): { recuperer: Recuperer; appels: Appel[] } {
  const appels: Appel[] = [];
  const recuperer: Recuperer = (url, init) => {
    appels.push({ url, init });
    return Promise.resolve(reponse());
  };
  return { recuperer, appels };
}

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
}

describe('client du relais', () => {
  test('envoyer poste la demande au relais avec le jeton porteur, sans jeton dans l URL', async () => {
    const reponse: ReponseReunion = {
      reunion: { id: 'r1', sujet: 's', creeLe: 'now', participants: [], messages: [] },
      envois: [],
    };
    const relais = relaisFactice(() => json(reponse, 201));
    const client = new ClientReunions('https://relais.test/', 'jeton-secret', relais.recuperer);
    const obtenue = await client.envoyer({ texte: 'Bonjour', destinataires: 'auto' });
    expect(obtenue).toEqual(reponse);
    const [appel] = relais.appels;
    expect(appel?.url).toBe('https://relais.test/api/reunions');
    expect(appel?.init.method).toBe('POST');
    expect(new Headers(appel?.init.headers).get('authorization')).toBe('Bearer jeton-secret');
    expect(JSON.parse(String(appel?.init.body))).toEqual({ texte: 'Bonjour', destinataires: 'auto' });
  });

  test('ouvrir encode l identifiant ; une erreur du relais remonte avec son message et son statut', async () => {
    const relais = relaisFactice(() => json({ erreur: 'limite de 20 demandes atteinte' }, 429));
    const client = new ClientReunions('https://relais.test', 'j', relais.recuperer);
    const erreur = await client.ouvrir('a b').catch((e: unknown) => e);
    expect(relais.appels[0]?.url).toBe('https://relais.test/api/reunions/a%20b');
    expect(erreur).toBeInstanceOf(ErreurRelais);
    expect(erreur).toMatchObject({ statut: 429, message: 'limite de 20 demandes atteinte' });
  });

  test('relais injoignable : ErreurRelais de statut 0', async () => {
    const recuperer: Recuperer = () => Promise.reject(new Error('réseau coupé'));
    const client = new ClientReunions('https://relais.test', 'j', recuperer);
    await expect(client.lister()).rejects.toMatchObject({ statut: 0, message: 'relais injoignable' });
  });
});
