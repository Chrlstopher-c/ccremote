/**
 * Drill récurrent de l'arrêt d'urgence (G.4.3, mission M-52).
 *
 * Protège l'acceptation (d) : « test récurrent, pas unique ». Un scheduler
 * factice (jamais un vrai minuteur) capture la tâche planifiée pour la
 * déclencher manuellement, tick par tick — c'est ce qui rend « récurrent »
 * vérifiable en unitaire sans attendre de vraies heures.
 */

import { describe, expect, test } from 'bun:test';
import { VerificateurDrillArretUrgence } from './exercice-periodique.ts';
import type { AlerteDrill, PortDrillArretUrgence } from './types.ts';

interface PlanificateurFactice {
  readonly planifier: (intervalleMs: number, tache: () => void) => { annuler: () => void };
  declencher(): void;
  readonly annulations: number[];
  readonly intervalles: number[];
}

function planificateurFactice(): PlanificateurFactice {
  let tacheCourante: (() => void) | null = null;
  const annulations: number[] = [];
  const intervalles: number[] = [];
  return {
    intervalles,
    annulations,
    planifier: (intervalleMs, tache) => {
      intervalles.push(intervalleMs);
      tacheCourante = tache;
      return { annuler: () => annulations.push(intervalleMs) };
    },
    declencher: () => tacheCourante?.(),
  };
}

function horlogeFactice(depart = 0): { horloge: () => number; avancer: (ms: number) => void } {
  let maintenant = depart;
  return { horloge: () => maintenant, avancer: (ms) => (maintenant += ms) };
}

function portFactice(
  reponse: (missionId: string) => Promise<{ missionId: string; sessionId: string; etapes: readonly string[] } | null>,
): PortDrillArretUrgence {
  return { arreterMissionEnUrgence: (missionId) => reponse(missionId) };
}

describe('exécution récurrente (☠ (d) : mécanique du « testé régulièrement »)', () => {
  test('demarrer() planifie un tick à l’intervalle configuré, chaque tick déclenche un vrai drill', async () => {
    const planificateur = planificateurFactice();
    let appels = 0;
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async (missionId) => {
        appels += 1;
        return { missionId, sessionId: 's', etapes: ['pause_globale', 'fermeture_propre', 'forcage'] };
      }),
      missionIdCanari: 'canari',
      intervalleMs: 60_000,
      planifier: planificateur.planifier,
    });

    verificateur.demarrer();
    expect(planificateur.intervalles).toEqual([60_000]);

    planificateur.declencher();
    await Promise.resolve();
    await Promise.resolve();
    planificateur.declencher();
    await Promise.resolve();
    await Promise.resolve();

    expect(appels).toBe(2); // récurrent : plusieurs déclenchements, pas un seul
    expect(verificateur.etat().executions).toBe(2);
    expect(verificateur.etat().dernierSuccesA).not.toBeNull();
  });

  test('demarrer() est idempotent : un second appel ne planifie pas un second scheduler', () => {
    const planificateur = planificateurFactice();
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => null),
      missionIdCanari: 'canari',
      planifier: planificateur.planifier,
    });
    verificateur.demarrer();
    verificateur.demarrer();
    expect(planificateur.intervalles).toHaveLength(1);
  });

  test('arreter() annule la planification', () => {
    const planificateur = planificateurFactice();
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => null),
      missionIdCanari: 'canari',
      intervalleMs: 5000,
      planifier: planificateur.planifier,
    });
    verificateur.demarrer();
    verificateur.arreter();
    expect(planificateur.annulations).toEqual([5000]);
  });
});

describe('succès exigeant la preuve complète (forçage réellement exercé)', () => {
  test('un résultat sans l’étape "forcage" est traité comme un échec, pas un succès partiel', async () => {
    const alertes: AlerteDrill[] = [];
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async (missionId) => ({ missionId, sessionId: 's', etapes: ['pause_globale', 'fermeture_propre'] })),
      missionIdCanari: 'canari',
      alerte: (a) => alertes.push(a),
    });
    await verificateur.executerMaintenant();
    expect(verificateur.etat().dernierSuccesA).toBeNull();
    expect(alertes.map((a) => a.motif)).toEqual(['sequence_incomplete']);
  });

  test('cible canari absente (null) : échec explicite, pas un succès silencieux', async () => {
    const alertes: AlerteDrill[] = [];
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => null),
      missionIdCanari: 'canari-disparu',
      alerte: (a) => alertes.push(a),
    });
    await verificateur.executerMaintenant();
    expect(alertes.map((a) => a.motif)).toEqual(['cible_absente']);
  });

  test('le port qui lève une exception ne fait jamais planter le scheduler', async () => {
    const alertes: AlerteDrill[] = [];
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => {
        throw new Error('panne du canal de contrôle');
      }),
      missionIdCanari: 'canari',
      alerte: (a) => alertes.push(a),
    });
    await expect(verificateur.executerMaintenant()).resolves.toBeUndefined();
    expect(alertes.map((a) => a.motif)).toEqual(['drill_echoue']);
  });

  test('un callback d’alerte qui lève est ignoré, jamais propagé', async () => {
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => null),
      missionIdCanari: 'canari',
      alerte: () => {
        throw new Error('callback cassé');
      },
    });
    await expect(verificateur.executerMaintenant()).resolves.toBeUndefined();
  });
});

describe('péremption (☠ un scheduler vivant qui ne réussit plus plus jamais)', () => {
  test('dépassement du seuil depuis le dernier succès ⇒ alerte "drill_perime"', async () => {
    const horlogeFab = horlogeFactice(0);
    const alertes: AlerteDrill[] = [];
    let doitReussir = true;
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async (missionId) =>
        doitReussir ? { missionId, sessionId: 's', etapes: ['pause_globale', 'fermeture_propre', 'forcage'] } : null,
      ),
      missionIdCanari: 'canari',
      seuilAlerteMs: 1000,
      horloge: horlogeFab.horloge,
      alerte: (a) => alertes.push(a),
    });

    await verificateur.executerMaintenant(); // succès à t=0
    expect(verificateur.etat().dernierSuccesA).toBe(0);

    doitReussir = false;
    horlogeFab.avancer(2000); // au-delà du seuil
    await verificateur.executerMaintenant(); // échoue, ET dépassement de fraîcheur

    const motifs = alertes.map((a) => a.motif);
    expect(motifs).toContain('cible_absente');
    expect(motifs).toContain('drill_perime');
  });

  test('aucun succès n’a jamais eu lieu : pas de fausse alerte de péremption (déjà couvert par l’échec du tick)', async () => {
    const alertes: AlerteDrill[] = [];
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async () => null),
      missionIdCanari: 'canari',
      seuilAlerteMs: 1,
      alerte: (a) => alertes.push(a),
    });
    await verificateur.executerMaintenant();
    expect(alertes.map((a) => a.motif)).toEqual(['cible_absente']);
  });

  test('dans le seuil : aucune alerte de péremption', async () => {
    const horlogeFab = horlogeFactice(0);
    const alertes: AlerteDrill[] = [];
    const verificateur = new VerificateurDrillArretUrgence({
      port: portFactice(async (missionId) => ({ missionId, sessionId: 's', etapes: ['pause_globale', 'fermeture_propre', 'forcage'] })),
      missionIdCanari: 'canari',
      seuilAlerteMs: 10_000,
      horloge: horlogeFab.horloge,
      alerte: (a) => alertes.push(a),
    });
    await verificateur.executerMaintenant();
    horlogeFab.avancer(1000);
    await verificateur.executerMaintenant();
    expect(alertes).toEqual([]);
  });
});
