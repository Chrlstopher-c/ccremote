/**
 * Tests unitaires de `appellerVllm` — réseau simulé à la frontière (`fetch` remplacé),
 * jamais de vrai serveur ici : c'est le rôle du banc `acceptation/apprentissage-vllm-reel.ts`.
 * Cf. la leçon de session « mock the client at the code boundary » — déterministe, gratuit,
 * teste vraiment le chemin de code plutôt que d'espérer une coïncidence de timing.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { appellerVllm } from './client-vllm.ts';

// `as unknown as typeof fetch` : la doublure de test n'a pas besoin de porter `preconnect`
// (propriété interne du type `fetch` du runtime) — seule la forme appelable compte ici.
const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('appellerVllm (E4)', () => {
  test('url non configurée ⇒ disponible: false, sans appel réseau', async () => {
    let appele = false;
    globalThis.fetch = (() => {
      appele = true;
      throw new Error('ne doit jamais être appelé');
    }) as unknown as typeof fetch;

    const resultat = await appellerVllm({ prompt: 'test', url: '', modele: 'qwen3-8b-awq' });
    expect(resultat.disponible).toBe(false);
    expect(appele).toBe(false);
  });

  test('connexion refusée ⇒ disponible: false après 2 tentatives, jamais d’exception', async () => {
    let appels = 0;
    globalThis.fetch = (() => {
      appels += 1;
      return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8000'));
    }) as unknown as typeof fetch;

    const resultat = await appellerVllm({ prompt: 'test', url: 'http://127.0.0.1:8000', modele: 'qwen3-8b-awq' });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) expect(resultat.motif).toContain('ECONNREFUSED');
    expect(appels).toBe(2);
  });

  test('HTTP 503 ⇒ disponible: false, motif explicite', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('service indisponible', { status: 503 }))) as unknown as typeof fetch;

    const resultat = await appellerVllm({ prompt: 'test', url: 'http://127.0.0.1:8000', modele: 'qwen3-8b-awq' });
    expect(resultat.disponible).toBe(false);
    if (!resultat.disponible) expect(resultat.motif).toContain('503');
  });

  test('réponse 200 valide ⇒ disponible: true, contenu extrait', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 }),
      )) as unknown as typeof fetch;

    const resultat = await appellerVllm({ prompt: 'test', url: 'http://127.0.0.1:8000', modele: 'qwen3-8b-awq' });
    expect(resultat.disponible).toBe(true);
    if (resultat.disponible) expect(resultat.contenu).toBe('[]');
  });

  test('timeout (AbortError) ⇒ disponible: false, jamais d’exception qui remonte', async () => {
    globalThis.fetch = (() => {
      const erreur = new Error('The operation timed out.');
      erreur.name = 'TimeoutError';
      return Promise.reject(erreur);
    }) as unknown as typeof fetch;

    await expect(
      appellerVllm({ prompt: 'test', url: 'http://127.0.0.1:8000', modele: 'qwen3-8b-awq' }),
    ).resolves.toMatchObject({ disponible: false });
  });
});
