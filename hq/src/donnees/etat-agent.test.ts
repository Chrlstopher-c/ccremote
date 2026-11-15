// Responsabilité : tests de la lecture pure de l'état d'un agent (bloqué, travail, fini, inactif…) et de la durée.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from './contrat';
import { dureeLisible, etatAgent, SEUIL_INACTIVITE_MS, type SessionAgent } from './etat-agent';

const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const il = (decalageMs: number): string => new Date(T0 + decalageMs).toISOString();
const MINUTE = 60_000;

function session(partiel: Partial<ResumeSession>): SessionAgent {
  return { statut: 'attente', majLe: il(0), ...partiel };
}

describe('etatAgent', () => {
  test('une question ou un dialogue en attente est bloquant, même si la session semble travailler', () => {
    expect(etatAgent(session({ statut: 'question' }), T0)).toBe('bloque');
    expect(etatAgent(session({ statut: 'travail', dialogue: dialogueFactice() }), T0)).toBe('bloque');
  });

  test('le bloquant prime sur une inactivité déclarée', () => {
    const s = session({ statut: 'question', inactiveDepuis: il(0), majLe: il(0) });
    expect(etatAgent(s, T0 + 2 * SEUIL_INACTIVITE_MS)).toBe('bloque');
  });

  test('erreur et session fermée ont leur propre état', () => {
    expect(etatAgent(session({ statut: 'erreur' }), T0)).toBe('erreur');
    expect(etatAgent(session({ statut: 'fermee' }), T0)).toBe('eteinte');
  });

  test('démarrage, travail et compaction donnent travail, quelle que soit l ancienneté', () => {
    for (const statut of ['demarrage', 'travail', 'compaction'] as const) {
      expect(etatAgent(session({ statut, majLe: il(-3 * SEUIL_INACTIVITE_MS) }), T0)).toBe('travail');
    }
  });

  test('un tour fini et récent est fini, en attente de Chris', () => {
    expect(etatAgent(session({ statut: 'attente', majLe: il(-MINUTE) }), T0)).toBe('fini');
    expect(etatAgent(session({ statut: 'terminee', majLe: il(-MINUTE) }), T0)).toBe('fini');
  });

  test('la frontière d inactivité : 29 min 59 s reste fini, 30 min bascule en inactif', () => {
    const avant = session({ statut: 'attente', majLe: il(0) });
    expect(etatAgent(avant, T0 + SEUIL_INACTIVITE_MS - 1000)).toBe('fini');
    expect(etatAgent(avant, T0 + SEUIL_INACTIVITE_MS)).toBe('inactive');
  });

  test('inactiveDepuis non nul rend inactif même si le tour est récent', () => {
    const s = session({ statut: 'attente', majLe: il(-MINUTE), inactiveDepuis: il(-MINUTE) });
    expect(etatAgent(s, T0)).toBe('inactive');
  });

  test('inactiveDepuis absent ou null ne rend pas inactif avant le seuil', () => {
    expect(etatAgent(session({ inactiveDepuis: null, majLe: il(-MINUTE) }), T0)).toBe('fini');
    expect(etatAgent(session({ majLe: il(-MINUTE) }), T0)).toBe('fini');
  });

  test('une date de mise à jour illisible ne provoque pas d inactivité', () => {
    expect(etatAgent(session({ majLe: 'pas une date' }), T0)).toBe('fini');
  });
});

describe('dureeLisible', () => {
  const depuis = (ecartMs: number): string => il(-ecartMs);

  test('moins d une minute, puis les minutes entières', () => {
    expect(dureeLisible(depuis(0), T0)).toBe("moins d'1 min");
    expect(dureeLisible(depuis(59_000), T0)).toBe("moins d'1 min");
    expect(dureeLisible(depuis(MINUTE), T0)).toBe('1 min');
    expect(dureeLisible(depuis(4 * MINUTE), T0)).toBe('4 min');
    expect(dureeLisible(depuis(59 * MINUTE + 59_000), T0)).toBe('59 min');
  });

  test('les heures entières, puis les jours', () => {
    expect(dureeLisible(depuis(60 * MINUTE), T0)).toBe('1 h');
    expect(dureeLisible(depuis(2 * 60 * MINUTE), T0)).toBe('2 h');
    expect(dureeLisible(depuis(25 * 60 * MINUTE), T0)).toBe('1 j');
  });

  test('une date future ou illisible ne donne pas une durée négative', () => {
    expect(dureeLisible(il(MINUTE), T0)).toBe("moins d'1 min");
    expect(dureeLisible('n importe quoi', T0)).toBe('—');
  });
});

function dialogueFactice(): NonNullable<ResumeSession['dialogue']> {
  return {
    id: 'd1',
    titre: 'Choix',
    options: [{ libelle: 'Oui', description: '' }],
    multiple: false,
    saisie: null,
    coches: [],
  };
}
