// Protocole de la fédération : ce qui est accepté, ce qui est refusé (champs en trop, identité mal formée, taille).
import { describe, expect, test } from 'bun:test';
import { lireMessageChiffre, lireMessageEnClair } from './federation.ts';

const IDENTITE = 'a'.repeat(86);

describe('protocole de la fédération', () => {
  test('la présentation et la poignée passent ; un champ de trop est refusé', () => {
    expect(lireMessageEnClair({ t: 'presentation', identite: IDENTITE, nom: 'tour' })).not.toBeNull();
    expect(lireMessageEnClair({ t: 'presentation', identite: IDENTITE, nom: 'tour', extra: 1 })).toBeNull();
    expect(lireMessageEnClair({ t: 'presentation', identite: 'court', nom: 'tour' })).toBeNull();
    expect(lireMessageEnClair({ t: 'inconnu' })).toBeNull();
  });

  test('les messages chiffrés : écriture et fil, validés ; session vide refusée', () => {
    expect(lireMessageChiffre({ t: 'ecrire', ref: 'r1', session: 's1', texte: 'bonjour' })).not.toBeNull();
    expect(lireMessageChiffre({ t: 'ecrire', ref: 'r1', session: 's1', texte: '' })).toBeNull();
    expect(lireMessageChiffre({ t: 'fil', ref: 'r1', session: '' })).toBeNull();
    expect(lireMessageChiffre({ t: 'revocation' })).not.toBeNull();
  });
});
