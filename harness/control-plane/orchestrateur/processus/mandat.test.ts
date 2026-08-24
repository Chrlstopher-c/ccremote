import { describe, expect, test } from 'bun:test';
import { MANDAT_ORCHESTRATEUR } from './mandat.ts';
import { ACCES_MANDAT } from '../../../shared/acces-mandat.ts';

/**
 * Chantier 4 (mandat opérateur 24/08) — `☠` le texte de capacités décrivait
 * encore `acces` comme n'ayant que DEUX valeurs (`lecture`/`ecriture`) alors
 * que le schéma de l'outil (`shared/acces-mandat.ts`, `serveur.ts`) en accepte
 * TROIS depuis l'ajout de `rapport` : tant que ce texte reste faux, l'orchestrateur
 * n'utilise jamais ce troisième droit, qui reste un verrou payé et inutilisé.
 */
describe('MANDAT_ORCHESTRATEUR × cohérence acces (chantier 4)', () => {
  test('les TROIS valeurs de ACCES_MANDAT sont toutes citées', () => {
    for (const valeur of ACCES_MANDAT) {
      expect(MANDAT_ORCHESTRATEUR).toContain(`\`${valeur}\``);
    }
  });

  test('☠ ne prétend plus qu’il n’y a que DEUX valeurs possibles', () => {
    expect(MANDAT_ORCHESTRATEUR).not.toContain('deux valeurs possibles');
    expect(MANDAT_ORCHESTRATEUR).toContain('TROIS valeurs possibles');
  });

  test('décrit `rapport` comme une écriture CONFINÉE au worktree, distincte de `ecriture`', () => {
    expect(MANDAT_ORCHESTRATEUR).toContain('CONFINÉE');
    expect(MANDAT_ORCHESTRATEUR).toContain("worktree de l'équipe");
  });
});

/** Chantier 3 (mandat opérateur 24/08) — le champ `latitude` doit être décrit ici. */
describe('MANDAT_ORCHESTRATEUR × champ `latitude` (chantier 3)', () => {
  test('décrit le champ, et la règle périmètre > latitude', () => {
    expect(MANDAT_ORCHESTRATEUR).toContain('`latitude`');
    expect(MANDAT_ORCHESTRATEUR).toContain('AUTORISE');
    expect(MANDAT_ORCHESTRATEUR).toContain('INTERDIT');
    expect(MANDAT_ORCHESTRATEUR).toContain('emporte TOUJOURS en cas de');
  });
});

/** Chantier 2 (mandat opérateur 24/08) — le refus de critère invérifiable doit être annoncé. */
describe('MANDAT_ORCHESTRATEUR × critère d’arrêt vérifiable (chantier 2)', () => {
  test('annonce le refus et son motif chiffré (393 mandats, 34 invérifiables)', () => {
    expect(MANDAT_ORCHESTRATEUR).toContain('critereArret');
    expect(MANDAT_ORCHESTRATEUR).toContain('393 mandats');
  });
});
