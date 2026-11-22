import { describe, expect, test } from 'bun:test';
import { ResumeSession } from '../../commun/session.ts';
import { cibleConversation, membresConversation, planDoublons } from './doublons-conversation.ts';

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

// Fiche de poste (Desktop sur la tour, terminal) : elle est l'entrée principale de sa conversation.
function poste(id: string, conversation: string, archivee = false): ResumeSession {
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
    archivee,
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

  test('la fiche de poste est principale : la jumelle vivante lui cède la place', () => {
    const plan = planDoublons([poste('s-poste', 'conv-1'), rc('cse_new', 'conv-1', { connectee: true })]);
    expect([...plan.masquees]).toEqual([['cse_new', 's-poste']]);
  });

  test('une fiche de poste rangée laisse la jumelle vivante reprendre la place', () => {
    const plan = planDoublons([
      poste('s-poste', 'conv-1', true),
      rc('cse_new', 'conv-1', { connectee: true }),
    ]);
    expect([...plan.masquees]).toEqual([['s-poste', 'cse_new']]);
  });

  test('une jumelle seule (pas de fiche de poste) reste l’entrée', () => {
    const plan = planDoublons([rc('cse_a', 'conv-1', { connectee: false }), poste('s-autre', 'conv-2')]);
    expect(plan.masquees.size).toBe(0);
  });

  test('deux conversations, poste et jumelles : chacune garde sa principale, sans fusion croisée', () => {
    const plan = planDoublons([
      poste('s-1', 'conv-1'),
      rc('cse_1', 'conv-1', { connectee: true }),
      poste('s-2', 'conv-2'),
      rc('cse_2', 'conv-2', { connectee: true }),
    ]);
    expect([...plan.masquees].sort()).toEqual([
      ['cse_1', 's-1'],
      ['cse_2', 's-2'],
    ]);
  });

  test('une session sans conversation rattachée ne forme pas de groupe', () => {
    const plan = planDoublons([rc('cse_a', undefined, { connectee: false }), rc('cse_b', undefined)]);
    expect(plan.masquees.size).toBe(0);
  });
});

describe('cibleConversation et membresConversation', () => {
  const sessions = (): ResumeSession[] => [
    poste('s-poste', 'conv-1'),
    rc('cse_old', 'conv-1', { connectee: false }),
    rc('cse_new', 'conv-1', { connectee: true }),
    rc('cse_autre', 'conv-2', { connectee: true }),
  ];

  test('la cible d’une jumelle est la fiche de poste ; celle de la principale est elle-même', () => {
    expect(cibleConversation(sessions(), 'cse_new')).toBe('s-poste');
    expect(cibleConversation(sessions(), 's-poste')).toBe('s-poste');
    expect(cibleConversation(sessions(), 'cse_autre')).toBe('cse_autre');
  });

  test('les membres d’une conversation incluent les jumelles, rangées comprises', () => {
    const membres = membresConversation(sessions(), 'cse_old');
    expect(membres.sort()).toEqual(['cse_new', 'cse_old', 's-poste']);
    expect(membresConversation(sessions(), 'cse_autre')).toEqual(['cse_autre']);
    expect(membresConversation(sessions(), 'inconnue')).toEqual(['inconnue']);
  });
});
