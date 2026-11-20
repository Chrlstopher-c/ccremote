// Responsabilité : tests des sessions tmux de l'entretien (serveur propre ou partagé, restes).
import { describe, expect, test } from 'bun:test';
import type { PaneTmux } from '../session/tmux.ts';
import { sessionsTmux } from './tmux-entretien.ts';

const pane = (nom: string, creeLe = 1_700_000_000): PaneTmux => ({ nom, creeLe, attachee: false, dossier: '/x', titre: nom, pid: 1 });

describe('sessions tmux de l’entretien', () => {
  test('serveur propre : toutes les sessions ; une session que le gestionnaire ne suit pas est un reste', () => {
    const r = sessionsTmux([pane('claude-a'), pane('claude-b', 0)], new Set(['claude-a']), false);
    expect(r).toEqual([
      { nom: 'claude-a', session: null, depuis: new Date(1_700_000_000_000).toISOString(), reste: false },
      { nom: 'claude-b', session: null, depuis: null, reste: true },
    ]);
  });

  test('serveur partagé : seules les sessions créées par ce poste (fiches) sont listées', () => {
    const r = sessionsTmux([pane('claude-a'), pane('claude-autre')], new Set(['claude-a']), true);
    expect(r.map((s) => s.nom)).toEqual(['claude-a']);
  });
});
