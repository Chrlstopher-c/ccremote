import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ApiSessions } from './api-sessions.ts';
import { Diffusion } from './diffusion.ts';

const MAJ = '2026-11-25T10:00:00.000Z';
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
    decouvertes: () => [],
  } as unknown as Postes;
  return { postes, appels };
}

function requete(id: string, outil: string): Request & { params: { id: string; outil: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/outils/${outil}/fond`, { method: 'POST' }), {
    params: { id, outil },
  });
}

describe('mise en fond d une commande (route)', () => {
  test('la commande part au poste avec l identifiant de l appel, réponse ok + enFond', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes, appels } = fauxPostes({ ok: true, donnees: { ok: true, enFond: true } });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const reponse = await api.mettreEnFond(requete('a', 'toolu_01abc'));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true, enFond: true });
    expect(appels).toEqual([{ kind: 'mettre_en_fond', sessionId: 'a', appel: 'toolu_01abc' }]);
  });

  test('un identifiant d appel malformé est refusé avant le poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes, appels } = fauxPostes({ ok: true });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect((await api.mettreEnFond(requete('a', 'x..y'))).status).toBe(400);
    expect(appels).toEqual([]);
  });

  test('un refus du poste (hors SDK, commande finie) remonte en 409 avec son message ; inconnue : 404', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const { postes } = fauxPostes({ ok: false, erreur: 'non pris en charge pour cette session' });
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    const refus = await api.mettreEnFond(requete('a', 'toolu_1'));
    expect(refus.status).toBe(409);
    expect(await refus.text()).toContain('non pris en charge pour cette session');
    expect((await api.mettreEnFond(requete('absente', 'toolu_1'))).status).toBe(404);
  });
});
