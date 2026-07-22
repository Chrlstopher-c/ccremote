/**
 * Tests de `arbitrerFencing` (D.2.3, panne #2). Fonction pure : pas de doublure,
 * pas d'I/O — seule la table de vérité compte.
 *
 * Vérifiée contre la même sémantique que la doublure de référence
 * `test-harness/doublures/superviseur-factice.ts` (déjà validée par
 * `superviseur-factice.test.ts`) : c'est la preuve que le comportement réel et le
 * modèle de test convergent.
 */

import { describe, expect, test } from 'bun:test';
import { arbitrerFencing, type DetenteurEpoch } from './fencing-epoch.ts';

const detenteur = (sessionId: string, epoch: number): DetenteurEpoch => ({ sessionId, epoch });

describe('arbitrerFencing — aucun concurrent', () => {
  test('premier rattachement sur un worktree libre : toujours accepté', () => {
    expect(arbitrerFencing([], detenteur('s1', 1))).toEqual({ type: 'accepte' });
  });
});

describe('arbitrerFencing — epoch strictement supérieur (rattachement à froid légitime)', () => {
  test('le candidat plus récent évince le détenteur périmé', () => {
    const decision = arbitrerFencing([detenteur('ancien', 1)], detenteur('nouveau', 2));
    expect(decision).toEqual({ type: 'accepte_evince', sessionsAEvincer: ['ancien'] });
  });

  test('évince TOUS les concurrents strictement inférieurs, pas seulement le premier', () => {
    const decision = arbitrerFencing(
      [detenteur('a', 1), detenteur('b', 1)],
      detenteur('c', 3),
    );
    expect(decision.type).toBe('accepte_evince');
    if (decision.type === 'accepte_evince') {
      expect([...decision.sessionsAEvincer].sort()).toEqual(['a', 'b']);
    }
  });
});

describe('arbitrerFencing — epoch strictement inférieur (requête périmée)', () => {
  test('le candidat retardataire est rejeté, le détenteur en place n’est pas touché', () => {
    const decision = arbitrerFencing([detenteur('courant', 5)], detenteur('retardataire', 3));
    expect(decision).toEqual({ type: 'rejete', motif: 'epoch_perime', epochCourant: 5 });
  });
});

describe('arbitrerFencing — égalité d’epoch (☠ piège déjà payé, traité explicitement)', () => {
  test('deux candidats au même epoch ne coexistent jamais : le candidat ENTRANT perd', () => {
    const decision = arbitrerFencing([detenteur('en-place', 4)], detenteur('entrant', 4));
    expect(decision).toEqual({ type: 'rejete', motif: 'collision_meme_epoch', epochCourant: 4 });
  });

  test('la collision est un motif distinct de "epoch_perime" — pas un simple repli', () => {
    const decision = arbitrerFencing([detenteur('en-place', 4)], detenteur('entrant', 4));
    expect(decision.type).toBe('rejete');
    if (decision.type === 'rejete') expect(decision.motif).not.toBe('epoch_perime');
  });
});

describe('arbitrerFencing — cohérence avec le reste des concurrents', () => {
  test('un candidat égal au max mais avec un concurrent plus bas encore présent : rejeté par collision, pas évincé', () => {
    // Un concurrent à epoch 4 (égalité) ET un autre à epoch 2 (périmé) : l'égalité
    // prime — le candidat est rejeté avant même d'envisager d'évincer le epoch 2.
    const decision = arbitrerFencing(
      [detenteur('egal', 4), detenteur('perime', 2)],
      detenteur('entrant', 4),
    );
    expect(decision).toEqual({ type: 'rejete', motif: 'collision_meme_epoch', epochCourant: 4 });
  });
});
