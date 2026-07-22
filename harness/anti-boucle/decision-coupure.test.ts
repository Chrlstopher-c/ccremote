/**
 * Couvre le cœur non négociable de H-68 : le biais asymétrique. `incertain` ne coupe
 * JAMAIS, seul `boucle` coupe, et un `incertain` répété escalade plutôt que de trancher.
 */

import { describe, expect, test } from 'bun:test';
import { deciderCoupure, SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT } from './decision-coupure.ts';
import { ETAT_ESCALADE_INITIAL } from './types.ts';
import type { EtatEscalade, Verdict } from './types.ts';

describe('deciderCoupure', () => {
  test('« boucle » coupe', () => {
    const { decision } = deciderCoupure({ verdict: 'boucle', motif: 'mêmes outils, mêmes cibles' }, ETAT_ESCALADE_INITIAL);
    expect(decision.action).toBe('couper');
  });

  test('« progres » continue et réinitialise le compteur d’incertains', () => {
    const etat: EtatEscalade = { incertainsConsecutifs: 2 };
    const { decision, nouvelEtat } = deciderCoupure({ verdict: 'progres', motif: 'fichiers modifiés à chaque tour' }, etat);
    expect(decision.action).toBe('continuer');
    expect(nouvelEtat.incertainsConsecutifs).toBe(0);
  });

  test("☠ « incertain » NE COUPE JAMAIS, sur aucun palier (H-68, cœur non négociable)", () => {
    let etat = ETAT_ESCALADE_INITIAL;
    for (let palier = 0; palier < 50; palier += 1) {
      const { decision, nouvelEtat } = deciderCoupure({ verdict: 'incertain', motif: 'signaux ambigus' }, etat);
      expect(decision.action).not.toBe('couper');
      etat = nouvelEtat;
    }
  });

  test('un seul « incertain » isolé continue, n’escalade pas', () => {
    const { decision, nouvelEtat } = deciderCoupure({ verdict: 'incertain', motif: 'ambigu' }, ETAT_ESCALADE_INITIAL);
    expect(decision.action).toBe('continuer');
    expect(nouvelEtat.incertainsConsecutifs).toBe(1);
  });

  test('des « incertain » consécutifs jusqu’au seuil escaladent à l’humain (H-61)', () => {
    let etat = ETAT_ESCALADE_INITIAL;
    let derniereDecision;
    for (let i = 0; i < SEUIL_ESCALADE_INCERTAINS_PAR_DEFAUT; i += 1) {
      const { decision, nouvelEtat } = deciderCoupure({ verdict: 'incertain', motif: `ambigu ${String(i)}` }, etat);
      derniereDecision = decision;
      etat = nouvelEtat;
    }
    expect(derniereDecision?.action).toBe('escalader');
    expect(etat.incertainsConsecutifs).toBe(0); // réinitialisé après escalade
  });

  test('un « progres » entre deux « incertain » casse la série ⇒ pas d’escalade prématurée', () => {
    let etat = ETAT_ESCALADE_INITIAL;
    ({ nouvelEtat: etat } = deciderCoupure({ verdict: 'incertain', motif: 'a' }, etat));
    ({ nouvelEtat: etat } = deciderCoupure({ verdict: 'progres', motif: 'b' }, etat));
    const { decision } = deciderCoupure({ verdict: 'incertain', motif: 'c' }, etat);
    expect(decision.action).toBe('continuer');
  });

  test('exhaustivité : les trois verdicts produisent trois actions non ambiguës', () => {
    const verdicts: Verdict[] = ['boucle', 'progres', 'incertain'];
    const actions = verdicts.map((verdict) => deciderCoupure({ verdict, motif: 'x' }, ETAT_ESCALADE_INITIAL).decision.action);
    expect(actions).toEqual(['couper', 'continuer', 'continuer']);
  });

  test('seuil d’escalade configurable', () => {
    let etat = ETAT_ESCALADE_INITIAL;
    const seuil = 2;
    ({ nouvelEtat: etat } = deciderCoupure({ verdict: 'incertain', motif: 'a' }, etat, seuil));
    const { decision } = deciderCoupure({ verdict: 'incertain', motif: 'b' }, etat, seuil);
    expect(decision.action).toBe('escalader');
  });
});
