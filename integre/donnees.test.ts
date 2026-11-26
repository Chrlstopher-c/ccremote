import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nomMachineDepuisHote, preparerDonnees } from './donnees.ts';

describe('identifiant de machine depuis le nom d’hôte', () => {
  test('minuscules et caractères hors [a-z0-9-] remplacés', () => {
    expect(nomMachineDepuisHote('Trinity_Portable')).toBe('trinity-portable');
    expect(nomMachineDepuisHote('-Pi.local-')).toBe('pi-local');
    expect(nomMachineDepuisHote('...')).toBe('ordinateur');
  });
});

describe('journal du moteur', () => {
  test('le journal du lancement précédent est gardé, le nouveau repart vide', () => {
    const racine = mkdtempSync(join(tmpdir(), 'donnees-moteur-'));
    const premier = preparerDonnees(racine, 'essai');
    writeFileSync(premier.journal, 'plantage\n');
    const second = preparerDonnees(racine, 'essai');
    expect(readFileSync(second.journal, 'utf8')).toBe('');
    expect(readFileSync(join(racine, 'journal/moteur.precedent.log'), 'utf8')).toBe('plantage\n');
  });
});
