import { describe, expect, test } from 'bun:test';
import { ResumeSession } from '../../commun/session.ts';
import { planDoublons } from './doublons-conversation.ts';

const MAJ = '2026-11-22T10:00:00.000Z';

interface Options {
  readonly connectee?: boolean;
  readonly majLe?: string;
  readonly archivee?: boolean;
}

// Session Remote Control (`cse_…`) rattachée à une conversation Claude Code.
function rc(id: string, conversation: string | undefined, options: Options = {}): ResumeSession {
  const connectee = options.connectee ?? true;
  return ResumeSession.parse({
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: 'Remote Control', nom: 'Remote Control' },
    cwd: 'Remote Control',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: connectee ? 'attente' : 'fermee',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    moteur: 'claude_ai',
    distant: {
      compte: 'defaut',
      idDistant: id,
      connexion: connectee ? 'connectee' : 'deconnectee',
      probleme: null,
      conversation,
    },
    archivee: options.archivee ?? false,
    creeLe: MAJ,
    majLe: options.majLe ?? MAJ,
  });
}

// Fiche de poste (Desktop sur la tour, terminal) : elle n'entre jamais dans un groupe de jumelles.
function poste(id: string, conversation: string): ResumeSession {
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
    claudeSessionId: conversation,
    tmux: null,
    attachee: false,
    pilotee: false,
    terminal: true,
    creeLe: MAJ,
    majLe: MAJ,
  });
}

describe('planDoublons : une conversation, une entrée', () => {
  test('la jumelle déconnectée est masquée au profit de la vivante', () => {
    const plan = planDoublons([
      rc('cse_old', 'conv-1', { connectee: false, majLe: '2026-11-22T09:00:00.000Z' }),
      rc('cse_new', 'conv-1', { connectee: true, majLe: '2026-11-22T11:00:00.000Z' }),
    ]);
    expect([...plan.masquees]).toEqual([['cse_old', 'cse_new']]);
  });

  test('une vivante ne cède pas à une déconnectée plus récente', () => {
    const plan = planDoublons([
      rc('cse_old', 'conv-1', { connectee: true, majLe: '2026-11-22T09:00:00.000Z' }),
      rc('cse_new', 'conv-1', { connectee: false, majLe: '2026-11-22T12:00:00.000Z' }),
    ]);
    expect([...plan.masquees]).toEqual([['cse_new', 'cse_old']]);
  });

  test('deux vivantes : la plus récente est principale', () => {
    const plan = planDoublons([
      rc('cse_a', 'conv-1', { majLe: '2026-11-22T09:00:00.000Z' }),
      rc('cse_b', 'conv-1', { majLe: '2026-11-22T11:00:00.000Z' }),
    ]);
    expect([...plan.masquees]).toEqual([['cse_a', 'cse_b']]);
  });

  test('une jumelle archivée est masquée au profit de la vivante', () => {
    const plan = planDoublons([
      rc('cse_old', 'conv-1', { connectee: true, archivee: true }),
      rc('cse_new', 'conv-1', { connectee: true }),
    ]);
    expect([...plan.masquees]).toEqual([['cse_old', 'cse_new']]);
  });

  test("si la principale est archivée, l'autre reprend la place", () => {
    const plan = planDoublons([
      rc('cse_old', 'conv-1', { connectee: false, majLe: '2026-11-22T09:00:00.000Z' }),
      rc('cse_new', 'conv-1', { connectee: true, archivee: true, majLe: '2026-11-22T11:00:00.000Z' }),
    ]);
    expect([...plan.masquees]).toEqual([['cse_new', 'cse_old']]);
  });

  test('deux jumelles archivées : rien à masquer, elles sont déjà rangées', () => {
    const plan = planDoublons([
      rc('cse_old', 'conv-1', { archivee: true }),
      rc('cse_new', 'conv-1', { archivee: true }),
    ]);
    expect(plan.masquees.size).toBe(0);
  });

  test('deux conversations différentes ne sont jamais fusionnées', () => {
    const plan = planDoublons([
      rc('cse_a', 'conv-1', { connectee: false }),
      rc('cse_b', 'conv-2', { connectee: true }),
    ]);
    expect(plan.masquees.size).toBe(0);
  });

  test('une session sans conversation rattachée ne forme pas de groupe', () => {
    const plan = planDoublons([rc('cse_a', undefined, { connectee: false }), rc('cse_b', undefined)]);
    expect(plan.masquees.size).toBe(0);
  });

  test('une fiche de poste ne se masque jamais et ne masque aucune jumelle', () => {
    const plan = planDoublons([poste('s-poste', 'conv-1'), rc('cse_new', 'conv-1', { connectee: true })]);
    expect(plan.masquees.size).toBe(0);
  });
});
