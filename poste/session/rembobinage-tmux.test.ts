// Responsabilité : tests du rembobinage et de la suppression d'une session pilotée dans le TUI (tmux).
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { rembobinerTui, type GestionBascule } from './bascule-controle.ts';
import type { SessionPersistee } from './persistance.ts';
import type { SortieSession } from './session-poste.ts';
import { SessionTmux } from './session-tmux.ts';

const MAJ = '2026-11-19T10:00:00.000Z';

function fiche(partiel: Partial<ResumeSession>): ResumeSession {
  return {
    id: 'session-tui',
    machine: 'portable',
    projet: { machine: 'portable', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: 'Session pilotée',
    objectif: null,
    modele: 'défaut',
    compte: 'principal',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'session-tui',
    moteur: 'tmux',
    tmux: 'claude-p',
    attachee: false,
    pilotee: true,
    creeLe: MAJ,
    majLe: MAJ,
    ...partiel,
  };
}

function montage(resume: ResumeSession): SessionTmux {
  const sortie: SortieSession = { evenement: () => undefined, resume: () => undefined };
  const persistee: SessionPersistee = {
    resume,
    consignes: 'consignes',
    configDir: null,
    transcript: null,
    position: 0,
    aReprendre: false,
  };
  return new SessionTmux(persistee, { socket: 'test', journal: pino({ enabled: false }), sortie });
}

const GESTION: GestionBascule = {
  sessions: new Map(),
  config: { machine: 'portable' },
  journal: pino({ enabled: false }),
  creer: () => {
    throw new Error('ne doit pas être appelé');
  },
  sauvegarder: () => undefined,
};

describe('rembobinage d une session du TUI', () => {
  test('refusé pendant un tour, sans toucher au TUI', async () => {
    const s = montage(fiche({ statut: 'travail' }));
    const r = await rembobinerTui(GESTION, s, 'message-1');

    expect(r.ok).toBe(false);
    expect(r.erreur).toContain('occupée');
    expect(s.resume.tmux).toBe('claude-p');
  });
});
