/**
 * Protège la panne #20 : plancher Sonnet validé sur l'alias au lieu du modèle
 * résolu. Chaque cas ci-dessous échoue si le défaut est réintroduit.
 */

import { describe, expect, test } from 'bun:test';
import {
  MODEL_FLOOR,
  ModelFloorError,
  ModelResolutionError,
  classifyModel,
  resolveModel,
  resolveModelWithFloor,
} from './model-floor.ts';

describe('classifyModel', () => {
  test('reconnaît les familles depuis un alias ou un identifiant complet', () => {
    expect(classifyModel('haiku')).toBe('haiku');
    expect(classifyModel('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(classifyModel('opusplan')).toBe('opus');
    expect(classifyModel('claude-sonnet-4-6')).toBe('sonnet');
    expect(classifyModel('claude-fable-5')).toBe('fable');
  });

  test('refuse de classer un modèle inconnu plutôt que de deviner', () => {
    expect(classifyModel('default')).toBeNull();
    expect(classifyModel('gpt-nimportequoi')).toBeNull();
  });
});

describe('plancher Sonnet', () => {
  test("refuse 'haiku' demandé explicitement", () => {
    expect(() => resolveModelWithFloor('haiku', 'opus')).toThrow(ModelFloorError);
  });

  test("☠ refuse 'inherit' quand le modèle hérité est haiku", () => {
    // Le défaut historique : valider l'alias 'inherit' au lieu du modèle résolu.
    const model = resolveModel('inherit', 'haiku');
    expect(model.resolved).toBe('haiku');
    expect(model.viaInheritance).toBe(true);
    expect(() => resolveModelWithFloor('inherit', 'haiku')).toThrow(ModelFloorError);
  });

  test("☠ refuse un modèle absent (implicitement hérité) quand l'héritage donne haiku", () => {
    expect(() => resolveModelWithFloor(undefined, 'claude-haiku-4-5')).toThrow(ModelFloorError);
  });

  test("accepte 'inherit' quand le modèle résolu est au-dessus du plancher", () => {
    const model = resolveModelWithFloor('inherit', 'opus');
    expect(model.tier).toBe('opus');
    expect(model.resolved).toBe('opus');
  });

  test('accepte sonnet, opus et fable', () => {
    expect(resolveModelWithFloor('sonnet', null).tier).toBe('sonnet');
    expect(resolveModelWithFloor('opus', null).tier).toBe('opus');
    expect(resolveModelWithFloor('claude-fable-5', null).tier).toBe('fable');
  });

  test('le plancher en vigueur est bien sonnet', () => {
    expect(MODEL_FLOOR).toBe('sonnet');
  });
});

describe('résolution impossible', () => {
  test("échoue quand 'inherit' ne mène à aucun modèle concret", () => {
    expect(() => resolveModel('inherit', null)).toThrow(ModelResolutionError);
    expect(() => resolveModel('inherit', 'default')).toThrow(ModelResolutionError);
  });

  test('échoue sur une famille indéterminable plutôt que de laisser passer', () => {
    expect(() => resolveModel('modele-maison-42', null)).toThrow(ModelResolutionError);
  });
});
