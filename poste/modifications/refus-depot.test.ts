// Responsabilité : tests de la mémoire des refus de dépôt git (refus redemandés à chaque mise à jour).
import { describe, expect, test } from 'bun:test';
import { RefusDepot } from './refus-depot.ts';

const ERREUR = 'hors dépôt git : /home/x/projet';

describe('RefusDepot', () => {
  test('un refus « hors dépôt git » est retenu pour la session et le dossier', () => {
    const r = new RefusDepot(() => 0);
    r.noter('s1', '/home/x/projet', ERREUR);
    expect(r.pour('s1', '/home/x/projet')).toBe(ERREUR);
  });

  test('un autre dossier ou une autre session ne reçoit pas le refus', () => {
    const r = new RefusDepot(() => 0);
    r.noter('s1', '/home/x/projet', ERREUR);
    expect(r.pour('s1', '/home/x/autre')).toBeNull();
    expect(r.pour('s2', '/home/x/projet')).toBeNull();
  });

  test('le refus expire après quelques minutes : git est redemandé', () => {
    let t = 0;
    const r = new RefusDepot(() => t);
    r.noter('s1', '/p', ERREUR);
    t = 6 * 60_000;
    expect(r.pour('s1', '/p')).toBeNull();
  });

  test('une réussite ou une autre erreur efface le refus', () => {
    const r = new RefusDepot(() => 0);
    r.noter('s1', '/p', ERREUR);
    r.noter('s1', '/p', null);
    expect(r.pour('s1', '/p')).toBeNull();
    r.noter('s1', '/p', ERREUR);
    r.noter('s1', '/p', 'autre chose');
    expect(r.pour('s1', '/p')).toBeNull();
  });
});
