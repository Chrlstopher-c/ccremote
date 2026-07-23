/**
 * Arrêt d'urgence (G.4, mission M-52).
 *
 * Protège l'acceptation de la mission :
 * (a) le chemin n'a besoin de rien qui vienne de l'orchestrateur — ce fichier
 *     n'importe rien de `control-plane/orchestrateur/` ;
 * (b) aucun test ici ne touche à un worktree réel — la garantie est
 *     structurelle (absence d'import de `cycle-vie-worktree.ts`), pas testée
 *     par une assertion, exactement comme documenté dans le code ;
 * (c) la grâce est respectée : le forçage (abort) n'arrive jamais avant que
 *     la fenêtre de grâce injectée se soit écoulée ;
 * (d) voir `arret-urgence/exercice-periodique.test.ts` pour le test récurrent.
 *
 * Aucun spawn réel : mêmes doublures que `superviseur-workers.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';

function capacites(overrides: Partial<WorkerCapabilities> = {}): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], model: 'claude-sonnet-4-6', sessionId: 's', ...overrides };
}

function fakeQuery(
  overrides: {
    interrupt?: () => Promise<{ still_queued: string[] } | undefined>;
    close?: () => void;
  } = {},
): Query {
  // ☠ Le flux reste OUVERT tant que `close()` n'est pas appelé — c'est le
  // comportement réel du SDK en streaming input (mesuré 23/07). Une doublure qui
  // se termine d'elle-même ferait constater une mort qui n'a pas lieu.
  let fermer = (): void => {};
  const close = new Promise<void>((resolve) => {
    fermer = resolve;
  });
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    // Jamais de message : ces tests n'exercent pas `#surveillerResultats`.
    await close;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: overrides.interrupt ?? (async () => ({ still_queued: [] })),
    close: (): void => {
      fermer();
      overrides.close?.();
    },
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    portAuditPermissions: () => ({}),
    deniedToolPatterns: ['Bash(rm -rf /*)'],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

function demarrerWorkerFactice(fabriqueQuery: (spec: WorkerSpec) => Query): DemarrerWorkerFn {
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
      query: fabriqueQuery(workerSpec),
    };
    return handle;
  }) as unknown as DemarrerWorkerFn;
}

function demande(overrides: Partial<DemandeDemarrage> = {}): DemandeDemarrage {
  return { missionId: 'mission-1', epoch: 1, spec: spec(), promptInitial: 'go', ...overrides };
}

/** Grâce contrôlable en test : ne se résout que quand le test le décide. */
function grasceControlee(): { attendreGrace: (ms: number) => Promise<void>; resoudre: () => void; appelsMs: number[] } {
  const appelsMs: number[] = [];
  let resoudre: () => void = () => {};
  const attendreGrace = (ms: number): Promise<void> => {
    appelsMs.push(ms);
    return new Promise((resolve) => {
      resoudre = resolve;
    });
  };
  return {
    attendreGrace,
    resoudre: () => resoudre(),
    appelsMs,
  };
}

describe('arreterMissionEnUrgence — séquence unitaire', () => {
  test('mission inconnue ou morte : rend null, aucun effet', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    expect(await superviseur.arreterMissionEnUrgence('inconnue')).toBeNull();
  });

  test('☠ (c) le forçage (abort) n’arrive JAMAIS avant la fin de la fenêtre de grâce', async () => {
    let interromptAppele = false;
    let fermetureAppelee = false;
    const grace = grasceControlee();
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      attendreGrace: grace.attendreGrace,
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery({
          interrupt: async () => ((interromptAppele = true), { still_queued: [] }),
          close: () => {
            fermetureAppelee = true;
          },
        }),
      ),
    });
    const handle = await superviseur.demarrer(demande());

    const promesse = superviseur.arreterMissionEnUrgence('mission-1', 999);
    // Laisse les micro-tâches (pause + fermeture) s'exécuter avant la grâce.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(interromptAppele).toBe(true);
    expect(fermetureAppelee).toBe(true);
    expect(grace.appelsMs).toEqual([999]);
    // La grâce n'est PAS encore résolue : le forçage ne doit pas avoir eu lieu.
    expect(handle.abortController.signal.aborted).toBe(false);

    grace.resoudre();
    const resultat = await promesse;

    expect(handle.abortController.signal.aborted).toBe(true);
    expect(resultat?.etapes).toEqual(['pause_globale', 'fermeture_propre', 'forcage']);
  });

  test('la pause globale qui lève n’empêche ni la fermeture ni le forçage (isolation des étapes)', async () => {
    const grace = grasceControlee();
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      attendreGrace: grace.attendreGrace,
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery({
          interrupt: async () => {
            throw new Error('interrupt en échec');
          },
        }),
      ),
    });
    const handle = await superviseur.demarrer(demande());
    const promesse = superviseur.arreterMissionEnUrgence('mission-1', 10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    grace.resoudre();
    const resultat = await promesse;

    expect(resultat?.etapes).toEqual(['fermeture_propre', 'forcage']);
    expect(handle.abortController.signal.aborted).toBe(true);
  });

  test('idempotent : appeler deux fois de suite n’aggrave rien (H-57)', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      attendreGrace: async () => {},
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery()),
    });
    await superviseur.demarrer(demande());
    const r1 = await superviseur.arreterMissionEnUrgence('mission-1', 0);
    // La mission n'est plus "vivante" pour arreterMissionEnUrgence : rejeu = null, pas d'exception.
    const r2 = await superviseur.arreterMissionEnUrgence('mission-1', 0);
    expect(r1?.etapes).toEqual(['pause_globale', 'fermeture_propre', 'forcage']);
    expect(r2).toBeNull();
    // Un appel direct au filet, lui, reste sûr même rejoué (abort() idempotent).
    expect(() => superviseur.forcerArretUrgence(spec().sessionId)).not.toThrow();
  });
});

