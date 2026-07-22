/**
 * Tests d'acceptation de la mission M-34 (B.3.2, B.3.3).
 * Chaque `describe` correspond à une lettre de l'acceptation ou à une panne numérotée
 * de `Upgrade/15-grille-revue.md` — la grille l'exige explicitement (« tout ☠ CASSE a un
 * test associé »).
 */

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../test-harness/deterministe/horloge-simulee.ts';
import { JournalPannes } from '../test-harness/journal/journal-pannes.ts';
import { CompteurRelances } from './compteur-relances.ts';
import { deciderRelance } from './politique-relance.ts';

function nouvellesDeps(plafond = 3): { compteur: CompteurRelances; journal: JournalPannes } {
  const journal = new JournalPannes(new HorlogeSimulee());
  const compteur = new CompteurRelances(plafond);
  return { compteur, journal };
}

describe('acceptation (a) — mapping TerminalReason selon la table de 05-arbre-B.3.2', () => {
  test('completed ⇒ rien, aucune trace de relance', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'completed', deps);
    expect(decision.action).toBe('rien');
  });

  test('un arrêt volontaire (aborted_tools) ⇒ rien, ce n\'est pas un échec', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'aborted_tools', deps);
    expect(decision.action).toBe('rien');
  });

  test('blocking_limit (quota) ⇒ remonter, pas une relance de cette politique', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'blocking_limit', deps);
    expect(decision.action).toBe('remonter');
    expect(deps.journal.contient('relance_refusee_quota')).toBe(true);
  });
});

describe('panne #12 de la grille — échec structurel jamais relancé (acceptation b)', () => {
  test.each(['prompt_too_long', 'malformed_tool_use_exhausted', 'structured_output_retry_exhausted'] as const)(
    '%s ⇒ echec_definitif immédiat, aucune tentative consommée',
    (raison) => {
      const deps = nouvellesDeps();
      const decision = deciderRelance('s1', raison, deps);
      expect(decision.action).toBe('echec_definitif');
      expect(deps.compteur.etat('s1').tentativesEffectuees).toBe(0);
      expect(deps.journal.contient('relance_refusee_structurel')).toBe(true);
    },
  );

  test('rejouer le même échec structurel ne relance jamais, même après plusieurs occurrences', () => {
    const deps = nouvellesDeps();
    for (let i = 0; i < 5; i += 1) {
      const decision = deciderRelance('s1', 'prompt_too_long', deps);
      expect(decision.action).toBe('echec_definitif');
    }
    expect(deps.compteur.etat('s1').tentativesEffectuees).toBe(0);
  });
});

describe('panne #13 de la grille — budget_exhausted jamais relancé automatiquement (acceptation c)', () => {
  test('budget_exhausted ⇒ remonter, jamais relancer', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'budget_exhausted', deps);
    expect(decision.action).toBe('remonter');
    expect(decision.action === 'relancer').toBe(false);
    expect(deps.journal.contient('relance_refusee_borne')).toBe(true);
  });

  test('max_turns (même groupe borne_atteinte) ⇒ remonter aussi, pas de traitement spécial au budget seul', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'max_turns', deps);
    expect(decision.action).toBe('remonter');
  });

  test('budget_exhausted répété ne consomme jamais de tentative, donc n\'atteint jamais le plafond', () => {
    const deps = nouvellesDeps(2);
    for (let i = 0; i < 10; i += 1) {
      deciderRelance('s1', 'budget_exhausted', deps);
    }
    expect(deps.compteur.etat('s1').tentativesEffectuees).toBe(0);
  });
});

