/**
 * Tests directs de `CollecteurTelemetrie` — jusqu'ici testé seulement en creux,
 * via `superviseur-workers.test.ts` et `apprentissage-preserve-telemetrie.test.ts`.
 *
 * Ce fichier couvre spécifiquement `lireParSessionId()`, ajoutée pour
 * `workers/mcp-depense/serveur.ts` (mandat opérateur, 18/08) : un lead ne
 * connaît que son `sessionId`, jamais le `missionId` du registre du Pi.
 *
 * `☠` La garantie qui compte : NON DRAINANTE, même contrat que `lire()` (voir
 * l'en-tête de `collecteur-telemetrie.ts` et `apprentissage-preserve-telemetrie.test.ts`,
 * qui documente le défaut réel provoqué par `tous()` — DRAINANT — utilisée là où
 * une lecture simple suffisait).
 */

import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CollecteurTelemetrie } from './collecteur-telemetrie.ts';

function messageAssistantTexte(sessionId: string, texte: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: texte }] },
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

describe('CollecteurTelemetrie.lireParSessionId', () => {
  test('retrouve la mission par sessionId — clé que le worker connaît, contrairement à missionId', () => {
    const collecteur = new CollecteurTelemetrie();
    collecteur.ouvrir('mission-1', 'session-abc');
    collecteur.poserCout('mission-1', 4.2);
    const vue = collecteur.lireParSessionId('session-abc');
    expect(vue?.missionId).toBe('mission-1');
    expect(vue?.coutUsd).toBe(4.2);
  });

  test('sessionId inconnu ⇒ null, jamais une exception', () => {
    const collecteur = new CollecteurTelemetrie();
    collecteur.ouvrir('mission-1', 'session-abc');
    expect(collecteur.lireParSessionId('session-inconnue')).toBeNull();
  });

  test('☠ NON DRAINANTE : deux lectures consécutives rendent la MÊME file d’activités en attente', () => {
    // `☠` C'est exactement le défaut corrigé le 18/08 (commit 1adff2f) pour
    // `lire()` — cette assertion protège `lireParSessionId()` de la même régression :
    // un appel de consultation (`ma_depense`) ne doit JAMAIS vider ce que le
    // balayage du Pi n'a pas encore eu l'occasion d'écrire en base.
    const collecteur = new CollecteurTelemetrie();
    collecteur.ouvrir('mission-1', 'session-abc');
    collecteur.ingerer('mission-1', messageAssistantTexte('session-abc', 'rapport final du lead'));

    const premiereLecture = collecteur.lireParSessionId('session-abc');
    const activiteApresPremiere = premiereLecture?.activitesEnAttente.find((a) => a.texte === 'rapport final du lead');
    expect(activiteApresPremiere).toBeDefined();

    const secondeLecture = collecteur.lireParSessionId('session-abc');
    const activiteApresSeconde = secondeLecture?.activitesEnAttente.find((a) => a.texte === 'rapport final du lead');
    // Si cette assertion échoue, `lireParSessionId` draine — la MÊME activité que
    // le balayage périodique du Pi doit encore trouver a disparu au second appel.
    expect(activiteApresSeconde).toBeDefined();

    // Et le drain LÉGITIME (`tous()`, réservé au balayage périodique) reste intact :
    // une fois QU'IL passe, la file est bien vidée pour de vrai.
    const drainee = collecteur.tous();
    expect(drainee.find((t) => t.missionId === 'mission-1')?.activitesEnAttente).toHaveLength(1);
    const apresDrain = collecteur.lireParSessionId('session-abc');
    expect(apresDrain?.activitesEnAttente).toHaveLength(0);
  });
});
