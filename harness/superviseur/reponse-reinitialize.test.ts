/**
 * Lecture défensive de `reinitialize()` — `⚠ HYP` : le type public
 * `SDKControlInitializeResponse` ne déclare pas `pending_permission_requests`.
 * Ces tests couvrent les deux lectures possibles sans en privilégier aucune :
 * absent ⇒ `[]` sans exception ; présent au runtime ⇒ exploité.
 */

import { describe, expect, test } from 'bun:test';
import { extraireDemandesEnAttente } from './reponse-reinitialize.ts';

describe('extraireDemandesEnAttente', () => {
  test('réponse conforme au type public (champ absent) ⇒ liste vide, jamais une exception', () => {
    expect(extraireDemandesEnAttente({ commands: [], agents: [], models: [] })).toEqual([]);
  });

  test('valeurs dégénérées ⇒ liste vide, jamais une exception', () => {
    expect(extraireDemandesEnAttente(null)).toEqual([]);
    expect(extraireDemandesEnAttente(undefined)).toEqual([]);
    expect(extraireDemandesEnAttente('texte')).toEqual([]);
    expect(extraireDemandesEnAttente(42)).toEqual([]);
  });

  test('présent au runtime (lecture (b) de l’HYP) : can_use_tool ⇒ outil = tool_name', () => {
    const brut = {
      pending_permission_requests: [
        { type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } },
      ],
    };
    expect(extraireDemandesEnAttente(brut)).toEqual([{ requestId: 'req-1', outil: 'Bash' }]);
  });

  test('subtype autre que can_use_tool ⇒ outil = subtype lui-même, jamais inventé', () => {
    const brut = {
      pending_permission_requests: [
        { type: 'control_request', request_id: 'req-2', request: { subtype: 'request_user_dialog' } },
      ],
    };
    expect(extraireDemandesEnAttente(brut)).toEqual([{ requestId: 'req-2', outil: 'request_user_dialog' }]);
  });

  test('entrées malformées ignorées individuellement, jamais une exception globale', () => {
    const brut = {
      pending_permission_requests: [
        { request_id: 'req-valide', request: { subtype: 'can_use_tool', tool_name: 'Read' } },
        { request: { subtype: 'can_use_tool' } }, // pas de request_id : ignorée
        null,
        'texte',
      ],
    };
    expect(extraireDemandesEnAttente(brut)).toEqual([{ requestId: 'req-valide', outil: 'Read' }]);
  });

  test('pending_permission_requests qui n’est pas un tableau ⇒ liste vide', () => {
    expect(extraireDemandesEnAttente({ pending_permission_requests: 'pas un tableau' })).toEqual([]);
  });
});
