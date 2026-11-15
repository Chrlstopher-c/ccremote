// Responsabilité : tests de la salle de réunion côté HQ — la démo simule deux agents, le client parle au relais.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { ClientReunions, creerReunionsDemo, type ReponseReunion } from './reunion';
import { ErreurRelais, type Recuperer } from './transport-http';

describe('démo de la salle', () => {
  test('une demande auto reçoit deux réponses simulées, dans l ordre de la réunion', async () => {
    const api = creerReunionsDemo(() => new Date('2026-11-15T10:00:00.000Z'));
    const r = await api.envoyer({ texte: 'Bonjour à tous', destinataires: 'auto' });
    expect(r.envois.map((e) => e.ok)).toEqual([true, true]);
    expect(r.reunion.messages.map((m) => m.auteur)).toEqual(['chris', 'demo-atlas', 'demo-boreal']);
    expect(r.reunion.participants).toEqual(['demo-atlas', 'demo-boreal']);
    expect(r.reunion.sujet).toBe('Bonjour à tous');
  });

  test('une demande à une seule session ne fait répondre que celle-ci', async () => {
    const api = creerReunionsDemo();
    const r = await api.envoyer({ texte: 'Toi seul', destinataires: ['demo-boreal'] });
    expect(r.reunion.messages.map((m) => m.auteur)).toEqual(['chris', 'demo-boreal']);
  });

  test('une session inconnue est signalée, sans réponse simulée', async () => {
    const api = creerReunionsDemo();
    const r = await api.envoyer({ texte: 'Allô', destinataires: ['fantome'] });
    expect(r.envois).toEqual([{ sessionId: 'fantome', ok: false, erreur: 'session inconnue' }]);
    expect(r.reunion.messages.length).toBe(1);
  });

  test('une demande poursuit la réunion ; une réunion inconnue lève ErreurRelais 404', async () => {
    const api = creerReunionsDemo();
    const premiere = await api.envoyer({ texte: 'Un', destinataires: ['demo-atlas'] });
    const suite = await api.envoyer({
      texte: 'Deux',
      destinataires: ['demo-atlas'],
      reunionId: premiere.reunion.id,
    });
    expect(suite.reunion.messages.length).toBe(4);
    expect((await api.lister()).length).toBe(1);
    expect(await api.ouvrir(premiere.reunion.id)).toEqual(suite.reunion);
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
