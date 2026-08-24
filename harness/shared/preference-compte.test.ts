/**
 * Tests de la règle de choix manuel de compte.
 *
 * L'invariant qui compte, et qui a motivé le module : VERROUILLÉ, la saturation
 * ne fait PAS basculer. Le reste (préférence absente, compte disparu, saturation
 * hors verrou) doit rendre exactement le comportement automatique d'avant — une
 * préférence inapplicable ne doit jamais paralyser le harness.
 */

import { describe, expect, test } from 'bun:test';
import { resoudrePreference, validerPreference, type CompteValidable } from './preference-compte.ts';

const COMPTES = ['compte-a', 'compte-b', 'compte-c'];
const idDe = (c: string): string => c;
const SATURES = new Set(['compte-b']);
const estSature = (c: string): boolean => SATURES.has(c);

describe('resoudrePreference', () => {
  test('aucune préférence : l’automatique décide, motif nommé', () => {
    const r = resoudrePreference(COMPTES, idDe, { compteId: null, verrouille: false }, estSature);
    expect(r).toEqual({ mode: 'automatique', motif: 'aucune-preference' });
  });

  test('préférence sur un compte sain : ce compte, sans verrou', () => {
    const r = resoudrePreference(COMPTES, idDe, { compteId: 'compte-c', verrouille: false }, estSature);
    expect(r).toEqual({ mode: 'preferee', index: 2, verrouille: false });
  });

  test('SANS verrou, un compte saturé rend la main à l’automatique', () => {
    const r = resoudrePreference(COMPTES, idDe, { compteId: 'compte-b', verrouille: false }, estSature);
    expect(r).toEqual({ mode: 'automatique', motif: 'compte-prefere-sature-et-non-verrouille' });
  });

  test('AVEC verrou, un compte saturé reste choisi — c’est tout l’objet du verrou', () => {
    const r = resoudrePreference(COMPTES, idDe, { compteId: 'compte-b', verrouille: true }, estSature);
    expect(r).toEqual({ mode: 'preferee', index: 1, verrouille: true });
  });

  test('compte disparu de l’inventaire : automatique, même verrouillé — jamais de paralysie', () => {
    const r = resoudrePreference(COMPTES, idDe, { compteId: 'compte-z', verrouille: true }, estSature);
    expect(r).toEqual({ mode: 'automatique', motif: 'compte-prefere-absent-de-la-liste' });
  });

  test('un candidat sans identité lisible n’est jamais pris pour le compte préféré', () => {
    const r = resoudrePreference(['dossier-muet'], () => null, { compteId: 'compte-a', verrouille: true }, estSature);
    expect(r.mode).toBe('automatique');
  });
});

const CONNUS: readonly CompteValidable[] = [
  { id: 'compte-a', email: 'a@ex.com', jetonExpireA: 4_000 },
  { id: 'compte-b', email: 'b@ex.com', jetonExpireA: 1_000 },
  { id: 'compte-c', email: null, jetonExpireA: null },
];
const MAINTENANT = 2_000;

describe('validerPreference', () => {
  test('null est toujours accepté : c’est le retour à l’automatique', () => {
    expect(validerPreference(null, CONNUS, MAINTENANT)).toEqual({ ok: true, avertissement: null });
  });

  test('compte connu et jeton valide : accepté sans réserve', () => {
    expect(validerPreference('compte-a', CONNUS, MAINTENANT)).toEqual({ ok: true, avertissement: null });
  });

  test('compte inconnu : REFUSÉ, et le refus porte les valeurs acceptées', () => {
    const v = validerPreference('sonnet 5', CONNUS, MAINTENANT);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('refus attendu');
    expect(v.raison).toContain('compte-a, compte-b, compte-c');
    expect(v.raison).toContain('null');
  });

  test('aucun compte enregistré : refus qui dit la vraie cause', () => {
    const v = validerPreference('compte-a', [], MAINTENANT);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('refus attendu');
    expect(v.raison).toContain('aucun compte');
  });

  test('jeton EXPIRÉ : accepté avec réserve — un verdict de fenêtre ne survit pas à la fenêtre', () => {
    const v = validerPreference('compte-b', CONNUS, MAINTENANT);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('acceptation attendue');
    expect(v.avertissement).toContain('expiré');
  });

  test('jeton JAMAIS relevé : accepté, mais le risque réel est dit', () => {
    const v = validerPreference('compte-c', CONNUS, MAINTENANT);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('acceptation attendue');
    expect(v.avertissement).toContain('jamais été relevé');
  });
});
