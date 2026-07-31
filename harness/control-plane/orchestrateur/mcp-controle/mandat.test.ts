import { describe, expect, test } from 'bun:test';
import { construireMandatPropose } from './mandat.ts';

describe('construireMandatPropose (A.3.1, H-52, H-66)', () => {
  test("signale l'absence de critère d'arrêt plutôt que de l'omettre silencieusement (panne #14)", () => {
    const mandat = construireMandatPropose('alpha', 'refaire l’auth', null, 'src/auth/**', 'ecriture');
    expect(mandat.texte).toContain('⚠ non fourni');
  });

  test('porte toujours la clause H-52 (team leader, validation E2E réelle)', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'tests verts', 'src/**', 'ecriture');
    expect(mandat.texte).toContain('team leader');
    expect(mandat.texte).toContain('tests end-to-end');
  });

  test('porte toujours la clause H-66 (attribution de l’émetteur)', () => {
    const mandat = construireMandatPropose('alpha', 'x', 'tests verts', 'src/**', 'ecriture');
    expect(mandat.texte).toContain('une équipe parmi d');
    expect(mandat.texte).toContain("normalement de l'orchestrateur");
  });

  test('ne produit aucun effet de bord — pur', () => {
    const a = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture');
    const b = construireMandatPropose('alpha', 'x', 'y', 'z', 'ecriture');
    expect(a).toEqual(b);
  });
});
