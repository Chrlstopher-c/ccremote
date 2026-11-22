// Protocole de la fédération : ce qui est accepté, ce qui est refusé (champs en trop, identité mal formée, taille).
import { describe, expect, test } from 'bun:test';
import { lireMessageChiffre, lireMessageEnClair, NOMBRE_MAX_DEMANDES } from './federation.ts';

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

  test('la photo des demandes d’appareil et la décision relayée : format strict, plafond de la liste', () => {
    const demande = { id: 'd1', nom: 'iphone', empreinte: 'E1', empreinteLocale: 'L1', le: '2026-11-22T10:00:00.000Z' };
    expect(lireMessageChiffre({ t: 'demandes', liste: [demande] })).not.toBeNull();
    expect(lireMessageChiffre({ t: 'demandes', liste: [{ ...demande, genre: 'appareil' }] })).toBeNull();
    expect(lireMessageChiffre({ t: 'demandes', liste: Array(NOMBRE_MAX_DEMANDES + 1).fill(demande) })).toBeNull();
    expect(lireMessageChiffre({ t: 'decision', id: 'd1', accord: true })).not.toBeNull();
    expect(lireMessageChiffre({ t: 'decision', id: 'd1' })).toBeNull();
  });
});
