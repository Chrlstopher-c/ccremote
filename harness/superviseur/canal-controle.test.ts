/**
 * Canal de contrôle (D.3) — mission M-13, le cœur de l'acceptation.
 *
 * Protège MÉCANIQUEMENT : un rejeu de la MÊME opération mutative (même `opId`)
 * n'exécute jamais deux fois l'effet sous-jacent ; `inventaire` (lecture seule)
 * n'est jamais mis en cache ; ce module n'a aucune méthode publique en dehors de
 * `traiter()` (preuve que « le PC n'initie jamais »).
 */

import { describe, expect, test } from 'bun:test';
import type { DescripteurWorkerPc } from '../control-plane/reconciliation/types.ts';
import { CanalControle, type PortSuperviseurControle } from './canal-controle.ts';
import type { DemandeDemarrage } from './types.ts';

function demande(): DemandeDemarrage {
  return {
    missionId: 'mission-1',
    epoch: 1,
    spec: {
      sessionId: 's1',
      cwd: '/tmp/worktree-alpha',
      mandate: 'team leader',
      deniedToolPatterns: [],
      maxBudgetUsd: 25,
    },
    promptInitial: 'go',
  };
}

interface Compteurs {
  demarrer: number;
  arreter: number;
  tuerSansPreavis: number;
  relancer: number;
  reinitialiser: number;
  inventaire: number;
}

/** Superviseur factice : compte les appels réels, ne spawne jamais rien. */
function superviseurFactice(): PortSuperviseurControle & { compteurs: Compteurs } {
  const compteurs: Compteurs = {
    demarrer: 0,
    arreter: 0,
    tuerSansPreavis: 0,
    relancer: 0,
    reinitialiser: 0,
    inventaire: 0,
  };
  return {
    compteurs,
    inventaire(): readonly DescripteurWorkerPc[] {
      compteurs.inventaire += 1;
      return [{ sessionId: 's1', worktree: '/tmp/worktree-alpha', epoch: 1, vivant: true }];
    },
    async demarrer(_d: DemandeDemarrage) {
      compteurs.demarrer += 1;
      return { sessionId: 's1' };
    },
    async arreter(_missionId: string) {
      compteurs.arreter += 1;
    },
    tuerSansPreavis(_sessionId: string) {
      compteurs.tuerSansPreavis += 1;
    },
    async relancer(_missionId: string, _sessionId: string) {
      compteurs.relancer += 1;
    },
    async reinitialiser(_sessionId: string) {
      compteurs.reinitialiser += 1;
      return { demandesEnAttente: [] };
    },
  };
}

describe('idempotence mécanique par opId (D.3.2)', () => {
  test('☠ rejouer arreter_worker avec le même opId ne ré-exécute jamais le port', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);
    const requete = { opId: 'op-1', operation: { type: 'arreter_worker' as const, missionId: 'mission-1' } };

    const r1 = await canal.traiter(requete);
    const r2 = await canal.traiter(requete);
    const r3 = await canal.traiter(requete);

    expect(superviseur.compteurs.arreter).toBe(1);
    expect(r1.effet).toBe('applique');
    expect(r2.effet).toBe('rejoue');
    expect(r3.effet).toBe('rejoue');
  });

  test('☠ même garantie pour relancer_worker (« arrête X rejouée » de la mission)', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);
    const requete = {
      opId: 'op-2',
      operation: { type: 'relancer_worker' as const, missionId: 'mission-1', sessionId: 's1' },
    };
    await canal.traiter(requete);
    await canal.traiter(requete);
    expect(superviseur.compteurs.relancer).toBe(1);
  });

  test('même garantie pour tuer_sans_preavis, demarrer_worker, reinitialiser', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);

    await canal.traiter({ opId: 'op-tuer', operation: { type: 'tuer_sans_preavis', sessionId: 's1' } });
    await canal.traiter({ opId: 'op-tuer', operation: { type: 'tuer_sans_preavis', sessionId: 's1' } });
    expect(superviseur.compteurs.tuerSansPreavis).toBe(1);

    await canal.traiter({ opId: 'op-demarrer', operation: { type: 'demarrer_worker', demande: demande() } });
    await canal.traiter({ opId: 'op-demarrer', operation: { type: 'demarrer_worker', demande: demande() } });
    expect(superviseur.compteurs.demarrer).toBe(1);

    await canal.traiter({ opId: 'op-reinit', operation: { type: 'reinitialiser', sessionId: 's1' } });
    await canal.traiter({ opId: 'op-reinit', operation: { type: 'reinitialiser', sessionId: 's1' } });
    expect(superviseur.compteurs.reinitialiser).toBe(1);
  });

  test('deux opId distincts sur la même mission ⇒ deux exécutions réelles (pas un dédup global)', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);
    await canal.traiter({ opId: 'op-a', operation: { type: 'arreter_worker', missionId: 'mission-1' } });
    await canal.traiter({ opId: 'op-b', operation: { type: 'arreter_worker', missionId: 'mission-1' } });
    expect(superviseur.compteurs.arreter).toBe(2);
  });

  test('un échec n’est jamais mis en cache — un opId identique peut réellement retenter', async () => {
    const superviseur = superviseurFactice();
    let premierAppel = true;
    superviseur.arreter = async () => {
      if (premierAppel) {
        premierAppel = false;
        throw new Error('échec transitoire simulé');
      }
      superviseur.compteurs.arreter += 1;
    };
    const canal = new CanalControle(superviseur);
    const requete = { opId: 'op-retry', operation: { type: 'arreter_worker' as const, missionId: 'mission-1' } };

    const r1 = await canal.traiter(requete);
    expect(r1.ok).toBe(false);
    expect(r1.effet).toBe('refuse');

    const r2 = await canal.traiter(requete);
    expect(r2.ok).toBe(true);
    expect(r2.effet).toBe('applique'); // vraie ré-exécution, pas un rejeu depuis le cache
    expect(superviseur.compteurs.arreter).toBe(1);
  });
});

describe('inventaire (lecture seule, jamais mise en cache)', () => {
  test('chaque appel invoque réellement le port, même avec le même opId', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);
    await canal.traiter({ opId: 'peu-importe', operation: { type: 'inventaire' } });
    await canal.traiter({ opId: 'peu-importe', operation: { type: 'inventaire' } });
    expect(superviseur.compteurs.inventaire).toBe(2);
  });

  test('rend l’inventaire courant du superviseur', async () => {
    const superviseur = superviseurFactice();
    const canal = new CanalControle(superviseur);
    const reponse = await canal.traiter({ opId: 'x', operation: { type: 'inventaire' } });
    expect(reponse.inventaire).toEqual([{ sessionId: 's1', worktree: '/tmp/worktree-alpha', epoch: 1, vivant: true }]);
  });
});

describe('le PC ne pousse rien, il répond (D.3.2)', () => {
  test('CanalControle n’expose aucune méthode publique en dehors de traiter()', () => {
    const canal = new CanalControle(superviseurFactice());
    const methodes = Object.getOwnPropertyNames(Object.getPrototypeOf(canal)).filter((nom) => nom !== 'constructor');
    expect(methodes).toEqual(['traiter']);
  });
});
