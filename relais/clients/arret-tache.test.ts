import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiSessions } from './api-sessions.ts';
import { Diffusion } from './diffusion.ts';

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
    statut: 'travail',
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

function fauxPostes(reponse: ReponsePoste): { postes: Postes; appels: unknown[] } {
  const appels: unknown[] = [];
  const postes = {
    commander: (_machine: string, c: unknown) => {
      appels.push(c);
      return Promise.resolve(reponse);
    },
  } as unknown as Postes;
  return { postes, appels };
}

function requete(id: string, tache: string): Request & { params: { id: string; tache: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/taches/${tache}/arreter`, { method: 'POST' }), {
    params: { id, tache },
  });
}

describe('arrêt d une tâche de fond', () => {
  test('la commande part au poste avec l identifiant de la tâche', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes, appels } = fauxPostes({ ok: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.arreterTache(requete('a', 'tache-1'))).status).toBe(200);
    expect(appels).toEqual([{ kind: 'arreter_tache', sessionId: 'a', tache: 'tache-1' }]);
  });

  test('un identifiant malformé est refusé avant le poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes, appels } = fauxPostes({ ok: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.arreterTache(requete('a', 'x..y'))).status).toBe(400);
    expect(appels).toEqual([]);
  });

  test('un refus du poste remonte en erreur, session inconnue : 404', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes } = fauxPostes({ ok: false, erreur: 'arrêt impossible' });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.arreterTache(requete('a', 'tache-1'))).status).toBe(409);
    expect((await api.arreterTache(requete('absente', 'tache-1'))).status).toBe(404);
  });
});
