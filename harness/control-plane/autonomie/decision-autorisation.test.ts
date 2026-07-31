/**
 * `☠` Ce module décide si une équipe part sans que personne ne clique. Une
 * erreur ici ne se voit pas : elle se traduit soit par une nuit perdue à
 * attendre, soit par des dispatchs que personne n'a voulus. Chaque test ci-
 * dessous couvre une de ces deux façons de se tromper.
 */

import { describe, expect, test } from 'bun:test';
import { AUTO_APPROBATIONS_MAX, deciderAutorisation, fenetreOuverte } from './decision-autorisation.ts';

const T = 1_785_000_000_000;
const BASE = {
  approbationHumaineAnterieure: false,
  autoApprouveesDeja: 0,
  fenetreDebut: null,
  fenetreFin: null,
  maintenant: T,
} as const;

describe('le premier mandat d’un fil', () => {
  test('exige toujours un humain', () => {
    const d = deciderAutorisation({ ...BASE });
    expect(d.mode).toBe('humain');
    // La raison est lue par un modèle : elle doit annoncer la suite, sinon il
    // redemandera l'autorisation à chaque fois sans savoir qu'il peut enchaîner.
    expect(d.raison).toContain('premier mandat');
    expect(d.raison).toContain('sans lui redemander');
  });

  test('une fenêtre ouverte le dispense du clic', () => {
    // C'est tout l'objet d'une plage : Chris a validé l'intention en amont.
    const d = deciderAutorisation({ ...BASE, fenetreDebut: T - 1000, fenetreFin: T + 3_600_000 });
    expect(d.mode).toBe('auto');
  });
});

describe('après une approbation humaine', () => {
  test('les mandats suivants du fil partent seuls', () => {
    const d = deciderAutorisation({ ...BASE, approbationHumaineAnterieure: true });
    expect(d.mode).toBe('auto');
    expect(d.raison).toContain('déjà autorisé');
  });

  test('l’engagement ne franchit PAS la frontière du fil', () => {
    // `approbationHumaineAnterieure` est calculé par conversation : un autre fil
    // arrive ici à `false` et repasse donc par un clic. Sans cette séparation,
    // une seule approbation ouvrirait tout le parc pour toujours.
    expect(deciderAutorisation({ ...BASE }).mode).toBe('humain');
  });
});

describe('le plafond', () => {
  test('reprend la main une fois atteint', () => {
    const d = deciderAutorisation({ ...BASE, approbationHumaineAnterieure: true, autoApprouveesDeja: AUTO_APPROBATIONS_MAX });
    expect(d.mode).toBe('humain');
    expect(d.raison).toContain("plafond d'autonomie atteint");
  });

  test('l’emporte même sur une fenêtre ouverte', () => {
    // `☠` LE test qui protège la nuit : une boucle pathologique dans une plage
    // de huit heures brûlerait tout le quota sans que personne ne l'arrête.
    // L'ordre des règles (plafond d'abord) est ce qui rend cela impossible.
    const d = deciderAutorisation({
      ...BASE,
      fenetreDebut: T - 1000,
      fenetreFin: T + 3_600_000,
      autoApprouveesDeja: AUTO_APPROBATIONS_MAX + 5,
      plafond: AUTO_APPROBATIONS_MAX,
    });
    expect(d.mode).toBe('humain');
  });

  test('juste en dessous, ça passe encore', () => {
    const d = deciderAutorisation({ ...BASE, approbationHumaineAnterieure: true, autoApprouveesDeja: AUTO_APPROBATIONS_MAX - 1 });
    expect(d.mode).toBe('auto');
  });

  test('dit à l’orchestrateur comment en sortir', () => {
    const d = deciderAutorisation({ ...BASE, approbationHumaineAnterieure: true, autoApprouveesDeja: AUTO_APPROBATIONS_MAX });
    // Un blocage sans issue formulée laisse le modèle réessayer en boucle.
    expect(d.raison).toContain('approbation manuelle relance le compteur');
  });
});

describe('la fenêtre', () => {
  test('fermée avant son début et après sa fin', () => {
    expect(fenetreOuverte({ ...BASE, fenetreDebut: T + 1000, fenetreFin: T + 2000 })).toBe(false);
    expect(fenetreOuverte({ ...BASE, fenetreDebut: T - 2000, fenetreFin: T - 1000 })).toBe(false);
  });

  test('une borne manquante ne l’ouvre jamais', () => {
    // `☠` Une fenêtre à moitié posée serait ouverte pour toujours — l'exact
    // contraire de ce qu'une échéance est censée garantir.
    expect(fenetreOuverte({ ...BASE, fenetreDebut: T - 1000, fenetreFin: null })).toBe(false);
    expect(fenetreOuverte({ ...BASE, fenetreDebut: null, fenetreFin: T + 1000 })).toBe(false);
  });

  test('la fin est exclusive : à l’instant de l’échéance, c’est fermé', () => {
    expect(fenetreOuverte({ ...BASE, fenetreDebut: T - 1000, fenetreFin: T })).toBe(false);
  });

  test('expirée, on retombe sur la règle du fil et pas sur l’autonomie', () => {
    const d = deciderAutorisation({ ...BASE, fenetreDebut: T - 2000, fenetreFin: T - 1000 });
    expect(d.mode).toBe('humain');
  });

  test('annonce le temps restant — c’est ce qui fait arbitrer l’orchestrateur', () => {
    const d = deciderAutorisation({ ...BASE, fenetreDebut: T - 1000, fenetreFin: T + 30 * 60_000 });
    expect(d.raison).toContain('30 min');
    expect(d.raison).toContain('échéance');
  });
});
