import { describe, expect, test } from 'bun:test';
import { detecterFinDeTour } from './detecteur-fin-equipe.ts';

describe('detecterFinDeTour', () => {
  test('running → idle est la fin d’un travail', () => {
    expect(detecterFinDeTour('running', 'idle')).toBe(true);
  });

  test('null → idle ne l’est PAS : premier relevé, le worker n’a rien produit', () => {
    // `☠` Le cas qui ferait annoncer la fin de CHAQUE équipe à sa naissance.
    expect(detecterFinDeTour(null, 'idle')).toBe(false);
  });

  test('requires_action → idle ne l’est pas : une autorisation tranchée, pas un mandat', () => {
    expect(detecterFinDeTour('requires_action', 'idle')).toBe(false);
  });

  test('idle → idle ne l’est pas : un idle stable n’est pas une transition', () => {
    // Sans cette exclusion, chaque passage du balayage (5 s) renotifierait la
    // même fin indéfiniment — une notification par tour, à vie.
    expect(detecterFinDeTour('idle', 'idle')).toBe(false);
  });

  test('idle → running, running → running : rien à signaler', () => {
    expect(detecterFinDeTour('idle', 'running')).toBe(false);
    expect(detecterFinDeTour('running', 'running')).toBe(false);
  });

  test('un état absent du relevé ne déclenche rien', () => {
    // PC muet : `null` signifie « pas mesuré », jamais « terminé ».
    expect(detecterFinDeTour('running', null)).toBe(false);
  });
});
