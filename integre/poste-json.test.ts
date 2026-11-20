import { describe, expect, test } from 'bun:test';
import { champsConserves } from './poste-json.ts';

describe('poste.json du moteur intégré', () => {
  test('garde les comptes et les comptes suivis par Remote Control', () => {
    const texte = JSON.stringify({ machine: 'x', comptes: { principal: null, pro: '/d/pro' }, distants: ['pro'] });
    expect(champsConserves(texte)).toEqual({ comptes: { principal: null, pro: '/d/pro' }, distants: ['pro'] });
  });
  test('ignore le reste, un fichier absent ou illisible', () => {
    expect(champsConserves(JSON.stringify({ machine: 'x', relais: 'ws://' }))).toEqual({});
    expect(champsConserves(null)).toEqual({});
    expect(champsConserves('{')).toEqual({});
  });
});
