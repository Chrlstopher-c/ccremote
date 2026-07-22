/**
 * Preuve H-73.1 : (a) le rappel est toujours présent quel que soit le mode
 * (couvert aussi par options-composition.test.ts), (b) une demande qui
 * l'atteint parvient réellement au port du bus de permissions, et le régime
 * par défaut (port absent, port en échec, port muet) refuse plutôt que
 * d'accorder ou de bloquer indéfiniment.
 */

import { describe, expect, test } from 'bun:test';
import { buildCanUseTool, CAN_USE_TOOL_PORT_TIMEOUT_MS } from './can-use-tool.ts';
import type { DemandeCanUseTool, VerdictCanUseTool, WorkerSpec } from './types.ts';

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'Tu es team leader.',
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

const OPTIONS_CAN_USE_TOOL = {
  signal: new AbortController().signal,
  toolUseID: 'tool-use-1',
  requestId: 'req-1',
  decisionReason: 'redélivrance après coupure',
  blockedPath: '/tmp/worktree-alpha/secret.env',
  agentID: 'agent-7',
};

describe('buildCanUseTool — routage vers le port (H-73.1 preuve b)', () => {
  test('une demande atteignant canUseTool parvient réellement au port injecté, avec les bons champs', async () => {
    const recues: DemandeCanUseTool[] = [];
    const canUseTool = buildCanUseTool(
      spec({
        portBusPermissions: async (demande) => {
          recues.push(demande);
          return { behavior: 'allow' };
        },
      }),
    );

    const resultat = await canUseTool('Bash', { command: 'ls' }, OPTIONS_CAN_USE_TOOL);

    expect(recues).toHaveLength(1);
    expect(recues[0]).toEqual({
      requestId: 'req-1',
      outil: 'Bash',
      // ☠ Sans l'input, l'arbitre décide sur le seul nom de l'outil : « Bash »
      // n'est pas une demande arbitrable, `Bash({ command: … })` en est une.
      input: { command: 'ls' },
      decisionReason: 'redélivrance après coupure',
      blockedPath: '/tmp/worktree-alpha/secret.env',
      agentId: 'agent-7',
    });
    expect(resultat).toEqual({ behavior: 'allow', updatedInput: undefined, toolUseID: 'tool-use-1' });
  });

  test('un verdict deny du port est retransmis tel quel, message inclus', async () => {
    const verdictPort: VerdictCanUseTool = { behavior: 'deny', message: 'refusé par le bus', interrupt: true };
    const canUseTool = buildCanUseTool(spec({ portBusPermissions: async () => verdictPort }));

    const resultat = await canUseTool('Bash', {}, OPTIONS_CAN_USE_TOOL);

    expect(resultat).toEqual({ behavior: 'deny', message: 'refusé par le bus', interrupt: true, toolUseID: 'tool-use-1' });
  });
});

describe('buildCanUseTool — comportement par défaut sûr', () => {
  test('port absent ⇒ refus explicite, jamais autorisation, message actionnable', async () => {
    const canUseTool = buildCanUseTool(spec());

    const resultat = await canUseTool('Bash', {}, OPTIONS_CAN_USE_TOOL);

    expect(resultat?.behavior).toBe('deny');
    expect((resultat as { message: string }).message.length).toBeGreaterThan(0);
    expect(resultat).toMatchObject({ toolUseID: 'tool-use-1' });
  });

  test('port qui lève ⇒ refus par défaut, ne remonte jamais l’exception à l’appelant', async () => {
    const canUseTool = buildCanUseTool(
      spec({
        portBusPermissions: async () => {
          throw new Error('bus indisponible');
        },
      }),
    );

    const resultat = await canUseTool('Bash', {}, OPTIONS_CAN_USE_TOOL);

    expect(resultat?.behavior).toBe('deny');
  });

  test('☠ port muet (ne résout jamais) ⇒ refus après le délai fixe, jamais de blocage indéfini', async () => {
    const canUseTool = buildCanUseTool(
      spec({
        portBusPermissions: () => new Promise<VerdictCanUseTool>(() => {}),
      }),
    );

    const debut = Date.now();
    const resultat = await canUseTool('Bash', {}, OPTIONS_CAN_USE_TOOL);
    const duree = Date.now() - debut;

    expect(resultat?.behavior).toBe('deny');
    expect(duree).toBeLessThan(CAN_USE_TOOL_PORT_TIMEOUT_MS + 2_000);
  }, CAN_USE_TOOL_PORT_TIMEOUT_MS + 5_000);

  test('jamais d’autorisation implicite : le verdict par défaut est toujours deny, jamais allow', async () => {
    const sansPort = await buildCanUseTool(spec())('Bash', {}, OPTIONS_CAN_USE_TOOL);
    const avecPortEnEchec = await buildCanUseTool(
      spec({ portBusPermissions: async () => { throw new Error('x'); } }),
    )('Bash', {}, OPTIONS_CAN_USE_TOOL);

    expect(sansPort?.behavior).not.toBe('allow');
    expect(avecPortEnEchec?.behavior).not.toBe('allow');
  });
});
