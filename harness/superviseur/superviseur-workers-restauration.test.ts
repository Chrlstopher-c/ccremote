/**
 * Câblage bout en bout de la persistance/restauration dans `SuperviseurWorkers`
 * (dette n°1, TODO.md). Ferme M-53 (`validation-proprietes/isolation.test.ts`) avec
 * le VRAI `demarrer()` de production, pas seulement l'arbitre pur.
 *
 * Aucun spawn réel : `demarrerWorker` injecté (règle du dépôt).
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { PersistanceRegistreSqlite } from './persistance-registre.ts';
import { SuperviseurError, SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';

function capacites(overrides: Partial<WorkerCapabilities> = {}): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], model: 'claude-sonnet-4-6', sessionId: 's', ...overrides };
}

function fakeQuery(messages: readonly SDKMessage[] = []): Query {
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => {},
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function specFactice(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: 'sess-intrus',
    cwd: '/worktrees/alpha',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    portAuditPermissions: () => ({}),
    deniedToolPatterns: [],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

function demarrerWorkerFactice(): DemarrerWorkerFn {
  return (async (workerSpec: WorkerSpec) => {
    const handle: WorkerHandle = {
      sessionId: workerSpec.sessionId,
      cwd: workerSpec.cwd,
      capabilities: capacites({ sessionId: workerSpec.sessionId }),
      model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6', tier: 'sonnet', viaInheritance: false },
      preflight: {
        ok: true,
        cwd: workerSpec.cwd,
        loadedSources: ['user', 'project', 'local'],
        machineClaudeMdPath: null,
        projectClaudeMdPaths: [],
        effectiveModel: 'sonnet',
        failures: [],
      },
      pid: null,
      pidStarttime: null,
      abortController: new AbortController(),
      query: fakeQuery(),
    };
    return handle;
  }) as unknown as DemarrerWorkerFn;
}

function demande(overrides: Partial<DemandeDemarrage> = {}): DemandeDemarrage {
  return { missionId: 'mission-intrus', epoch: 1, spec: specFactice(), promptInitial: 'go', ...overrides };
}

describe('restaurer() câblé sur le fencing — fermeture de M-53', () => {
  test('sans persistance injectée : restaurer() est un no-op, comportement historique inchangé', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), demarrerWorker: demarrerWorkerFactice() });
    expect(() => superviseur.restaurer()).not.toThrow();
    const handle = await superviseur.demarrer(demande());
    expect(handle.sessionId).toBe('sess-intrus');
  });

  test('☠ un worker persisté et confirmé vivant fait REJETER un candidat de même epoch (jamais accepté en silence)', async () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 'sess-legitime',
      missionId: 'mission-alpha',
      worktree: '/worktrees/alpha',
      epoch: 3,
      pid: process.pid,
      pidStarttime: null, // volontairement absent ⇒ indetermine (voir revalidation-process.ts) : couvre le
      // biais asymétrique, pas seulement le cas vivant_confirme (test suivant, avec un vrai starttime).
      vivant: true,
      spec: specFactice({ sessionId: 'sess-legitime' }),
    });

    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(),
      persistance,
    });
    superviseur.restaurer();

    // Candidat au MÊME epoch que le concurrent restauré : AVANT cette mission, le
    // registre en mémoire neuf était vide et le candidat était accepté sans trace
    // (M-53). Ici, `#concurrentsFantomes` le rend visible au fencing.
    await expect(superviseur.demarrer(demande({ epoch: 3 }))).rejects.toThrow(SuperviseurError);
  });

  test('un candidat à un epoch strictement supérieur est accepté ET évince le concurrent restauré (jamais silencieux)', async () => {
    const { lireStarttimeProc } = await import('./revalidation-process.ts');
    const starttimeReel = lireStarttimeProc(process.pid);
    expect(starttimeReel).not.toBeNull();

    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 'sess-legitime',
      missionId: 'mission-alpha',
      worktree: '/worktrees/alpha',
      epoch: 3,
      pid: process.pid, // pid réellement vivant, pour que la revalidation à l'éviction confirme "vivant_confirme"
      pidStarttime: starttimeReel,
      vivant: true,
      spec: specFactice({ sessionId: 'sess-legitime' }),
    });

    // `☠` Jamais de vrai `process.kill()` en test unitaire (règle du dépôt) : la
    // terminaison réelle est injectée, ce test vérifie seulement QUE l'éviction a
    // été demandée, sur le bon pid, avec le bon signal.
    const appelsKill: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(),
      persistance,
      terminerConcurrentRestaure: (pid, signal) => appelsKill.push({ pid, signal }),
    });
    superviseur.restaurer();

    // Epoch strictement supérieur (reprise légitime, D.2.3) : accepté, et le
    // concurrent restauré doit apparaître comme évincé dans inventaire() ensuite.
    const handle = await superviseur.demarrer(demande({ epoch: 4 }));
    expect(handle.sessionId).toBe('sess-intrus');

    expect(appelsKill).toEqual([{ pid: process.pid, signal: 'SIGTERM' }]);
    const inventaire = superviseur.inventaire();
    const fantomeApresEviction = inventaire.find((e) => e.sessionId === 'sess-legitime');
    expect(fantomeApresEviction?.vivant).toBe(false); // évincé, pas laissé en vie silencieusement
  });

  test('éviction sans pid connu : aucune terminaison tentée, jamais un crash', async () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 'sess-legitime',
      missionId: 'mission-alpha',
      worktree: '/worktrees/alpha',
      epoch: 3,
      pid: null,
      pidStarttime: null,
      vivant: true,
      spec: specFactice({ sessionId: 'sess-legitime' }),
    });

    const appelsKill: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(),
      persistance,
      terminerConcurrentRestaure: (pid, signal) => appelsKill.push({ pid, signal }),
    });
    superviseur.restaurer();

    await expect(superviseur.demarrer(demande({ epoch: 4 }))).resolves.toBeDefined();
    expect(appelsKill).toEqual([]); // rien à tuer sans pid, mais l'éviction bookkeeping a bien eu lieu
    expect(superviseur.inventaire().find((e) => e.sessionId === 'sess-legitime')?.vivant).toBe(false);
  });

  test('un worker restauré sur un AUTRE worktree ne bloque jamais un candidat sans rapport (isolation)', async () => {
    const persistance = new PersistanceRegistreSqlite({ chemin: ':memory:' });
    persistance.sauvegarder({
      sessionId: 'sess-legitime-beta',
      missionId: 'mission-beta',
      worktree: '/worktrees/beta',
      epoch: 3,
      pid: null,
      pidStarttime: null,
      vivant: true,
      spec: specFactice({ sessionId: 'sess-legitime-beta', cwd: '/worktrees/beta' }),
    });

    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(),
      persistance,
    });
    superviseur.restaurer();

    const handle = await superviseur.demarrer(demande({ epoch: 1 })); // worktree alpha, sans rapport avec beta
    expect(handle.sessionId).toBe('sess-intrus');
  });
});
