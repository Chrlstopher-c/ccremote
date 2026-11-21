// Responsabilité : tests des codes d'appairage — forme, usage unique, expiration, essais faux.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { ALPHABET_CODE, DUREE_CODE_MS, ESSAIS_CODE_MAX, LONGUEUR_CODE } from '../../commun/duo.ts';
import { CodesAppairage } from './codes.ts';

function horloge(depart = 1_000_000) {
  let t = depart;
  return { lire: () => t, avancer: (ms: number) => void (t += ms) };
}

describe('codes d’appairage', () => {
  test('8 caractères du bon alphabet, expiration à 10 min', () => {
    const h = horloge();
    const codes = new CodesAppairage(h.lire);
    const { code, expireLe } = codes.creer();
    expect(code).toHaveLength(LONGUEUR_CODE);
    for (const c of code) expect(ALPHABET_CODE).toContain(c);
    expect(Date.parse(expireLe)).toBe(h.lire() + DUREE_CODE_MS);
  });

  test('usage unique : le second essai est refusé', () => {
    const codes = new CodesAppairage(horloge().lire);
    const { code } = codes.creer();
    expect(codes.consommer(code)).toBe('ok');
    expect(codes.consommer(code)).toBe('utilise');
  });

  test('expiré après 10 min', () => {
    const h = horloge();
    const codes = new CodesAppairage(h.lire);
    const { code } = codes.creer();
    h.avancer(DUREE_CODE_MS);
    expect(codes.consommer(code)).toBe('expire');
  });

  test('faux, et brûlé après trop d’essais faux', () => {
    const codes = new CodesAppairage(horloge().lire);
    const { code } = codes.creer();
    for (let i = 0; i < ESSAIS_CODE_MAX; i++) expect(codes.consommer('ZZZZZZZZ')).toBe('faux');
    expect(codes.consommer(code)).toBe('faux');
  });

  test('la saisie minuscule est acceptée', () => {
    const codes = new CodesAppairage(horloge().lire);
    const { code } = codes.creer();
    expect(codes.consommer(code.toLowerCase())).toBe('ok');
  });
});
