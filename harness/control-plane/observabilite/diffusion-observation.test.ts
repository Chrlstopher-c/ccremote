// Tests de la diffusion vers les clients d'observation (E.2.3, mission M-50).
// ☠ CASSE couverts : #29 (contre-pression d'un client lent), reprise au
// high-water mark (c), mode miroir (d), plusieurs clients sans interférence.

import { describe, expect, test } from 'bun:test';
import { CAPACITE_TAMPON_DEFAUT, DiffusionObservation } from './diffusion-observation.ts';
import type { EvenementFilMission } from './types.ts';

const EVT: EvenementFilMission = {
  nature: 'activite',
  ligneId: 'principal',
  granularite: 'tokens',
  texte: 'x',
  horodatage: 0,
  estRequiresAction: false,
};

describe('DiffusionObservation — séquence et reprise (c)', () => {
  test('chaque publication incrémente la séquence', () => {
    const d = new DiffusionObservation('equipe-1');
    const e1 = d.publier(EVT);
    const e2 = d.publier(EVT);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(d.hautDeSeq()).toBe(2);
  });

  test('un client reprend depuis son high-water mark : ne rejoue pas ce qu\'il a déjà vu', () => {
    const d = new DiffusionObservation('equipe-1');
    d.publier(EVT);
    d.publier(EVT);
    d.publier(EVT);
    const { rejeu, troue } = d.sabonner(1, 'pilote', () => {});
    expect(rejeu.map((e) => e.seq)).toEqual([2, 3]);
    expect(troue).toBe(false);
  });

  test('un client neuf (depuisSeq = 0) reçoit tout l\'historique conservé', () => {
    const d = new DiffusionObservation('equipe-1');
    d.publier(EVT);
    d.publier(EVT);
    const { rejeu } = d.sabonner(0, 'pilote', () => {});
    expect(rejeu.length).toBe(2);
  });
});

describe('DiffusionObservation — panne #29 : bourrage borné, jamais de contre-pression', () => {
  test('publier() reste synchrone même avec un abonné qui ne lit jamais', () => {
    const d = new DiffusionObservation('equipe-1', 5);
    d.sabonner(0, 'pilote', () => {
      /* ne consomme jamais réellement — publier() ne doit jamais attendre */
    });
    const debut = Date.now();
    for (let i = 0; i < 1000; i++) d.publier(EVT);
    expect(Date.now() - debut).toBeLessThan(500);
  });

  test('le tampon d\'historique abandonne les plus anciens au-delà de la capacité', () => {
    const d = new DiffusionObservation('equipe-1', 5);
    for (let i = 0; i < 10; i++) d.publier(EVT);
    const { rejeu, troue } = d.sabonner(0, 'pilote', () => {});
    expect(rejeu.length).toBe(5);
    expect(troue).toBe(true);
  });

  test('capacité par défaut documentée', () => {
    expect(CAPACITE_TAMPON_DEFAUT).toBe(500);
  });

  test('un abonné dont le callback lève est isolé — la publication continue pour les autres', () => {
    const d = new DiffusionObservation('equipe-1');
    const recus: number[] = [];
    d.sabonner(0, 'pilote', () => {
      throw new Error('client cassé');
    });
    d.sabonner(0, 'pilote', (e) => recus.push(e.seq));
    expect(() => d.publier(EVT)).not.toThrow();
    expect(recus).toEqual([1]);
  });
});

describe('DiffusionObservation — plusieurs clients sans interférence', () => {
  test('deux abonnés reçoivent chacun tous les événements publiés après leur abonnement', () => {
    const d = new DiffusionObservation('equipe-1');
    const recusA: number[] = [];
    const recusB: number[] = [];
    d.sabonner(0, 'pilote', (e) => recusA.push(e.seq));
    d.publier(EVT);
    d.sabonner(0, 'pilote', (e) => recusB.push(e.seq));
    d.publier(EVT);
    expect(recusA).toEqual([1, 2]);
    expect(recusB).toEqual([2]);
  });

  test('fermer() retire un abonné sans affecter les autres', () => {
    const d = new DiffusionObservation('equipe-1');
    const recus: number[] = [];
    const { abonnement } = d.sabonner(0, 'pilote', (e) => recus.push(e.seq));
    d.publier(EVT);
    abonnement.fermer();
    d.publier(EVT);
    expect(recus).toEqual([1]);
    expect(d.nombreAbonnes()).toBe(0);
  });
});

describe('DiffusionObservation — mode miroir (d)', () => {
  test('un abonnement miroir reçoit les mêmes événements, sans exposer de méthode mutative', () => {
    const d = new DiffusionObservation('equipe-1');
    const recus: number[] = [];
    const { abonnement } = d.sabonner(0, 'miroir', (e) => recus.push(e.seq));
    d.publier(EVT);
    expect(abonnement.mode).toBe('miroir');
    expect(recus).toEqual([1]);
    // Structurellement : seules `mode`, `hautDeSeqInitial`, `fermer` existent (types.ts).
    expect(Object.keys(abonnement).sort()).toEqual(['fermer', 'hautDeSeqInitial', 'mode']);
  });
});
