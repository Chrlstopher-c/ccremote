import { describe, expect, test } from 'bun:test';
import type { TerminalReason } from '@anthropic-ai/claude-agent-sdk';
import { classifierTerminaison, raisonsConnues } from './classification.ts';
import type { GroupeTerminaison } from './types.ts';

// Table de référence copiée depuis Upgrade/05-arbre-B-workers.md § B.3.2 (mon fichier de
// branche). Un test qui compare terme à terme contre le texte de la mission, pas contre
// l'implémentation : s'il diverge un jour de la doc, c'est ce test qui doit le révéler.
const TABLE_MISSION: Readonly<Record<GroupeTerminaison, readonly TerminalReason[]>> = {
  fin_normale: ['completed'],
  borne_atteinte: ['max_turns', 'budget_exhausted'],
  volontaire: ['aborted_streaming', 'aborted_tools', 'hook_stopped', 'stop_hook_prevented', 'background_requested'],
  transitoire: ['api_error', 'model_error', 'turn_setup_failed'],
  structurel: ['prompt_too_long', 'malformed_tool_use_exhausted', 'structured_output_retry_exhausted'],
  quota: ['blocking_limit', 'rapid_refill_breaker'],
  non_couverte: [],
};

describe('classifierTerminaison — table de B.3.2', () => {
  for (const [groupe, raisons] of Object.entries(TABLE_MISSION) as [GroupeTerminaison, TerminalReason[]][]) {
    for (const raison of raisons) {
      test(`${raison} ⇒ groupe ${groupe}`, () => {
        const classification = classifierTerminaison(raison);
        expect(classification.groupe).toBe(groupe);
        expect(classification.raisonConnue).toBe(raison);
      });
    }
  }

  test('les 19 valeurs vérifiées du SDK sont toutes classifiables sans exception', () => {
    for (const raison of raisonsConnues()) {
      expect(() => classifierTerminaison(raison)).not.toThrow();
    }
    expect(raisonsConnues().length).toBe(19);
  });

  test('seul le groupe transitoire est relançable (acceptation b/c)', () => {
    for (const raison of raisonsConnues()) {
      const classification = classifierTerminaison(raison);
      if (classification.groupe === 'transitoire') {
        expect(classification.relancable).toBe(true);
      } else {
        expect(classification.relancable).toBe(false);
      }
    }
  });
});

describe('classifierTerminaison — piège des raisons connues mais non couvertes par la table', () => {
  // ☠ CASSE documenté : ces trois valeurs existent bien dans TerminalReason (sdk.d.ts),
  // mais B.3.2 ne les place dans aucun des six groupes. Les traiter comme un cas générique
  // serait la taxonomie maison interdite par la mission.
  test.each(['image_error', 'tool_deferred', 'tool_deferred_unavailable'] as const)(
    '%s est connue du SDK mais classifiée non_couverte, jamais relançable',
    (raison) => {
      const classification = classifierTerminaison(raison);
      expect(classification.raisonConnue).toBe(raison);
      expect(classification.groupe).toBe('non_couverte');
      expect(classification.relancable).toBe(false);
    },
  );
});

describe('classifierTerminaison — raisons absentes ou inconnues du SDK', () => {
  test('undefined est journalisé tel quel, jamais relancé', () => {
    const classification = classifierTerminaison(undefined);
    expect(classification.raisonBrute).toBe('(absente)');
    expect(classification.raisonConnue).toBeNull();
    expect(classification.groupe).toBe('non_couverte');
    expect(classification.relancable).toBe(false);
  });

  test('une valeur qui n\'existe pas dans TerminalReason est journalisée telle quelle, jamais relancée', () => {
    const classification = classifierTerminaison('une_raison_future_du_sdk');
    expect(classification.raisonBrute).toBe('une_raison_future_du_sdk');
    expect(classification.raisonConnue).toBeNull();
    expect(classification.groupe).toBe('non_couverte');
    expect(classification.relancable).toBe(false);
  });
});
