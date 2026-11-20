import { describe, expect, test } from 'bun:test';
import { modeleEffectif, nomAffiche, nomLisibleModele, type ModeleSdk } from './modele-affiche.ts';

const LISTE_AVEC_DEFAUT: readonly ModeleSdk[] = [
  { value: 'default', resolvedModel: 'claude-haiku-5-5', displayName: 'Default (recommended)' },
  { value: 'claude-haiku-5-5', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
  { value: 'claude-mythos-5-2', displayName: 'Mythos 5.2' },
];

describe('nomLisibleModele', () => {
  test('un identifiant se lit en nom français : claude- retiré, mots capitalisés, chiffres joints', () => {
    expect(nomLisibleModele('claude-haiku-5-5')).toBe('Haiku 5.5');
    expect(nomLisibleModele('claude-mythos-5-2')).toBe('Mythos 5.2');
  });

  test('une date de build en fin d identifiant ne s affiche pas', () => {
    expect(nomLisibleModele('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });
});

describe('nomAffiche', () => {
  test('le défaut du compte se nomme d après le modèle qu il résout, jamais d après le libellé anglais du SDK', () => {
    expect(nomAffiche('défaut', LISTE_AVEC_DEFAUT)).toBe('Haiku 5.5');
  });

  test('un modèle choisi se nomme par son identifiant, même si la liste le donne sous un autre alias', () => {
    expect(nomAffiche('claude-haiku-5-5', LISTE_AVEC_DEFAUT)).toBe('Haiku 5.5');
    expect(nomAffiche('claude-mythos-5-2', LISTE_AVEC_DEFAUT)).toBe('Mythos 5.2');
  });

  test('un modèle absent de la liste n a pas de nom : Lanterne dérive', () => {
    expect(nomAffiche('claude-inconnu-1-0', LISTE_AVEC_DEFAUT)).toBeNull();
  });

  test('défaut sans entrée default ni liste : pas de nom, aucune étiquette anglaise', () => {
    expect(nomAffiche('défaut', undefined)).toBeNull();
    expect(modeleEffectif('défaut', [{ value: 'default', displayName: 'Default (recommended)' }])).toBeNull();
  });
});
