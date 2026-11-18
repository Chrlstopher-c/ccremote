import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function requete(id: string, action: string, corps: unknown): Request & { params: { id: string } } {
  return Object.assign(
    new Request(`http://relais.test/api/sessions/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify(corps),
      headers: { 'content-type': 'application/json' },
    }),
    { params: { id } },
  );
}

function fil(r: Registre): void {
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'premier', uuid: 'm1' });
  r.ajouterEvenement('a', MAJ, { type: 'texte', texte: 'réponse', uuid: 'r1' });
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'second', uuid: 'm2' });
  r.ajouterEvenement('a', MAJ, { type: 'texte', texte: 'suite', uuid: 'r2' });
}

function postesQui(reponse: { ok: boolean; donnees?: unknown; erreur?: string }, envoyes: unknown[]): Postes {
  return {
    commander: (_machine: string, commande: unknown) => {
      envoyes.push(commande);
      return Promise.resolve(reponse);
    },
  } as unknown as Postes;
}

describe('rembobinage, duplication et chapitres', () => {
  test('rangMessage ne trouve que les messages de Chris, par uuid', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    expect(r.rangMessage('a', 'm2')).toBe(3);
    expect(r.rangMessage('a', 'r1')).toBeNull();
    expect(r.rangMessage('a', 'absent')).toBeNull();
  });

  test('rangEntree trouve un message de Chris ou une fin de réponse, jamais un texte', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    r.ajouterEvenement('a', MAJ, { type: 'tour_fini', dureeMs: 1, contexte: 0, uuid: 'r2' });
    expect(r.rangEntree('a', 'm1')).toBe(1);
    expect(r.rangEntree('a', 'r2')).toBe(5);
    expect(r.rangEntree('a', 'r1')).toBeNull();
  });

  test('dupliquer et épingler une réponse par l uuid de sa fin de tour', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    r.ajouterEvenement('a', MAJ, { type: 'tour_fini', dureeMs: 1, contexte: 0, uuid: 'r2' });
    const envoyes: unknown[] = [];
    const postes = postesQui({ ok: true, donnees: { sessionId: 'copie' } }, envoyes);
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.dupliquer(requete('a', 'dupliquer', { messageId: 'r2' }))).status).toBe(201);
    expect(envoyes).toEqual([{ kind: 'dupliquer', sessionId: 'a', messageId: 'r2' }]);
    expect((await api.chapitre(requete('a', 'chapitres', { messageId: 'r2', epingle: true }))).status).toBe(200);
    expect(r.derniersEvenements('a', 1)[0]?.evt).toEqual({ type: 'chapitre', uuid: 'r2', epingle: true });
  });

  test('tronquerDepuis retire le message et tout ce qui le suit', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const rang = r.rangMessage('a', 'm2') ?? 0;
    expect(r.tronquerDepuis('a', rang)).toBe(2);
    expect(r.derniersEvenements('a', 10).map((e) => e.seq)).toEqual([1, 2]);
  });

  test('rembobiner : le poste reçoit le message, le fil du relais est retiré à partir de lui', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const envoyes: unknown[] = [];
    const api = new ApiSessions(r, postesQui({ ok: true, donnees: {} }, envoyes), new Diffusion(), new Set(), journal);
    const reponse = await api.rembobiner(requete('a', 'rembobiner', { messageId: 'm2' }));
    expect(reponse.status).toBe(200);
    expect(envoyes).toEqual([{ kind: 'rembobiner', sessionId: 'a', messageId: 'm2' }]);
    expect(r.derniersEvenements('a', 10)).toHaveLength(2);
  });

  test('rembobiner refusé par le poste : fil intact', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const api = new ApiSessions(r, postesQui({ ok: false, erreur: 'refus' }, []), new Diffusion(), new Set(), journal);
    expect((await api.rembobiner(requete('a', 'rembobiner', { messageId: 'm2' }))).status).not.toBe(200);
    expect(r.derniersEvenements('a', 10)).toHaveLength(4);
  });

  test('rembobiner à un message inconnu du fil : 404 sans appel au poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const envoyes: unknown[] = [];
    const api = new ApiSessions(r, postesQui({ ok: true }, envoyes), new Diffusion(), new Set(), journal);
    expect((await api.rembobiner(requete('a', 'rembobiner', { messageId: 'r1' }))).status).toBe(404);
    expect(envoyes).toEqual([]);
  });

  test('dupliquer : transmet le message au poste et renvoie l identifiant de la copie', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const envoyes: unknown[] = [];
    const api = new ApiSessions(
      r,
      postesQui({ ok: true, donnees: { sessionId: 'copie' } }, envoyes),
      new Diffusion(),
      new Set(),
      journal,
    );
    const reponse = await api.dupliquer(requete('a', 'dupliquer', { messageId: 'm1' }));
    expect(reponse.status).toBe(201);
    expect(await reponse.json()).toEqual({ sessionId: 'copie' });
    expect(envoyes).toEqual([{ kind: 'dupliquer', sessionId: 'a', messageId: 'm1' }]);
  });

  test('chapitre : épingle puis retire, persisté dans le fil', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    fil(r);
    const api = new ApiSessions(r, postesQui({ ok: true }, []), new Diffusion(), new Set(), journal);
    expect((await api.chapitre(requete('a', 'chapitres', { messageId: 'm1', epingle: true }))).status).toBe(200);
    const dernier = r.derniersEvenements('a', 1)[0];
    expect(dernier?.evt).toEqual({ type: 'chapitre', uuid: 'm1', epingle: true });
    expect((await api.chapitre(requete('a', 'chapitres', { messageId: 'r1', epingle: true }))).status).toBe(404);
  });
});
