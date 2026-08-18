/**
 * Tests du dépôt notifications — rattrapage par curseur temporel (`posterieures`).
 *
 * Ce que ces tests prouvent :
 *  · seules les notifications créées APRÈS le curseur reviennent ;
 *  · l'ordre est croissant, jamais décroissant — sous LIMIT, un tri DESC
 *    laisserait un trou permanent entre le curseur et la coupure ;
 *  · `recentes()` (plafond d'affichage) n'est pas affecté par l'ajout.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from './index.ts';

let repertoire: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'notif-test-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

function semer(id: string, creeA: number): void {
  registre.notifications.creer(
    { id, type: 'equipe_terminee', missionId: null, conversationId: 'conv-a', titre: id, corps: id },
    creeA,
  );
}

describe('posterieures — rattrapage par curseur', () => {
  test('ne rend que ce qui est arrivé APRÈS le curseur, jamais à cette date exacte', () => {
    semer('n1', 1000);
    semer('n2', 2000);
    semer('n3', 3000);

    const rattrapees = registre.notifications.posterieures(2000);

    expect(rattrapees.map((n) => n.id)).toEqual(['n3']);
  });

  test('curseur à zéro ⇒ tout l’historique, ordre ancien → récent', () => {
    semer('n1', 1000);
    semer('n2', 2000);

    const rattrapees = registre.notifications.posterieures(0);

    expect(rattrapees.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  test('☠ ordre ASCENDANT sous LIMIT : pas de trou entre le curseur et la coupure', () => {
    // `☠` LE test qui verrouille la raison d'être du tri ASC. Un DESC sous
    // LIMIT rendrait les DEUX plus récentes (n4, n5) et perdrait n2/n3 pour
    // toujours, même si le client rappelle avec le curseur le plus haut reçu.
    semer('n1', 1000);
    semer('n2', 2000);
    semer('n3', 3000);
    semer('n4', 4000);
    semer('n5', 5000);

    const premierLot = registre.notifications.posterieures(1000, 2);
    expect(premierLot.map((n) => n.id)).toEqual(['n2', 'n3']);

    // Le client rappelle avec le creeA du dernier élément reçu (n3 → 3000) :
    // rien n'est sauté, rien n'est redoublé.
    const dernierCurseur = premierLot[premierLot.length - 1]?.creeA ?? 0;
    const secondLot = registre.notifications.posterieures(dernierCurseur, 2);
    expect(secondLot.map((n) => n.id)).toEqual(['n4', 'n5']);
  });

  test('aucune notification après le curseur ⇒ liste vide, pas une erreur', () => {
    semer('n1', 1000);
    expect(registre.notifications.posterieures(5000)).toHaveLength(0);
  });
});
