import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Diffusion } from './diffusion.ts';
import { ApiSessions } from './api-sessions.ts';

// Trace de relais entre sessions : la route relaie la commande au poste de la session, avec son sens et son autre bout.
const journal = pino({ enabled: false });
const MAJ = '2026-11-20T10:00:00.000Z';

function fiche(id: string, machine: string): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `Titre ${id}`,
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

function postesSimules(reponse: ReponsePoste) {
  const recues: { machine: string; commande: Record<string, unknown> }[] = [];
  const postes = {
    commander: (machine: string, commande: Record<string, unknown>) => {
      recues.push({ machine, commande });
      return Promise.resolve(reponse);
    },
    vues: () => [],
    decouvertes: () => [],
  } as unknown as Postes;
  return { postes, recues };
}

function requete(id: string, corps: unknown) {
  const init: RequestInit = { method: 'POST', body: JSON.stringify(corps) };
  return Object.assign(new Request('http://relais.test/api', init), { params: { id } });
}

function sessions(postes: Postes): ApiSessions {
  const registre = new Registre(ouvrirBase(':memory:'));
  registre.enregistrerSession(fiche('s1', 'tour'));
  return new ApiSessions(registre, postes, new Diffusion(), new Set(), journal);
}

const AUTRE = { session: 's2', titre: 'Cible', compte: 'defaut' };

describe('trace de relais (relais)', () => {
  test('transmet tracer_relais au poste de la session, sens et autre bout inclus', async () => {
    const { postes, recues } = postesSimules({ ok: true });
    const r = await sessions(postes).relais(requete('s1', { sens: 'sortant', autre: AUTRE, texte: 'Bonjour' }));
    expect(r.status).toBe(200);
    expect(recues).toEqual([
      {
        machine: 'tour',
        commande: { kind: 'tracer_relais', sessionId: 's1', sens: 'sortant', autre: AUTRE, texte: 'Bonjour' },
      },
    ]);
  });

  test('sens inconnu ou texte vide : 400, rien n’est transmis', async () => {
    const { postes, recues } = postesSimules({ ok: true });
    const api = sessions(postes);
    expect((await api.relais(requete('s1', { sens: 'autre', autre: AUTRE, texte: 'x' }))).status).toBe(400);
    expect((await api.relais(requete('s1', { sens: 'entrant', autre: AUTRE, texte: '' }))).status).toBe(400);
    expect(recues).toHaveLength(0);
  });
});
