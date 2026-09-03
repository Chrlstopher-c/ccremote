/**
 * Reliquat A1 : le modèle du MASTER orchestrateur est configurable (contrairement au lead
 * d'équipe et aux exécuteurs, verrouillés). Preuve mécanique : lecture de l'environnement,
 * défaut `opus`, refus AVANT usage d'une valeur non normalisable.
 */
import { describe, expect, test } from 'bun:test';
import {
  MODELE_ORCHESTRATEUR_DEFAUT,
  MODELE_ORCHESTRATEUR_ENV,
  ModeleOrchestrateurInvalideError,
  resoudreModeleOrchestrateur,
} from './options-orchestrateur.ts';

describe('resoudreModeleOrchestrateur', () => {
  test('variable absente ⇒ défaut opus', () => {
    expect(resoudreModeleOrchestrateur({})).toBe(MODELE_ORCHESTRATEUR_DEFAUT);
  });

  test('variable vide ⇒ défaut opus', () => {
    expect(resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: '   ' })).toBe(MODELE_ORCHESTRATEUR_DEFAUT);
  });

  test('alias nu accepté', () => {
    expect(resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: 'sonnet' })).toBe('sonnet');
  });

  test('identifiant complet accepté', () => {
    expect(resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: 'claude-opus-4-8' })).toBe('claude-opus-4-8');
  });

  test('forme langage naturel normalisée (panne « sonnet 5 » du 31/07)', () => {
    expect(resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: 'sonnet 5' })).toBe('claude-sonnet-5');
  });

  test('☠ valeur non reconnaissable ⇒ refus AVANT usage, message actionnable', () => {
    expect(() => resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: 'gpt-5' })).toThrow(
      ModeleOrchestrateurInvalideError,
    );
    try {
      resoudreModeleOrchestrateur({ [MODELE_ORCHESTRATEUR_ENV]: 'gpt-5' });
      throw new Error('devrait avoir levé');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ModeleOrchestrateurInvalideError);
      expect((erreur as Error).message).toContain(MODELE_ORCHESTRATEUR_ENV);
      // Le message doit rendre la liste des valeurs acceptées — actionnable pour un LLM.
      expect((erreur as Error).message).toContain('claude-');
    }
  });
});
