import { describe, expect, test } from 'bun:test';
import { construireMandatPropose } from './mandat.ts';

describe('construireMandatPropose (A.3.1, H-52, H-66)', () => {
  test("signale l'absence de critère d'arrêt plutôt que de l'omettre silencieusement (panne #14)", () => {
    const mandat = construireMandatPropose('alpha', 'refaire l’auth', null, 'src/auth/**', 'ecriture', null);
    expect(mandat.texte).toContain('⚠ non fourni');
  });

  test('porte toujours la clause H-52 (team leader, validation E2E réelle)', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'tests verts', 'src/**', 'ecriture', null);
    expect(mandat.texte).toContain('team leader');
    expect(mandat.texte).toContain('tests end-to-end');
  });

  test('porte toujours la clause H-66 (attribution de l’émetteur)', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'tests verts', 'src/**', 'ecriture', null);
    expect(mandat.texte).toContain('une équipe parmi d');
    expect(mandat.texte).toContain("normalement de l'orchestrateur");
  });

  test('ne produit aucun effet de bord — pur', () => {
    const a = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', 5);
    const b = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', 5);
    expect(a).toEqual(b);
  });

  // `☠` Mandat opérateur 18/08 : un lead qui ignore son plafond et l'existence
  // de `ma_depense` ne peut ni s'en servir ni dimensionner son travail — le
  // texte doit porter les deux, pas seulement le câblage qui les applique.
  test('annonce le plafond propre à la mission, en dollars, avec sa conséquence', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', 6);
    expect(mandat.texte).toContain('Budget : 6.00 $ (plafond propre à cette mission)');
    expect(mandat.texte).toContain('coupée net');
    expect(mandat.texte).toContain('travail non commité serait perdu');
  });

  test('dit explicitement l’absence de plafond propre plutôt que de taire la ligne', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', null);
    expect(mandat.texte).toContain('aucun plafond propre');
    expect(mandat.texte).toContain('plafond de parc');
    // Le montant dérivé (plafond de parc) reste annoncé, pas seulement son origine.
    expect(mandat.texte).toMatch(/Budget : \d+\.\d{2} \$/);
  });

  test('un budget à 0 $ ou négatif est traité comme l’absence de plafond propre', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', 0);
    expect(mandat.texte).toContain('aucun plafond propre');
  });

  test('cite l’outil ma_depense et dit quand s’en servir', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture', 6);
    expect(mandat.texte).toContain('ma_depense');
    expect(mandat.texte).toContain("engager un travail long");
    expect(mandat.texte).toContain('hésites à approfondir une piste');
  });
});
