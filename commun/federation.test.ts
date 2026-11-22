// Protocole de la fédération : ce qui est accepté, ce qui est refusé (champs en trop, identité mal formée, taille).
import { describe, expect, test } from 'bun:test';
import { lireMessageChiffre, lireMessageEnClair, NOMBRE_MAX_APPAREILS_ADMIS } from './federation.ts';

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

  test('la photo des admissions : format strict, identifiants de membre, plafond', () => {
    const admis = {
      id: 'a1b2c3d4e5f6',
      nom: 'iphone',
      identite: IDENTITE,
      admisPar: '0123456789ab',
      le: '2026-11-22T10:00:00.000Z',
    };
    expect(lireMessageChiffre({ t: 'admissions', liste: [admis], retires: [] })).not.toBeNull();
    expect(lireMessageChiffre({ t: 'admissions', liste: [], retires: ['a1b2c3d4e5f6'] })).not.toBeNull();
    expect(lireMessageChiffre({ t: 'admissions', liste: [{ ...admis, extra: 1 }], retires: [] })).toBeNull();
    expect(lireMessageChiffre({ t: 'admissions', liste: [{ ...admis, id: 'XYZ' }], retires: [] })).toBeNull();
    expect(lireMessageChiffre({ t: 'admissions', liste: [{ ...admis, identite: 'court' }], retires: [] })).toBeNull();
    const trop = Array(NOMBRE_MAX_APPAREILS_ADMIS + 1).fill(admis);
    expect(lireMessageChiffre({ t: 'admissions', liste: trop, retires: [] })).toBeNull();
    expect(lireMessageChiffre({ t: 'admissions', liste: [] })).toBeNull();
  });
});
