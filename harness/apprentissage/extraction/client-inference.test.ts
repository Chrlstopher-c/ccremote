/**
 * Tests unitaires de `creerClientInference` — SDK simulé par injection (`query`), jamais de
 * vrai réseau ici : c'est le rôle du banc `acceptation/apprentissage-inference-reel.ts`.
 * Cf. la leçon de session « mock the client at the code boundary » — déterministe, gratuit,
 * teste vraiment le chemin de code plutôt que d'espérer une coïncidence de timing.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { creerClientInference, type FonctionQuerySdk } from './client-inference.ts';

/** Doublure minimale d'une `Query` du SDK : un `AsyncIterable<SDKMessage>` suffit ici. */
function fluxDe(messages: readonly SDKMessage[]): ReturnType<FonctionQuerySdk> {
  return (async function* () {
    for (const message of messages) yield message;
  })() as ReturnType<FonctionQuerySdk>;
}

function messageResultSucces(texte: string): SDKMessage {
  return { type: 'result', subtype: 'success', result: texte } as unknown as SDKMessage;
}

function messageResultErreur(): SDKMessage {
  return { type: 'result', subtype: 'error_max_turns' } as unknown as SDKMessage;
}

describe('creerClientInference (E5, remplace client-vllm)', () => {
  test('appel réussi ⇒ disponible: true, contenu extrait du message result', async () => {
    const client = creerClientInference({
      query: () => fluxDe([messageResultSucces('[]')]),
    });
    const resultat = await client.appelerModele({ prompt: 'test' });
    expect(resultat.disponible).toBe(true);
    if (resultat.disponible) expect(resultat.contenu).toBe('[]');
  });

  test('exception SDK (réseau, quota) ⇒ disponible: false après 2 tentatives, jamais d’exception', async () => {
    let appels = 0;
    const client = creerClientInference({
      query: () => {
        appels += 1;
        throw new Error('ECONNREFUSED');
      },
    });
    const resultat = await client.appelerModele({ prompt: 'test' });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) expect(resultat.motif).toContain('ECONNREFUSED');
    expect(appels).toBe(2);
  });

  test('message result d’erreur (sans texte exploitable) ⇒ disponible: false, motif explicite', async () => {
    const client = creerClientInference({ query: () => fluxDe([messageResultErreur()]) });
    const resultat = await client.appelerModele({ prompt: 'test' });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) expect(resultat.motif).toContain('result');
  });

  test('flux vide (aucun result) ⇒ disponible: false, jamais une exception qui remonte', async () => {
    const client = creerClientInference({ query: () => fluxDe([]) });
    await expect(client.appelerModele({ prompt: 'test' })).resolves.toMatchObject({ disponible: false });
  });

  test('configDir et modèle par défaut sont transmis à la requête SDK', async () => {
    const options: { configDir?: string; modele?: string } = {};
    const client = creerClientInference({
      query: (params) => {
        options.modele = params.options?.model;
        options.configDir = (params.options?.env as Record<string, string> | undefined)?.['CLAUDE_CONFIG_DIR'];
        return fluxDe([messageResultSucces('ok')]);
      },
    });
    await client.appelerModele({ prompt: 'test' });
    expect(options.modele).toBe('claude-haiku-4-5-20251001');
    expect(options.configDir).toContain('compte-a');
  });

  test('configDir et modèle explicites remplacent les défauts', async () => {
    const options: { configDir?: string; modele?: string } = {};
    const client = creerClientInference({
      query: (params) => {
        options.modele = params.options?.model;
        options.configDir = (params.options?.env as Record<string, string> | undefined)?.['CLAUDE_CONFIG_DIR'];
        return fluxDe([messageResultSucces('ok')]);
      },
    });
    await client.appelerModele({ prompt: 'test', configDir: '/tmp/autre-compte', modele: 'claude-opus-x' });
    expect(options.modele).toBe('claude-opus-x');
    expect(options.configDir).toBe('/tmp/autre-compte');
  });
});
