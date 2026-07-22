/**
 * Tests d'intégration de la discipline de contexte sur la surface réelle du SDK
 * (hooks PreCompact/PostCompact, message SDKCompactBoundaryMessage) — A.1.4.
 */
import { describe, expect, test } from 'bun:test';
import { SentinelleContexte } from '../../../discipline-contexte/index.ts';
import { creerHooksContexte, ingererMessageContexte, SourceContexteDifferee } from './contexte-integration.ts';

function sentinelleTest(): SentinelleContexte {
  const source = new SourceContexteDifferee();
  return new SentinelleContexte(source);
}

describe('creerHooksContexte', () => {
  test('expose PreCompact et PostCompact, rien d’autre', () => {
    const hooks = creerHooksContexte(sentinelleTest());
    expect(Object.keys(hooks).sort()).toEqual(['PostCompact', 'PreCompact']);
  });

  test('PreCompact observe la compaction et alimente le résumé', async () => {
    const sentinelle = sentinelleTest();
    const hooks = creerHooksContexte(sentinelle);
    const callback = hooks.PreCompact?.[0]?.hooks[0];
    await callback?.({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null } as never, 'tu1', {
      signal: new AbortController().signal,
    });
    expect(sentinelle.resume().dernierEvenementCompaction?.trigger).toBe('auto');
  });

  test('un hook mal aiguillé (mauvais hook_event_name) ne fait rien — narrowing strict', async () => {
    const sentinelle = sentinelleTest();
    const hooks = creerHooksContexte(sentinelle);
    const callback = hooks.PreCompact?.[0]?.hooks[0];
    const resultat = await callback?.(
      { hook_event_name: 'PostToolUse', tool_name: 'x' } as never,
      'tu1',
      { signal: new AbortController().signal },
    );
    expect(resultat).toEqual({});
    expect(sentinelle.resume().dernierEvenementCompaction).toBeNull();
  });
});

describe('ingererMessageContexte', () => {
  test('SDKCompactBoundaryMessage alimente le résumé avec les tokens', () => {
    const sentinelle = sentinelleTest();
    ingererMessageContexte(sentinelle, {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 1000, post_tokens: 200 },
    } as never);
    const resume = sentinelle.resume();
    expect(resume.dernierEvenementCompaction?.trigger).toBe('manual');
  });

  test('tout autre message est ignoré silencieusement, jamais une exception', () => {
    const sentinelle = sentinelleTest();
    expect(() => ingererMessageContexte(sentinelle, { type: 'user' } as never)).not.toThrow();
    expect(sentinelle.resume().dernierEvenementCompaction).toBeNull();
  });
});

describe('SourceContexteDifferee', () => {
  test('lève tant que .query n’est pas posé — jamais un getContextUsage silencieusement faux', () => {
    const source = new SourceContexteDifferee();
    expect(() => source.getContextUsage()).toThrow();
  });
});
