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

function requete(id: string, action: string): Request & { params: { id: string; action: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/${action}`, { method: 'POST' }), {
    params: { id, action },
  });
}

const postesMuets = {
  commander: () => Promise.reject(new Error('le poste ne doit pas être appelé')),
  decouvertes: () => [],
} as unknown as Postes;

describe('épinglage persisté', () => {
  test('le drapeau epinglee est persisté, lu sur la vue, par défaut à false', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    expect(r.session('a')?.epinglee).toBe(false);
    r.definirEpinglee('a', true);
    expect(r.session('a')?.epinglee).toBe(true);
    r.definirEpinglee('a', false);
    expect(r.session('a')?.epinglee).toBe(false);
  });

  test('une fiche renvoyée par le poste ne désépingle pas la session', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    r.definirEpinglee('a', true);
    r.enregistrerSession({ ...session('a'), majLe: '2026-11-18T11:00:00.000Z' });
    expect(r.session('a')?.epinglee).toBe(true);
  });

  test('epingler et désépingler passent par l action, sans appel au poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const api = new ApiSessions(r, postesMuets, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('a', 'epingler'))).status).toBe(200);
    expect(r.session('a')?.epinglee).toBe(true);
    expect((await api.action(requete('a', 'desepingler'))).status).toBe(200);
    expect(r.session('a')?.epinglee).toBe(false);
  });

  test('épingler une session inconnue : 404', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    const api = new ApiSessions(r, postesMuets, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('absente', 'epingler'))).status).toBe(404);
  });
});
