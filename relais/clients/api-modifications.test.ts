import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ApiModifications } from './api-modifications.ts';

const MAJ = '2026-11-19T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string, machine: string): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: '/p', nom: 'p' },
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
    claudeSessionId: id,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function api(reponse: ReponsePoste): { api: ApiModifications; recues: unknown[] } {
  const registre = new Registre(ouvrirBase(':memory:'));
  registre.enregistrerSession(session('s1', 'tour'));
  const recues: unknown[] = [];
  const postes = {
    commander: (machine: string, commande: unknown) => {
      recues.push({ machine, commande });
      return Promise.resolve(reponse);
    },
  } as unknown as Postes;
  return { api: new ApiModifications(registre, postes, journal), recues };
}

type Params = Record<string, string>;

function requete(url: string, params: Params, corps?: unknown): Request & { params: Params } {
  const init: RequestInit = corps === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request(`http://relais.test${url}`, init), { params });
}

describe('modifications git par le relais', () => {
  test('la liste exige une portée connue et la transmet au poste', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { racine: '/p', branche: 'main', fichiers: [] } });
    const sans = await a.modifications(requete('/api/sessions/s1/git/modifications', { id: 's1' }));
    expect(sans.status).toBe(400);
    const bonne = await a.modifications(requete('/api/sessions/s1/git/modifications?portee=branche', { id: 's1' }));
    expect(bonne.status).toBe(200);
    expect(await bonne.json()).toEqual({ racine: '/p', branche: 'main', fichiers: [] });
    expect(recues).toEqual([
      { machine: 'tour', commande: { kind: 'git_modifications', sessionId: 's1', portee: 'branche' } },
    ]);
  });

  test('le diff refuse un chemin vide', async () => {
    const { api: a, recues } = api({ ok: true, donnees: {} });
    const r = await a.diff(requete('/api/sessions/s1/git/diff?portee=non_commitees&chemin=', { id: 's1' }));
    expect(r.status).toBe(400);
    expect(recues).toEqual([]);
  });

  test('annuler et commiter transmettent leur corps ; le commit rend son empreinte', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { hash: 'abc1234' } });
    const annuler = await a.annuler(requete('/api/sessions/s1/git/annuler', { id: 's1' }, { chemin: 'src/a.ts' }));
    expect(annuler.status).toBe(200);
    const commit = await a.commiter(requete('/api/sessions/s1/git/commiter', { id: 's1' }, { message: 'Ajoute' }));
    expect(await commit.json()).toEqual({ hash: 'abc1234' });
    const genres = recues.map((r) => (r as { commande: { kind: string } }).commande.kind);
    expect(genres).toEqual(['git_annuler', 'git_commiter']);
  });

  test('une session inconnue donne 404 sans rien envoyer', async () => {
    const { api: a, recues } = api({ ok: true, donnees: {} });
    const r = await a.commiter(requete('/api/sessions/absente/git/commiter', { id: 'absente' }, { message: 'x' }));
    expect(r.status).toBe(404);
    expect(recues).toEqual([]);
  });
});

describe('tours par le relais', () => {
  test('un identifiant de tour invalide est refusé avant le poste ; `dernier` passe', async () => {
    const { api: a, recues } = api({ ok: true, donnees: { racine: '/p', branche: null, fichiers: [] } });
    expect((await a.tourModifications(requete('/x', { id: 's1', tour: '../etc' }))).status).toBe(400);
    expect((await a.tourModifications(requete('/x', { id: 's1', tour: 'dernier' }))).status).toBe(200);
    expect(recues).toEqual([
      { machine: 'tour', commande: { kind: 'tour_modifications', sessionId: 's1', tour: 'dernier' } },
    ]);
  });

  test('« tour inconnu » du poste devient 404, un autre refus reste 409', async () => {
    const inconnu = api({ ok: false, erreur: 'tour inconnu' });
    expect((await inconnu.api.tourAnnuler(requete('/x', { id: 's1', tour: 'dernier' }))).status).toBe(404);
    const refus = api({ ok: false, erreur: 'modifié depuis la fin du tour : a.ts' });
    const r = await refus.api.tourAnnuler(requete('/x', { id: 's1', tour: 'dernier' }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erreur: 'modifié depuis la fin du tour : a.ts' });
  });

  test('le diff d’un tour exige un chemin', async () => {
    const { api: a } = api({ ok: true, donnees: {} });
    expect((await a.tourDiff(requete('/x', { id: 's1', tour: 'dernier' }))).status).toBe(400);
  });
});
