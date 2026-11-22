import { describe, expect, test } from 'bun:test';
import { distantsDeDepart } from './config.ts';

const COMPTES = { principal: null, travail: '~/.claude-travail' };
const AUTONOME = { LANTERNE_MOTEUR_AUTONOME: '1' };

describe('comptes suivis en Remote Control au démarrage', () => {
  test('nœud autonome sans liste écrite : tous ses comptes sont suivis', () => {
    expect(distantsDeDepart({ distants: [], comptes: COMPTES }, { machine: 'tour' }, AUTONOME)).toEqual([
      'principal',
      'travail',
    ]);
  });

  test('une liste écrite fait foi, même vide', () => {
    expect(distantsDeDepart({ distants: [], comptes: COMPTES }, { distants: [] }, AUTONOME)).toEqual([]);
    expect(distantsDeDepart({ distants: ['travail'], comptes: COMPTES }, { distants: ['travail'] }, AUTONOME)).toEqual(
      ['travail'],
    );
  });

  test('hors mode autonome, aucun compte sans liste écrite (défaut)', () => {
    expect(distantsDeDepart({ distants: [], comptes: COMPTES }, { machine: 'portable' }, {})).toEqual([]);
  });
});
