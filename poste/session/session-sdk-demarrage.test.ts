import { describe, expect, test } from 'bun:test';
import { nouvelleSession } from './faux-sdk.ts';

const SANS_CLAUDE =
  'Native CLI binary for linux-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, ' +
  'or set options.pathToClaudeCodeExecutable';

describe('démarrage impossible', () => {
  test('Claude Code absent : la raison lisible part dans le fil, pas seulement dans le journal', async () => {
    const { session, evenements } = nouvelleSession(async () => [], { echecDemarrage: SANS_CLAUDE });
    const refus = await session.lancer('bonjour');
    expect(refus).toContain('Claude Code est introuvable sur ce PC');
    const erreurs = evenements.filter((e) => e.type === 'erreur');
    expect(erreurs).toHaveLength(1);
    expect(JSON.stringify(erreurs[0])).toContain('Paramètres › Réseau › Composants');
    expect(session.resume.statut).toBe('erreur');
  });

  test('autre échec : le message d’origine est gardé dans le fil', async () => {
    const { session, evenements } = nouvelleSession(async () => [], { echecDemarrage: 'disque plein' });
    expect(await session.lancer('bonjour')).toContain('disque plein');
    expect(JSON.stringify(evenements.filter((e) => e.type === 'erreur'))).toContain('disque plein');
  });
});
