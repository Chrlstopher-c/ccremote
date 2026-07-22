// Le journal est la surface d'assertion unique du harness.
// S'il n'horodate pas sur le temps simulé, tous les tests deviennent flous.

import { describe, expect, test } from 'bun:test';
import { HorlogeSimulee } from '../deterministe/horloge-simulee.ts';
import { JournalPannes } from './journal-pannes.ts';
import { empreinte } from '../rejeu.ts';

const monter = (): { horloge: HorlogeSimulee; journal: JournalPannes } => {
  const horloge = new HorlogeSimulee();
  return { horloge, journal: new JournalPannes(horloge) };
};

describe('JournalPannes', () => {
  test('horodate sur le temps simulé, jamais sur Date.now', () => {
    const { horloge, journal } = monter();
    journal.enregistrer('worker_spawne', { id: 'w1' });
    horloge.avancer(5_000);
    journal.enregistrer('worker_mort', { id: 'w1' });
    expect(journal.faits().map((f) => f.a)).toEqual([0, 5_000]);
  });

  test('filtrer, compter et contient portent sur le type', () => {
    const { journal } = monter();
    journal.enregistrer('append_rejete', { cle: 'k' });
    journal.enregistrer('append_rejete', { cle: 'k' });
    journal.enregistrer('mirror_error', { cle: 'k' });
    expect(journal.compter('append_rejete')).toBe(2);
    expect(journal.filtrer('mirror_error')).toHaveLength(1);
    expect(journal.contient('lot_abandonne')).toBe(false);
  });

  test('sequenceRespectee accepte une sous-séquence, refuse un ordre inversé', () => {
    const { journal } = monter();
    journal.enregistrer('lien_coupe_transitoire', {});
    journal.enregistrer('evenement_publie', {});
    journal.enregistrer('lien_retabli', {});
    expect(journal.sequenceRespectee(['lien_coupe_transitoire', 'lien_retabli'])).toBe(true);
    expect(journal.sequenceRespectee(['lien_retabli', 'lien_coupe_transitoire'])).toBe(false);
  });

  test('vider remet la trace à zéro', () => {
    const { journal } = monter();
    journal.enregistrer('worker_spawne', {});
    journal.vider();
    expect(journal.faits()).toHaveLength(0);
  });

  test('l’empreinte de deux traces identiques coïncide', () => {
    const tracer = (): string => {
      const { horloge, journal } = monter();
      journal.enregistrer('permission_recue', { requestId: 'r1' });
      horloge.avancer(120);
      journal.enregistrer('notification_emise', { requestId: 'r1' });
      return empreinte(journal.faits());
    };
    expect(tracer()).toBe(tracer());
  });
});
