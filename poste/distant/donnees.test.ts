import { describe, expect, test } from 'bun:test';
import { lirePage, lireSession } from './donnees.ts';
import type { StatutSession } from '../../commun/session.ts';
import { statutDistant } from './resume-distant.ts';
import { evenementApi, sessionApi } from './faux-claude-ai.ts';

describe('lecture des sessions claude.ai', () => {
  test('une session sans identifiant est écartée', () => {
    expect(lireSession({ title: 'sans id' })).toBeNull();
    expect(lireSession('pas un objet')).toBeNull();
  });

  test('environnement, statut, connexion et contexte sont relevés', () => {
    const s = lireSession(sessionApi('cse_a', { unread: true }));
    expect(s).toMatchObject({
      id: 'cse_a',
      bridge: true,
      active: true,
      connectee: true,
      travail: 'idle',
      nonLue: true,
      modele: 'claude-haiku-5-5',
      effort: 'high',
      contexte: { tokens: 1200, max: 1000000 },
    });
  });

  test('une session cli ou archivée n’est ni bridge ni active', () => {
    const s = lireSession(sessionApi('cse_b', { environment_kind: 'cli', status: 'archived' }));
    expect(s).toMatchObject({ bridge: false, active: false });
  });

  test('sans usage de contexte, contexte nul et modèle de repli', () => {
    const s = lireSession({ id: 'cse_c', config: { model: 'x' }, external_metadata: {} });
    expect(s).toMatchObject({ contexte: null, modele: 'x', effort: null, connectee: false });
  });

  test('une page d’événements écarte les entrées sans identifiant et garde le curseur suivant', () => {
    const page = lirePage({
      data: [evenementApi('ev1', { type: 'x' }, 't1'), { payload: {} }],
      next_cursor: 'c2',
    });
    expect(page.evenements.map((e) => e.id)).toEqual(['ev1']);
    expect(page.suivant).toBe('c2');
  });
});

describe('statut Quart d’une session distante', () => {
  const base = (surcharge: Record<string, unknown>) => {
    const s = lireSession(sessionApi('cse_d', surcharge));
    if (!s) throw new Error('session de test invalide');
    return s;
  };

  const cas: [Record<string, unknown>, StatutSession][] = [
    [{ worker_status: 'running' }, 'travail'],
    [{ worker_status: 'requires_action' }, 'question'],
    [{ worker_status: 'idle' }, 'attente'],
    [{ worker_status: 'inconnu' }, 'attente'],
    [{ connection_status: 'disconnected', worker_status: 'running' }, 'fermee'],
  ];
  test.each(cas)('%p donne le statut attendu', (surcharge, attendu) => {
    expect(statutDistant(base(surcharge))).toBe(attendu);
  });
});
