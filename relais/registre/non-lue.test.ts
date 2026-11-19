// Responsabilité : test de l'état « non lue » persisté par le relais — il survit à une fiche du poste et se pose ou se
// retire par l'action, sans appel au poste.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import type { Postes } from '../parc/postes.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';
import { ResumeSession } from '../../commun/session.ts';

const MAJ = '2026-11-19T10:00:00.000Z';
const journal = pino({ enabled: false });
const postesMuets = { commander: () => Promise.reject(new Error('le poste ne doit pas être appelé')) } as unknown as Postes;

function session(id: string, majLe = MAJ): ResumeSession {
  return ResumeSession.parse({
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
    majLe,
  });
}

function requete(id: string, action: string): Request & { params: { id: string; action: string } } {
  return Object.assign(new Request(`http://relais.test/api/sessions/${id}/${action}`, { method: 'POST' }), {
    params: { id, action },
  });
}

describe('non lue persistée', () => {
  test('le drapeau est lu sur la vue, faux par défaut, et une fiche du poste ne l’efface pas', () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    expect(r.session('a')?.nonLue).toBe(false);
    r.definirNonLue('a', true);
    r.enregistrerSession(session('a', '2026-11-19T11:00:00.000Z'));
    expect(r.session('a')?.nonLue).toBe(true);
  });

  test('marquer non lue puis lue passe par l’action, sans appel au poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession(session('a'));
    const api = new ApiSessions(r, postesMuets, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('a', 'marquer_non_lue'))).status).toBe(200);
    expect(r.session('a')?.nonLue).toBe(true);
    expect((await api.action(requete('a', 'marquer_lue'))).status).toBe(200);
    expect(r.session('a')?.nonLue).toBe(false);
  });

  test('une session inconnue : 404', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    const api = new ApiSessions(r, postesMuets, new Diffusion(), new Set(), journal);
    expect((await api.action(requete('absente', 'marquer_non_lue'))).status).toBe(404);
  });
});
