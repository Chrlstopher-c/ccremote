import { describe, expect, test } from 'bun:test';
import { nomMachineDepuisHote } from './donnees.ts';

describe('identifiant de machine depuis le nom d’hôte', () => {
  test('minuscules et caractères hors [a-z0-9-] remplacés', () => {
    expect(nomMachineDepuisHote('Trinity_Portable')).toBe('trinity-portable');
    expect(nomMachineDepuisHote('-Pi.local-')).toBe('pi-local');
    expect(nomMachineDepuisHote('...')).toBe('ordinateur');
  });
});
