/**
 * Tests de la persistance du choix manuel de compte (migration 34).
 *
 * L'invariant qui compte : le réglage SURVIT au redémarrage du Pi. C'est
 * exactement le défaut qui a coûté l'incident du 23/07 documenté dans
 * `choix-compte-orchestrateur.ts` — l'index de rotation vivait en mémoire et
 * repartait à zéro à chaque déploiement.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from './index.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/c/a', email: 'a@ex.com' });
  registre.comptes.enregistrer({ id: 'compte-b', configDir: '/c/b', email: 'b@ex.com' });
});

afterEach(() => registre.fermer());

describe('préférence de compte', () => {
  test('registre neuf : aucune préférence, jamais un null global', () => {
    expect(registre.comptes.lirePreference()).toEqual({ compteId: null, verrouille: false, majA: 0 });
  });

  test('choix simple puis verrouillage', () => {
    registre.comptes.definirPreference('compte-a', false, 111);
    expect(registre.comptes.lirePreference()).toEqual({ compteId: 'compte-a', verrouille: false, majA: 111 });

    registre.comptes.definirPreference('compte-a', true, 222);
    expect(registre.comptes.lirePreference()).toEqual({ compteId: 'compte-a', verrouille: true, majA: 222 });
  });

  test('retour à l’automatique : le verrou tombe avec le choix', () => {
    registre.comptes.definirPreference('compte-b', true, 100);
    registre.comptes.definirPreference(null, true, 200);
    expect(registre.comptes.lirePreference()).toEqual({ compteId: null, verrouille: false, majA: 200 });
  });

  test('la ligne reste UNIQUE — deux réglages ne créent pas deux préférences', () => {
    registre.comptes.definirPreference('compte-a', true, 1);
    registre.comptes.definirPreference('compte-b', false, 2);
    expect(registre.comptes.lirePreference().compteId).toBe('compte-b');
  });

  test('SURVIT à la réouverture de la base — le vrai invariant', () => {
    const chemin = `/tmp/claude-1000/pref-compte-${process.pid}.db`;
    const premier = ouvrirRegistre({ chemin });
    premier.comptes.enregistrer({ id: 'compte-a', configDir: '/c/a', email: 'a@ex.com' });
    premier.comptes.definirPreference('compte-a', true, 4242);
    premier.fermer();

    const second = ouvrirRegistre({ chemin });
    expect(second.comptes.lirePreference()).toEqual({ compteId: 'compte-a', verrouille: true, majA: 4242 });
    second.fermer();
  });
});
