import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ApiSessionConfig } from './api-session-config.ts';
import { ApiSessions } from './api-sessions.ts';
import { Diffusion } from './diffusion.ts';

const journal = pino({ enabled: false });
const MAJ = '2026-11-19T10:00:00.000Z';
const DECOUVERTE = {
  id: 'd1',
  machine: 'tour',
  cwd: '/p',
  titre: 'Ancienne',
  modifieLe: MAJ,
  branche: null,
  messages: 4,
};

// Fiche qu'un poste renvoie après adoption : fermée, reprenable par le SDK, modèle lu dans le transcript.
function ficheAdoptee(): ResumeSession {
  return {
    id: 'd1',
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: 'Ancienne',
    objectif: null,
    modele: 'claude-fable-5-2',
    compte: 'principal',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'd1',
    moteur: 'sdk',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

type Recue = { machine: string; commande: Record<string, unknown> };

// Poste simulé : une session découverte que `adopter` fait entrer dans le registre du relais, comme le fait le poste.
function posteAvecDecouverte(registre: Registre): { postes: Postes; recues: Recue[] } {
  const recues: Recue[] = [];
  const postes = {
    commander: (machine: string, commande: Record<string, unknown>): Promise<ReponsePoste> => {
      recues.push({ machine, commande });
      if (commande['kind'] === 'adopter') registre.enregistrerSession(ficheAdoptee());
      return Promise.resolve({ ok: true, donnees: {} });
    },
    decouvertes: () => [DECOUVERTE],
    vues: () => [],
  } as unknown as Postes;
  return { postes, recues };
}

function requete(id: string, corps: unknown = {}, action = ''): Request & { params: Record<string, string> } {
  const url = `http://relais.test/api/sessions/${id}${action ? `/${action}` : ''}`;
  return Object.assign(
    new Request(url, { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } }),
    { params: { id, action } },
  );
}

function ensemble(): { registre: Registre; api: ApiSessions; config: ApiSessionConfig; recues: Recue[] } {
  const registre = new Registre(ouvrirBase(':memory:'));
  const { postes, recues } = posteAvecDecouverte(registre);
  const api = new ApiSessions(registre, postes, new Diffusion(), new Set(), journal);
  const config = new ApiSessionConfig(registre, postes);
  return { registre, api, config, recues };
}

describe('session découverte sur un poste : adoptée puis action', () => {
  type Action = [string, (a: ApiSessions, c: ApiSessionConfig) => Promise<Response>, Record<string, unknown>];
  const actions: Action[] = [
    [
      'modèle',
      (a) => a.modele(requete('d1', { modele: 'claude-opus-5-5' }) as never),
      { kind: 'modele', modele: 'claude-opus-5-5' },
    ],
    ['effort', (a) => a.effort(requete('d1', { effort: 'high' }) as never), { kind: 'effort', effort: 'high' }],
    ['mode', (a) => a.mode(requete('d1', { mode: 'plan' }) as never), { kind: 'mode', mode: 'plan' }],
    [
      'renommer',
      (a) => a.renommer(requete('d1', { titre: 'Nouveau' }) as never),
      { kind: 'renommer', titre: 'Nouveau' },
    ],
    [
      'remote control',
      (a) => a.remoteControl(requete('d1', { actif: true }) as never),
      { kind: 'remote_control', actif: true },
    ],
    [
      'style',
      (_a, c) => c.style(requete('d1', { style: 'Learning' }) as never),
      { kind: 'style', style: 'Learning' },
    ],
    ['supprimer', (a) => a.supprimer(requete('d1') as never), { kind: 'supprimer' }],
    ['envoyer', (a) => a.envoyer(requete('d1', { texte: 'OK' }) as never), { kind: 'envoyer', texte: 'OK' }],
  ];

  for (const [nom, lancer, attendue] of actions) {
    test(`${nom} : l'adoption part d'abord, puis l'action, jamais « session inconnue »`, async () => {
      const { api, config, registre, recues } = ensemble();
      const r = await lancer(api, config);
      expect(r.status).not.toBe(404);
      expect(recues.map((x) => x.commande['kind'])).toEqual(['adopter', attendue['kind']]);
      expect(recues[1]?.commande).toMatchObject({ ...attendue, sessionId: 'd1' });
      expect(recues[0]?.machine).toBe('tour');
      if (attendue['kind'] !== 'supprimer') expect(registre.session('d1')).not.toBeNull();
    });
  }

  test('une session inconnue partout : 404 sans appel au poste', async () => {
    const { api, recues } = ensemble();
    const r = await api.modele(Object.assign(requete('absente', { modele: 'x' }), {}) as never);
    expect(r.status).toBe(404);
    expect(recues.length).toBe(0);
  });

  test('une session déjà connue du relais : pas d’adoption, action directe', async () => {
    const { api, registre, recues } = ensemble();
    registre.enregistrerSession(ficheAdoptee());
    await api.modele(requete('d1', { modele: 'claude-opus-5-5' }) as never);
    expect(recues.map((x) => x.commande['kind'])).toEqual(['modele']);
  });

  test('rembobiner une découverte : fil vide au relais, le poste vérifie le message', async () => {
    const { api, recues } = ensemble();
    const r = await api.rembobiner(requete('d1', { messageId: 'm-1' }) as never);
    expect(r.status).toBe(200);
    expect(recues.map((x) => x.commande['kind'])).toEqual(['adopter', 'rembobiner']);
  });

  test('archiver une session découverte : adoption, puis rangement sans appel de fermeture', async () => {
    const { api, recues } = ensemble();
    const r = await api.action(requete('d1', {}, 'archiver') as never);
    expect(r.status).toBe(200);
    expect(recues.map((x) => x.commande['kind'])).toEqual(['adopter']);
  });
});
