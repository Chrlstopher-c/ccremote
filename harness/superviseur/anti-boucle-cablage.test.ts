/**
 * Tests d'ASSEMBLAGE du câblage anti-boucle (H-68, H-74, mission M-53/M-13) — construisent
 * `SuperviseurWorkers` tel qu'il tourne réellement (pas les unités `anti-boucle/` seules,
 * déjà couvertes ailleurs) et vérifient que le juge injecté produit un effet RÉEL sur la
 * mission : coupure effective d'un côté, aucune coupure jamais sur incertain répété de
 * l'autre (H-74 point 3 : seul un test d'assemblage attrape un garde-fou non branché).
 *
 * Aucun spawn réel : `demarrerWorker` est injecté (règle du dépôt, jamais de session Claude
 * Code réelle en unitaire — mandat de cette mission).
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DecisionCoupure, JugeBoucle, Verdict } from '../anti-boucle/index.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';

function capacites(overrides: Partial<WorkerCapabilities> = {}): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], mcpServers: [], model: 'claude-sonnet-4-6', sessionId: 's', ...overrides };
}

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-anti-boucle',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    mcpServers: {}, portAuditPermissions: () => ({}),
    deniedToolPatterns: ['Bash(rm -rf /*)'],
    maxBudgetUsd: 999,
    ...overrides,
  };
}

function demande(overrides: Partial<DemandeDemarrage> = {}): DemandeDemarrage {
  return { missionId: 'mission-anti-boucle', epoch: 1, spec: spec(), promptInitial: 'go', ...overrides };
}

/** Double de `Query` : un générateur des messages fournis + `close()` espionnable. */
function fakeQuery(messages: readonly SDKMessage[], surClose: () => void = () => {}): Query {
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: async () => ({ still_queued: [] }),
    close: surClose,
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function demarrerWorkerFactice(fabriqueQuery: (spec: WorkerSpec) => Query, appels: WorkerSpec[] = []): DemarrerWorkerFn {
  return (async (workerSpec: WorkerSpec) => {
    appels.push(workerSpec);
    const handle: WorkerHandle = {
      pid: null,
      pidStarttime: null,
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
      abortController: new AbortController(),
      query: fabriqueQuery(workerSpec),
    };
    return handle;
  }) as unknown as DemarrerWorkerFn;
}

/** `terminal_reason: 'api_error'` (groupe transitoire) — relancerait automatiquement en l'absence d'anti-boucle. */
function resultMessage(totalCostUsd: number, terminalReason: string = 'api_error'): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: null,
    total_cost_usd: totalCostUsd,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    terminal_reason: terminalReason as never,
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: spec().sessionId,
  } as unknown as SDKMessage;
}

function jugeConstant(verdict: Verdict, motif = 'test'): JugeBoucle {
  return { juger: async () => ({ verdict, motif }) };
}

async function laisserPasserLesMicrotaches(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('câblage anti-boucle (H-68) — assemblage réel de SuperviseurWorkers', () => {
  test('palier franchi + verdict « boucle » : la mission est RÉELLEMENT arrêtée, jamais relancée', async () => {
    const appels: WorkerSpec[] = [];
    let closeAppele = false;
    const decisions: DecisionCoupure[] = [];

    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      jugeBoucle: jugeConstant('boucle', 'mêmes outils sur les mêmes cibles, aucune progression'),
      configAntiBoucle: { paliers: { seuilsUsd: [10] } },
      observateurAntiBoucle: { surDecision: (_missionId, decision) => decisions.push(decision) },
      planifier: (_delaiMs, tache) => tache(), // synchrone : si une relance était planifiée, elle s'exécuterait ici
      demarrerWorker: demarrerWorkerFactice(
        () => fakeQuery([resultMessage(15)], () => (closeAppele = true)),
        appels,
      ),
    });

    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();

    expect(decisions.map((d) => d.action)).toEqual(['couper']);
    // Le filet de dernier recours : AUCUN second spawn, la relance transitoire normale est bloquée.
    expect(appels.length).toBe(1);
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
    // Preuve que `arreter()` a RÉELLEMENT tourné (pas seulement le `marquerMort` du résultat) :
    // `entree.fermer()` + `query.close()` ne sont invoqués QUE par `arreter()` sur ce chemin.
    expect(closeAppele).toBe(true);
  });

  test('verdict « incertain » répété : ne coupe JAMAIS, la mission continue jusqu’à l’escalade', async () => {
    const appels: WorkerSpec[] = [];
    const decisions: DecisionCoupure[] = [];
    let nombreDeSpawns = 0;

    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      jugeBoucle: jugeConstant('incertain', 'signaux ambigus'),
      configAntiBoucle: { paliers: { seuilsUsd: [1, 2, 3] }, seuilEscaladeIncertains: 3 },
      observateurAntiBoucle: { surDecision: (_missionId, decision) => decisions.push(decision) },
      planifier: (_delaiMs, tache) => tache(),
      demarrerWorker: demarrerWorkerFactice(() => {
        nombreDeSpawns += 1;
        // Chaque segment franchit exactement UN nouveau palier (coût cumulé 1.1 → 2.2 → 3.3 —
        // volontairement PAS 1.5×3 : 1.5+1.5=3.0 franchirait déjà les paliers 2 ET 3 d'un coup).
        return fakeQuery([resultMessage(1.1)]);
      }, appels),
    });

    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    await laisserPasserLesMicrotaches();
    await laisserPasserLesMicrotaches();

    // Jamais de « couper » : le biais asymétrique (H-68) est respecté même après 3 incertains.
    expect(decisions.some((d) => d.action === 'couper')).toBe(false);
    expect(decisions.map((d) => d.action)).toEqual(['continuer', 'continuer', 'escalader']);
    // Les 2 premiers incertains n'ont RIEN bloqué : la relance transitoire normale a eu lieu
    // deux fois (spawn initial + 2 relances) avant que l'escalade ne mette la suite en attente.
    expect(appels.length).toBe(3);
    expect(nombreDeSpawns).toBe(3);
  });
});
