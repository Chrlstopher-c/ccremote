// Responsabilité : tests unitaires du relais Claude (chemins, en-têtes, bêta OAuth, erreurs, schémas du protocole,
// lecture de la consommation dans un flux SSE ou un corps JSON).
import { describe, expect, test } from 'bun:test';
import { ClaudeRequete, cheminPermis, entetesRequete, erreurAnthropic, fusionnerBeta } from './relais-claude.ts';
import { AnalyseConsommation } from './relais-claude-usage.ts';

describe('chemins permis', () => {
  test('messages et count_tokens, avec ou sans beta=true seulement', () => {
    expect(cheminPermis('/v1/messages')).toBe(true);
    expect(cheminPermis('/v1/messages?beta=true')).toBe(true);
    expect(cheminPermis('/v1/messages/count_tokens?beta=true')).toBe(true);
    expect(cheminPermis('/v1/models')).toBe(false);
    expect(cheminPermis('/v1/messages/../models')).toBe(false);
    expect(cheminPermis('/v1/messages?x=1')).toBe(false);
  });
});

describe('en-têtes', () => {
  test('liste blanche, noms en minuscules ; jamais d’authentification du client', () => {
    const lus = entetesRequete([
      ['Anthropic-Beta', 'claude-code-20250219'],
      ['Authorization', 'Bearer jeton-local'],
      ['x-api-key', 'sk-local'],
      ['X-Claude-Code-Session-Id', 'abc'],
      ['cookie', 'session=1'],
    ]);
    expect(lus).toEqual({ 'anthropic-beta': 'claude-code-20250219', 'x-claude-code-session-id': 'abc' });
  });

  test('la bêta OAuth s’ajoute une fois, sans toucher aux autres', () => {
    expect(fusionnerBeta(undefined)).toBe('oauth-2025-04-20');
    expect(fusionnerBeta('claude-code-20250219, interleaved-thinking-2025-05-14')).toBe(
      'claude-code-20250219,interleaved-thinking-2025-05-14,oauth-2025-04-20',
    );
    expect(fusionnerBeta('oauth-2025-04-20,x')).toBe('oauth-2025-04-20,x');
  });
});

describe('erreurs au format Anthropic', () => {
  test('type et message dans error', () => {
    expect(JSON.parse(erreurAnthropic('permission_error', 'modèle non permis'))).toEqual({
      type: 'error',
      error: { type: 'permission_error', message: 'modèle non permis' },
    });
  });
});

describe('schéma de la requête relayée', () => {
  const base = {
    t: 'claude_requete',
    ref: 'r1',
    methode: 'POST',
    chemin: '/v1/messages?beta=true',
    entetes: { 'anthropic-beta': 'claude-code-20250219' },
  };

  test('accepte un chemin de l’API et une liste blanche', () => {
    expect(ClaudeRequete.safeParse(base).success).toBe(true);
  });

  test('refuse un chemin hors /v1/ et un en-tête non permis', () => {
    expect(ClaudeRequete.safeParse({ ...base, chemin: '/api/sessions' }).success).toBe(false);
    expect(ClaudeRequete.safeParse({ ...base, entetes: { authorization: 'Bearer x' } }).success).toBe(false);
  });
});

describe('consommation lue dans la réponse', () => {
  test('flux SSE : entrée au début du message, sortie cumulée à la fin, coupé en morceaux', () => {
    const analyse = new AnalyseConsommation(true);
    const texte =
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-5-5",' +
      '"usage":{"input_tokens":120,"output_tokens":1}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":45}}\n\n';
    const octets = new TextEncoder().encode(texte);
    analyse.ajouter(octets.subarray(0, 37));
    analyse.ajouter(octets.subarray(37));
    expect(analyse.bilan()).toEqual({ entree: 120, sortie: 45, modele: 'claude-haiku-5-5' });
  });

  test('corps JSON : usage et modèle du message', () => {
    const analyse = new AnalyseConsommation(false);
    analyse.ajouter(
      new TextEncoder().encode(
        JSON.stringify({ model: 'claude-sonnet-5', usage: { input_tokens: 7, output_tokens: 9 } }),
      ),
    );
    expect(analyse.bilan()).toEqual({ entree: 7, sortie: 9, modele: 'claude-sonnet-5' });
  });

  test('rien d’exploitable : zéro, modèle absent', () => {
    expect(new AnalyseConsommation(true).bilan()).toEqual({ entree: 0, sortie: 0, modele: null });
  });
});
