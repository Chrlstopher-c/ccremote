// Responsabilité : tests de la décision de cession (logique pure) — quand une session SDK rend la main à une
// conversation tenue par un processus Claude interactif hors Lanterne, et quels processus comptent comme tels.
import { describe, expect, test } from 'bun:test';
import { decisionCession, tenueParAilleurs } from './cession-sdk.ts';
import type { ProcessusClaude } from './processus.ts';

const processus = (sessionId: string, sdk: boolean): ProcessusClaude => ({
  pid: 1,
  sessionId,
  cwd: '/projets/app',
  enTmux: false,
  configDir: null,
  nom: null,
  sdk,
});

describe('decisionCession', () => {
  test('une session non vivante, ou une conversation non tenue ailleurs, n’est pas touchée', () => {
    expect(decisionCession(false, false, true)).toBe('ignorer');
    expect(decisionCession(false, true, true)).toBe('ignorer');
    expect(decisionCession(true, false, false)).toBe('ignorer');
    expect(decisionCession(true, true, false)).toBe('ignorer');
  });

  test('conversation tenue ailleurs sans tour en cours : fermer tout de suite', () => {
    expect(decisionCession(true, false, true)).toBe('fermer');
  });

  test('conversation tenue ailleurs pendant un tour : attendre la fin du tour', () => {
    expect(decisionCession(true, true, true)).toBe('attendre');
  });
});

describe('tenueParAilleurs', () => {
  test('un processus interactif hors SDK tient la conversation', () => {
    expect(tenueParAilleurs([processus('claude-abc', false)], 'claude-abc')).toBe(true);
  });

  test('un processus SDK (notre propre session) ne compte pas', () => {
    expect(tenueParAilleurs([processus('claude-abc', true)], 'claude-abc')).toBe(false);
  });

  test('un autre identifiant de conversation ne compte pas', () => {
    expect(tenueParAilleurs([processus('autre', false)], 'claude-abc')).toBe(false);
    expect(tenueParAilleurs([], 'claude-abc')).toBe(false);
  });
});