describe('acceptation (d) — plafond de relances puis echec_definitif', () => {
  test('un échec transitoire relance avec resume tant que le plafond n\'est pas atteint', () => {
    const deps = nouvellesDeps(2);
    const decision = deciderRelance('s1', 'api_error', deps);
    expect(decision.action).toBe('relancer');
    if (decision.action === 'relancer') {
      expect(decision.resume).toBe('s1');
      expect(decision.forkSession).toBe(false);
      expect(decision.tentative).toBe(1);
      expect(decision.delaiMs).toBeGreaterThan(0);
    }
    expect(deps.journal.contient('relance_decidee')).toBe(true);
  });

  test('au plafond, la relance suivante devient echec_definitif', () => {
    const deps = nouvellesDeps(2);
    const premiere = deciderRelance('s1', 'model_error', deps);
    const seconde = deciderRelance('s1', 'model_error', deps);
    const troisieme = deciderRelance('s1', 'model_error', deps);
    expect(premiere.action).toBe('relancer');
    expect(seconde.action).toBe('relancer');
    expect(troisieme.action).toBe('echec_definitif');
    if (troisieme.action === 'echec_definitif') {
      expect(troisieme.tentativesEffectuees).toBe(2);
    }
    expect(deps.journal.contient('plafond_relance_atteint')).toBe(true);
  });

  test('le backoff augmente à chaque tentative transitoire successive', () => {
    const deps = nouvellesDeps(5);
    const d1 = deciderRelance('s1', 'turn_setup_failed', deps);
    const d2 = deciderRelance('s1', 'turn_setup_failed', deps);
    if (d1.action === 'relancer' && d2.action === 'relancer') {
      expect(d2.delaiMs).toBeGreaterThan(d1.delaiMs);
    } else {
      throw new Error('les deux décisions devaient être des relances');
    }
  });

  test('un completed après des relances remet le compteur à zéro (nouvelle mission viable)', () => {
    const deps = nouvellesDeps(3);
    deciderRelance('s1', 'api_error', deps);
    deciderRelance('s1', 'api_error', deps);
    expect(deps.compteur.etat('s1').tentativesEffectuees).toBe(2);
    deciderRelance('s1', 'completed', deps);
    expect(deps.compteur.etat('s1').tentativesEffectuees).toBe(0);
  });
});

describe('piège — raison connue du SDK mais absente de la table de groupement (image_error, tool_deferred*)', () => {
  test.each(['image_error', 'tool_deferred', 'tool_deferred_unavailable'] as const)(
    '%s ⇒ remonter, journalisée telle quelle, jamais un cas générique',
    (raison) => {
      const deps = nouvellesDeps();
      const decision = deciderRelance('s1', raison, deps);
      expect(decision.action).toBe('remonter');
      expect(deps.journal.contient('raison_terminaison_non_couverte')).toBe(true);
      const fait = deps.journal.filtrer('raison_terminaison_non_couverte')[0];
      expect(fait?.details['raison']).toBe(raison);
    },
  );
});

describe('piège — raison totalement inconnue du SDK (dérive future)', () => {
  test('une valeur qui n\'existe pas dans TerminalReason est journalisée telle quelle, jamais relancée', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', 'ceci_nexiste_pas_dans_le_sdk', deps);
    expect(decision.action).toBe('remonter');
    const fait = deps.journal.filtrer('raison_terminaison_non_couverte')[0];
    expect(fait?.details['raison']).toBe('ceci_nexiste_pas_dans_le_sdk');
  });

  test('terminal_reason absent (undefined) ⇒ remonter, pas une relance par défaut', () => {
    const deps = nouvellesDeps();
    const decision = deciderRelance('s1', undefined, deps);
    expect(decision.action).toBe('remonter');
  });
});

describe('isolation par équipe (H-11)', () => {
  test('le plafond atteint sur une équipe n\'affecte pas une autre équipe transitoire', () => {
    const deps = nouvellesDeps(1);
    deciderRelance('equipe-a', 'api_error', deps);
    const echecA = deciderRelance('equipe-a', 'api_error', deps);
    const relanceB = deciderRelance('equipe-b', 'api_error', deps);
    expect(echecA.action).toBe('echec_definitif');
    expect(relanceB.action).toBe('relancer');
  });
});
