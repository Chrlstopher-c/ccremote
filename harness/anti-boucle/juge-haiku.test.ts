/**
 * `☠` Ces tests injectent TOUJOURS une doublure de `AntiBoucleQueryFn` — jamais
 * `sdkQuery` réel. Aucun appel réseau ne doit jamais partir d'ici (H-68, règle
 * d'architecture non négociable : l'appel réel vit strictement dans `juge-haiku.ts`,
 * jamais dans du code partagé avec la doublure).
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { creerJugeHaiku, MODELE_JUGE_PAR_DEFAUT } from './juge-haiku.ts';
import type { AntiBoucleQueryFn, ContexteJugement, SignauxBoucle } from './types.ts';

const CONTEXTE: ContexteJugement = { missionId: 'm-1', palierUsd: 12, coutCourantUsd: 12.4 };

const SIGNAUX_VIDES: SignauxBoucle = {
  nombreTours: 0,
  outilsMemeCible: [],
  erreurRepetee: null,
  toursSansModification: 0,
  testsEchouantIdentique: [],
  reecritureAlternee: [],
};

/**
 * Fixture minimale d'un `SDKResultMessage` de succès. Cast justifié : seuls les champs
 * réellement lus par `juge-haiku.ts` (`type`, `subtype`, `result`, `structured_output`)
 * comptent en test ; reproduire l'intégralité du type public (usage/modelUsage réels)
 * n'apporterait rien à la couverture visée ici.
 */
function messageResultatSucces(resultTexte: string, structuredOutput?: unknown): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    result: resultTexte,
    structured_output: structuredOutput,
    is_error: false,
    num_turns: 1,
    duration_ms: 10,
    duration_api_ms: 10,
    stop_reason: null,
    total_cost_usd: 0.001,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: 'u-1',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function queryFactice(messages: readonly SDKMessage[]): AntiBoucleQueryFn {
  return () =>
    (async function* generateur(): AsyncGenerator<SDKMessage, void> {
      for (const message of messages) yield message;
    })() as unknown as Query;
}

describe('creerJugeHaiku', () => {
  test('parse un verdict « boucle » structuré', async () => {
    const juge = creerJugeHaiku({
      query: queryFactice([messageResultatSucces('', { verdict: 'boucle', motif: 'mêmes outils répétés' })]),
    });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('boucle');
    expect(verdict.motif).toContain('répétés');
  });

  test('parse un verdict via `result` texte JSON si `structured_output` absent', async () => {
    const juge = creerJugeHaiku({
      query: queryFactice([messageResultatSucces(JSON.stringify({ verdict: 'progres', motif: 'fichiers modifiés' }))]),
    });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('progres');
  });

  test("☠ verdict invalide reçu ⇒ repli sur incertain, JAMAIS boucle (biais asymétrique)", async () => {
    const juge = creerJugeHaiku({
      query: queryFactice([messageResultatSucces('', { verdict: 'pas-un-verdict', motif: 'x' })]),
    });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('incertain');
  });

  test("☠ flux qui lève une exception ⇒ repli sur incertain, JAMAIS boucle", async () => {
    const query: AntiBoucleQueryFn = () =>
      (async function* (): AsyncGenerator<SDKMessage, void> {
        throw new Error('panne réseau simulée');
      })() as unknown as Query;
    const juge = creerJugeHaiku({ query });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('incertain');
  });

  test("☠ flux fermé sans message result exploitable ⇒ repli sur incertain", async () => {
    const juge = creerJugeHaiku({ query: queryFactice([]) });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('incertain');
  });

  test("☠ timeout ⇒ repli sur incertain, jamais un blocage indéfini", async () => {
    const query: AntiBoucleQueryFn = () =>
      (async function* (): AsyncGenerator<SDKMessage, void> {
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield messageResultatSucces('', { verdict: 'boucle', motif: 'trop tard' });
      })() as unknown as Query;
    const juge = creerJugeHaiku({ query, timeoutMs: 5 });
    const verdict = await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(verdict.verdict).toBe('incertain');
  });

  test('modèle par défaut est bien Haiku, transmis aux options', async () => {
    let modelRecu: string | undefined;
    const query: AntiBoucleQueryFn = (params) => {
      modelRecu = params.options?.model;
      return (async function* (): AsyncGenerator<SDKMessage, void> {
        yield messageResultatSucces('', { verdict: 'progres', motif: 'ok' });
      })() as unknown as Query;
    };
    const juge = creerJugeHaiku({ query });
    await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(modelRecu).toBe(MODELE_JUGE_PAR_DEFAUT);
  });

  test('aucun outil ouvert au juge (bon marché, pas d’effet de bord)', async () => {
    let toolsRecus: unknown;
    const query: AntiBoucleQueryFn = (params) => {
      toolsRecus = params.options?.tools;
      return (async function* (): AsyncGenerator<SDKMessage, void> {
        yield messageResultatSucces('', { verdict: 'progres', motif: 'ok' });
      })() as unknown as Query;
    };
    const juge = creerJugeHaiku({ query });
    await juge.juger(SIGNAUX_VIDES, CONTEXTE);
    expect(toolsRecus).toEqual([]);
  });
});
