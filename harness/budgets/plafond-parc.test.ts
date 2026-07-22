/**
 * Protège G.1.3 (acceptation (b)) : désactivé par défaut, transposé en pourcentage
 * (H-58/H-70), et structurellement incapable de tuer une mission en cours.
 */

import { describe, expect, test } from 'bun:test';
import { deciderCreationMission } from './plafond-parc.ts';
import type { RelevePourPlafond } from './types.ts';

function releve(overrides: Partial<RelevePourPlafond> = {}): RelevePourPlafond {
  return { compteId: 'compte-1', typeFenetre: 'five_hour', utilisation: 50, statut: 'allowed', ...overrides };
}

describe('deciderCreationMission', () => {
  test('H-58 : désactivé par défaut (aucun seuil configuré) ⇒ toujours autorisé', () => {
    const decision = deciderCreationMission([releve({ utilisation: 99 })], {});
    expect(decision.autorise).toBe(true);
  });

  test('sous le seuil configuré ⇒ autorisé', () => {
    const decision = deciderCreationMission([releve({ utilisation: 40 })], { seuilUtilisationPct: 85 });
    expect(decision.autorise).toBe(true);
  });

  test('☠ au-dessus (ou égal) du seuil ⇒ refusé, création uniquement', () => {
    const decision = deciderCreationMission([releve({ utilisation: 85 })], { seuilUtilisationPct: 85 });
    expect(decision.autorise).toBe(false);
    expect(decision.motif).toContain('five_hour');
  });

  test("`utilisation` absent (optionnel côté SDK, H-54) n'est jamais traité comme un dépassement", () => {
    const decision = deciderCreationMission([releve({ utilisation: null })], { seuilUtilisationPct: 10 });
    expect(decision.autorise).toBe(true);
  });

  test('plusieurs fenêtres : une seule au-dessus du seuil suffit à refuser', () => {
    const decision = deciderCreationMission(
      [releve({ typeFenetre: 'five_hour', utilisation: 20 }), releve({ typeFenetre: 'seven_day', utilisation: 90 })],
      { seuilUtilisationPct: 85 },
    );
    expect(decision.autorise).toBe(false);
    expect(decision.motif).toContain('seven_day');
  });

  test('☠ G.1.3 : la forme du type ne permet de désigner AUCUNE mission à terminer', () => {
    const decision = deciderCreationMission([releve({ utilisation: 100 })], { seuilUtilisationPct: 1 });
    expect(Object.keys(decision).sort()).toEqual(['autorise', 'motif']);
  });

  test('statut « rejected » (H-54) refuse la création MÊME plafond désactivé', () => {
    const decision = deciderCreationMission([releve({ statut: 'rejected', utilisation: null })], {});
    expect(decision.autorise).toBe(false);
    expect(decision.motif).toContain('rejected');
  });
});