describe('arretUrgence — tout le parc, en parallèle', () => {
  test('☠ (b) ne touche jamais aux worktrees : aucun IMPORT de cycle-vie-worktree (mentions en prose autorisées)', async () => {
    const source = await Bun.file(new URL('./superviseur-workers.ts', import.meta.url)).text();
    const sourceSequence = await Bun.file(new URL('./arret-urgence-sequence.ts', import.meta.url)).text();
    const importeCycleVie = (texte: string): boolean => /from\s+['"][^'"]*cycle-vie-worktree/.test(texte);
    expect(importeCycleVie(source)).toBe(false);
    expect(importeCycleVie(sourceSequence)).toBe(false);
  });

  test('deux missions vivantes : les deux sont arrêtées, une panne sur l’une n’affecte pas l’autre', async () => {
    let appelsDemarrer = 0;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      attendreGrace: async () => {},
      demarrerWorker: (async (workerSpec: WorkerSpec) => {
        appelsDemarrer += 1;
        const query =
          workerSpec.sessionId === 'session-en-echec'
            ? fakeQuery({
                interrupt: async () => {
                  throw new Error('panne isolée');
                },
              })
            : fakeQuery();
        return demarrerWorkerFactice(() => query)(workerSpec, 'go' as never, undefined as never);
      }) as unknown as DemarrerWorkerFn,
    });
    const a = await superviseur.demarrer(
      demande({ missionId: 'mission-a', spec: spec({ sessionId: 'session-a', cwd: '/tmp/wt-a' }) }),
    );
    const b = await superviseur.demarrer(
      demande({ missionId: 'mission-b', spec: spec({ sessionId: 'session-en-echec', cwd: '/tmp/wt-b' }) }),
    );

    const rapport = await superviseur.arretUrgence(0);

    expect(appelsDemarrer).toBe(2);
    expect(rapport.missions).toHaveLength(2);
    expect(a.abortController.signal.aborted).toBe(true);
    expect(b.abortController.signal.aborted).toBe(true);
    const parMission = new Map(rapport.missions.map((m) => [m.missionId, m]));
    expect(parMission.get('mission-a')?.etapes).toEqual(['pause_globale', 'fermeture_propre', 'forcage']);
    // mission-b : l'interrupt a levé, mais fermeture + forçage ont quand même eu lieu.
    expect(parMission.get('mission-b')?.etapes).toEqual(['fermeture_propre', 'forcage']);
  });

  test('parc vide : rapport vide, aucune exception', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    const rapport = await superviseur.arretUrgence();
    expect(rapport.missions).toEqual([]);
  });

  test('idempotent au niveau du parc : un second déclenchement ne trouve que ce qui reste vivant', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      attendreGrace: async () => {},
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery()),
    });
    await superviseur.demarrer(demande());
    const r1 = await superviseur.arretUrgence(0);
    const r2 = await superviseur.arretUrgence(0);
    expect(r1.missions).toHaveLength(1);
    expect(r2.missions).toHaveLength(0);
  });
});
