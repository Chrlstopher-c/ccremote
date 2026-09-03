/**
 * C2 — sur un compte DÉJÀ constaté en surcoût payant, le dispatch doit échouer
 * proprement (refus AVANT écriture), jamais basculer en payant silencieusement.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { assertCompteNonEnSurcoutPayant, compteEnSurcoutPayant, ErreurCompteEnSurcoutPayant } from './garde-surcout-payant.ts';

let repertoire: string;
let registre: Registre;
const T = 1_785_000_000_000;

function poserQuota(compteId: string, overage: boolean): void {
  registre.comptes.releverQuota({
    compteId,
    typeFenetre: 'five_hour',
    statut: 'allowed',
    utilisation: 50,
    resetA: T + 2 * 3_600_000,
    utiliseOverage: overage,
    observeA: T,
  });
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'garde-surcout-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('compteEnSurcoutPayant', () => {
  test('aucun relevé de quota : jamais en surcoût (rien à constater)', () => {
    expect(compteEnSurcoutPayant(registre, 'compte-a')).toBe(false);
  });

  test('quota relevé sans overage : pas en surcoût', () => {
    poserQuota('compte-a', false);
    expect(compteEnSurcoutPayant(registre, 'compte-a')).toBe(false);
  });

  test('☠ quota relevé EN overage : constaté en surcoût payant', () => {
    poserQuota('compte-a', true);
    expect(compteEnSurcoutPayant(registre, 'compte-a')).toBe(true);
  });
});

describe('assertCompteNonEnSurcoutPayant (C2)', () => {
  test('compte sain : silencieux', () => {
    poserQuota('compte-a', false);
    expect(() => assertCompteNonEnSurcoutPayant(registre, 'compte-a')).not.toThrow();
  });

  test('☠ compte en surcoût payant : échec propre, PAS une continuation en payant silencieux', () => {
    poserQuota('compte-a', true);
    expect(() => assertCompteNonEnSurcoutPayant(registre, 'compte-a')).toThrow(ErreurCompteEnSurcoutPayant);
    try {
      assertCompteNonEnSurcoutPayant(registre, 'compte-a');
      throw new Error('devrait avoir levé');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurCompteEnSurcoutPayant);
      expect((erreur as Error).message).toContain('SURCOÛT PAYANT');
      expect((erreur as ErreurCompteEnSurcoutPayant).compteId).toBe('compte-a');
    }
  });

  test('compte inconnu du registre (aucun quota) : silencieux — cette garde ne constate que ce qui est mesuré', () => {
    expect(() => assertCompteNonEnSurcoutPayant(registre, 'compte-inconnu')).not.toThrow();
  });
});
