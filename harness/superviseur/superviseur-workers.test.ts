/**
 * Superviseur de workers (branche B, D.3 — mission M-13).
 *
 * Protège : les ports (`InventairePc`, `ReinitialisateurSession`, `RepertoireCibles`,
 * `ArreteurMission`, `RelanceurMission`) sont implémentés à la lettre des formes
 * déjà publiques ; l'idempotence NATURELLE (rejouer une méthode sur un worker déjà
 * dans l'état visé ne produit aucun effet double) ; le câblage de `deciderRelance()`
 * sur un vrai `SDKResultMessage` observé (☠ dette M-34).
 *
 * Aucun spawn réel : `demarrerWorker` est injecté (règle du dépôt, jamais de
 * session Claude Code réelle en unitaire).
 */

import { describe, expect, test } from 'bun:test';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { EvenementQuotaObserve, ObservateurUsage } from '../budgets/index.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import type { DecisionRelance } from '../relance/types.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';
import { SuperviseurError, SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';

function capacites(overrides: Partial<WorkerCapabilities> = {}): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], mcpServers: [], model: 'claude-sonnet-4-6', sessionId: 's', ...overrides };
}

/** Double de `Query` : un générateur des messages fournis + méthodes de contrôle espionnables. */
function fakeQuery(
  messages: readonly SDKMessage[],
  overrides: {
    interrupt?: () => Promise<{ still_queued: string[] } | undefined>;
    close?: () => void;
    reinitialize?: () => Promise<unknown>;
  } = {},
): Query {
  // ☠ Le flux NE SE TERMINE PAS quand les messages sont épuisés : mesuré sur banc
  // réel (23/07), une session en streaming input reste ouverte après ses `result`
  // et peut repartir seule (fin d'un sous-agent de fond). Une doublure qui se
  // termine tout de suite modélise une session que le SDK n'a jamais eue — et
  // c'est précisément cette croyance qui faisait couper les équipes en plein vol.
  let fermer = (): void => {};
  const close = new Promise<void>((resolve) => {
    fermer = resolve;
  });
  async function* flux(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
    await close;
  }
  const iterateur = flux();
  return Object.assign(iterateur, {
    interrupt: overrides.interrupt ?? (async () => ({ still_queued: [] })),
    close: (): void => {
      fermer();
      overrides.close?.();
    },
    reinitialize: overrides.reinitialize ?? (async () => ({ commands: [], agents: [], models: [] })),
  }) as unknown as Query;
}

function spec(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/tmp/worktree-alpha',
    mandate: 'team leader',
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    mcpServers: {}, portAuditPermissions: () => ({}),
    deniedToolPatterns: ['Bash(rm -rf /*)'],
    maxBudgetUsd: 25,
    ...overrides,
  };
}

/** Construit un `demarrerWorker` factice qui rend un handle autour de la Query fournie. */
function demarrerWorkerFactice(
  fabriqueQuery: (spec: WorkerSpec) => Query,
  appels: WorkerSpec[] = [],
): DemarrerWorkerFn {
  return (async (workerSpec: WorkerSpec) => {
    appels.push(workerSpec);
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

async function laisserPasserLesMicrotaches(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('demarrer + InventairePc', () => {
  test('enregistre le worker et le rend visible dans inventaire()', async () => {
    const appels: WorkerSpec[] = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([]), appels),
    });
    const handle = await superviseur.demarrer(demande());
    expect(handle.sessionId).toBe(spec().sessionId);
    expect(superviseur.inventaire()).toEqual([
      { sessionId: spec().sessionId, worktree: '/tmp/worktree-alpha', epoch: 1, vivant: true },
    ]);
  });
});

describe('RepertoireCibles.cible', () => {
  test('rend null pour une mission inconnue', () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    expect(superviseur.cible('inconnue')).toBeNull();
  });

  test('envoyerMessage et interrupt délèguent au worker réel', async () => {
    let interromptAppele = false;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([], { interrupt: async () => ((interromptAppele = true), { still_queued: [] }) }),
      ),
    });
    await superviseur.demarrer(demande());
    const cible = superviseur.cible('mission-1');
    expect(cible).not.toBeNull();
    await cible?.envoyerMessage({
      type: 'user',
      message: { role: 'user', content: 'texte' },
      parent_tool_use_id: null,
      uuid: 'u1',
      session_id: spec().sessionId,
    } as never);
    await cible?.interrupt();
    expect(interromptAppele).toBe(true);
  });
});

describe('tuerSansPreavis (idempotence naturelle)', () => {
  test('abort le contrôleur précis du worker, jamais un signal générique', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    const handle = await superviseur.demarrer(demande());
    expect(handle.abortController.signal.aborted).toBe(false);
    superviseur.tuerSansPreavis(spec().sessionId);
    expect(handle.abortController.signal.aborted).toBe(true);
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('rejouer sur un worker déjà mort ne relève aucune exception (idempotent)', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    await superviseur.demarrer(demande());
    superviseur.tuerSansPreavis(spec().sessionId);
    expect(() => superviseur.tuerSansPreavis(spec().sessionId)).not.toThrow();
  });

  test('sur une session inconnue : no-op silencieux', () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    expect(() => superviseur.tuerSansPreavis('inconnue')).not.toThrow();
  });
});

describe('ArreteurMission.arreter (idempotence naturelle)', () => {
  test('ferme le flux d’entrée et query.close(), une seule fois même rejouée', async () => {
    let fermetures = 0;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([], { close: () => { fermetures += 1; } })),
    });
    await superviseur.demarrer(demande());
    await superviseur.arreter('mission-1');
    await superviseur.arreter('mission-1'); // rejeu : aucun effet double
    expect(fermetures).toBe(1);
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('mission inconnue : no-op', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    await expect(superviseur.arreter('inconnue')).resolves.toBeUndefined();
  });
});

describe('ReinitialisateurSession.reinitialiser (D.2.4, panne #3)', () => {
  test('worker vivant : appelle réellement query.reinitialize()', async () => {
    let appele = false;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([], {
          reinitialize: async () => {
            appele = true;
            return {
              pending_permission_requests: [
                { request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } },
              ],
            };
          },
        }),
      ),
    });
    await superviseur.demarrer(demande());
    const resultat = await superviseur.reinitialiser(spec().sessionId);
    expect(appele).toBe(true);
    expect(resultat.demandesEnAttente).toEqual([{ requestId: 'req-1', outil: 'Bash' }]);
  });

  test('worker mort ou inconnu : liste vide, jamais d’appel réel', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    const resultat = await superviseur.reinitialiser('inconnue');
    expect(resultat).toEqual({ demandesEnAttente: [] });
  });
});

describe('RelanceurMission.relancer (B.3.3, resume)', () => {
  test('session jamais démarrée ici : refuse explicitement (pas un silence)', async () => {
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    await expect(superviseur.relancer('mission-1', 'inconnue')).rejects.toThrow(SuperviseurError);
  });

  test('déjà vivant : idempotent, aucun second spawn', async () => {
    const appels: WorkerSpec[] = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([]), appels),
    });
    await superviseur.demarrer(demande());
    await superviseur.relancer('mission-1', spec().sessionId);
    expect(appels.length).toBe(1); // le seul spawn est celui de demarrer()
  });

  test('mort : relance avec `resume`, même WorkerSpec', async () => {
    const options: Array<{ resume?: boolean } | undefined> = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: (async (
        workerSpec: WorkerSpec,
        prompt: unknown,
        deps: { resume?: boolean } | undefined,
      ) => {
        options.push(deps);
        return demarrerWorkerFactice(() => fakeQuery([]))(workerSpec, prompt as never, deps as never);
      }) as unknown as DemarrerWorkerFn,
    });
    await superviseur.demarrer(demande());
    superviseur.tuerSansPreavis(spec().sessionId);
    await superviseur.relancer('mission-1', spec().sessionId);
    expect(options[1]?.resume).toBe(true);
    expect(superviseur.inventaire()[0]?.vivant).toBe(true);
  });
});

describe('fencing par epoch (D.2.3, panne #2) — demarrer() arbitre AVANT tout spawn', () => {
  test('scénario "le Pi redémarre" : epoch supérieur évince RÉELLEMENT l’ancien worker', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    const ancien = await superviseur.demarrer(
      demande({ epoch: 1, spec: spec({ sessionId: 'session-ancienne', cwd: '/tmp/worktree-alpha' }) }),
    );
    expect(ancien.abortController.signal.aborted).toBe(false);

    await superviseur.demarrer(
      demande({ epoch: 2, spec: spec({ sessionId: 'session-nouvelle', cwd: '/tmp/worktree-alpha' }) }),
    );

    // ☠ « se termine réellement » : l'AbortController PROPRE à l'ancien worker
    // est aboté — pas un simple champ marqué dans le registre.
    expect(ancien.abortController.signal.aborted).toBe(true);
    expect(superviseur.inventaire()).toEqual([
      { sessionId: 'session-ancienne', worktree: '/tmp/worktree-alpha', epoch: 1, vivant: false },
      { sessionId: 'session-nouvelle', worktree: '/tmp/worktree-alpha', epoch: 2, vivant: true },
    ]);
  });

  test('égalité d’epoch : la requête ENTRANTE est rejetée, l’ancien n’est PAS terminé (le piège déjà payé)', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    const ancien = await superviseur.demarrer(
      demande({ epoch: 3, spec: spec({ sessionId: 'session-a', cwd: '/tmp/worktree-beta' }) }),
    );

    await expect(
      superviseur.demarrer(demande({ epoch: 3, spec: spec({ sessionId: 'session-b', cwd: '/tmp/worktree-beta' }) })),
    ).rejects.toThrow(SuperviseurError);

    // Un seul worker vivant sur le worktree : pas de collision silencieuse.
    expect(ancien.abortController.signal.aborted).toBe(false);
    expect(superviseur.inventaire()).toEqual([
      { sessionId: 'session-a', worktree: '/tmp/worktree-beta', epoch: 3, vivant: true },
    ]);
  });

  test('epoch périmé : requête rejetée, aucun effet sur le worker en place', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    await superviseur.demarrer(
      demande({ epoch: 5, spec: spec({ sessionId: 'session-courante', cwd: '/tmp/worktree-gamma' }) }),
    );

    await expect(
      superviseur.demarrer(
        demande({ epoch: 2, spec: spec({ sessionId: 'session-retardataire', cwd: '/tmp/worktree-gamma' }) }),
      ),
    ).rejects.toThrow(SuperviseurError);

    expect(superviseur.inventaire()).toEqual([
      { sessionId: 'session-courante', worktree: '/tmp/worktree-gamma', epoch: 5, vivant: true },
    ]);
  });

  test('worktrees distincts : aucun arbitrage, deux missions cohabitent normalement', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([])),
    });
    await superviseur.demarrer(
      demande({ missionId: 'mission-alpha', epoch: 1, spec: spec({ sessionId: 'session-alpha', cwd: '/tmp/worktree-alpha' }) }),
    );
    await superviseur.demarrer(
      demande({ missionId: 'mission-beta', epoch: 1, spec: spec({ sessionId: 'session-beta', cwd: '/tmp/worktree-beta' }) }),
    );

    expect(superviseur.inventaire().filter((w) => w.vivant)).toHaveLength(2);
  });
});

describe('câblage de deciderRelance() sur un SDKResultMessage réel', () => {
  function resultMessage(terminal_reason: string): SDKMessage {
    return {
      type: 'result',
      subtype: 'success',
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'ok',
      stop_reason: null,
      total_cost_usd: 0.01,
      usage: {} as never,
      modelUsage: {},
      permission_denials: [],
      terminal_reason: terminal_reason as never,
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: spec().sessionId,
    } as unknown as SDKMessage;
  }

  test('échec transitoire (api_error) : relance automatiquement via resume', async () => {
    const appels: WorkerSpec[] = [];
    const decisions: DecisionRelance[] = [];
    let nombreDeSpawns = 0;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurRelance: { surDecision: (_missionId, decision) => decisions.push(decision) },
      planifier: (_delaiMs, tache) => tache(), // synchrone en test : pas d’attente de backoff réelle
      demarrerWorker: demarrerWorkerFactice(() => {
        nombreDeSpawns += 1;
        return nombreDeSpawns === 1 ? fakeQuery([resultMessage('api_error')]) : fakeQuery([]);
      }, appels),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(decisions.map((d) => d.action)).toEqual(['relancer']);
    // le premier spawn a produit le `result`, la relance automatique en a déclenché un second
    expect(appels.length).toBe(2);
    expect(superviseur.inventaire()[0]?.vivant).toBe(true);
  });

  test('borne atteinte (budget_exhausted) : remonte, ne relance JAMAIS automatiquement', async () => {
    const appels: WorkerSpec[] = [];
    const decisions: DecisionRelance[] = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurRelance: { surDecision: (_missionId, decision) => decisions.push(decision) },
      planifier: (_delaiMs, tache) => tache(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([resultMessage('budget_exhausted')]), appels),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(decisions.map((d) => d.action)).toEqual(['remonter']);
    expect(appels.length).toBe(1); // aucun second spawn
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('fin normale (completed) : rien, le worker reste marqué mort (process terminé)', async () => {
    const decisions: DecisionRelance[] = [];
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurRelance: { surDecision: (_missionId, decision) => decisions.push(decision) },
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([resultMessage('completed')])),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(decisions.map((d) => d.action)).toEqual(['rien']);
  });
});

describe('câblage des budgets (mission M-51) sur un flux réel', () => {
  function rateLimitEvent(overrides: Partial<{ status: string; utilization: number; rateLimitType: string; resetsAt: number }> = {}): SDKMessage {
    return {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: overrides.status ?? 'allowed_warning',
        rateLimitType: overrides.rateLimitType ?? 'five_hour',
        utilization: overrides.utilization ?? 41,
        resetsAt: overrides.resetsAt ?? 1784714400,
      },
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: spec().sessionId,
    } as unknown as SDKMessage;
  }

  function bannièreInformationnelle(content: string): SDKMessage {
    return {
      type: 'system',
      subtype: 'informational',
      content,
      level: 'warning',
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: spec().sessionId,
    } as unknown as SDKMessage;
  }

  function notification(text: string): SDKMessage {
    return {
      type: 'system',
      subtype: 'notification',
      key: 'usage',
      text,
      priority: 'high',
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: spec().sessionId,
    } as unknown as SDKMessage;
  }

  function resultMessageOk(): SDKMessage {
    return {
      type: 'result',
      subtype: 'success',
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'ok',
      stop_reason: null,
      total_cost_usd: 0.01,
      usage: {} as never,
      modelUsage: {},
      permission_denials: [],
      terminal_reason: 'completed' as never,
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: spec().sessionId,
    } as unknown as SDKMessage;
  }

  test('rate_limit_event : relayé à observateurUsage.surQuota(), sans jamais interrompre le flux', async () => {
    const evenements: EvenementQuotaObserve[] = [];
    const observateurUsage: ObservateurUsage = { surQuota: (e) => evenements.push(e) };
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurUsage,
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([rateLimitEvent(), resultMessageOk()])),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(evenements).toEqual([
      {
        missionId: 'mission-1',
        sessionId: spec().sessionId,
        statut: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilisation: 41,
        resetsAt: 1784714400,
      },
    ]);
    // ☠ le rate_limit_event n'a PAS provoqué de break : le `result` qui suit a bien été traité.
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('☠ panne #16 : une bannière d’avertissement ne suspend rien et ne notifie rien', async () => {
    const decisions: unknown[] = [];
    const observateurUsage: ObservateurUsage = { surMessageUsage: (_id, d) => decisions.push(d) };
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurUsage,
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([bannièreInformationnelle("You've used 80% of your five-hour limit."), resultMessageOk()]),
      ),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(decisions).toEqual([
      {
        classification: { categorie: 'avertissement', prefixe: "You've used", texteBrut: "You've used 80% of your five-hour limit." },
        suspendreCreations: false,
        notifier: false,
        tracer: true,
        motif: expect.any(String),
      },
    ]);
  });

  test('une limite réellement atteinte (notification) : suspend les créations ET notifie', async () => {
    const decisions: Array<{ suspendreCreations: boolean; notifier: boolean }> = [];
    const observateurUsage: ObservateurUsage = {
      surMessageUsage: (_id, d) => decisions.push({ suspendreCreations: d.suspendreCreations, notifier: d.notifier }),
    };
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurUsage,
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([notification("You've hit your usage limit for this session."), resultMessageOk()]),
      ),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(decisions).toEqual([{ suspendreCreations: true, notifier: true }]);
  });

  test('texte hors sujet : aucun appel à surMessageUsage (rien à relayer)', async () => {
    let appels = 0;
    const observateurUsage: ObservateurUsage = { surMessageUsage: () => { appels += 1; } };
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurUsage,
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([bannièreInformationnelle('slash command exécutée'), resultMessageOk()])),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(appels).toBe(0);
  });

  test("un observateur qui lève n'interrompt jamais la surveillance (best-effort, H-15)", async () => {
    const observateurUsage: ObservateurUsage = {
      surQuota: () => {
        throw new Error('observateur défaillant');
      },
    };
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      observateurUsage,
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([rateLimitEvent(), resultMessageOk()])),
    });
    await expect(superviseur.demarrer(demande())).resolves.toBeDefined();
    await laisserPasserLesMicrotaches();
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test("sans observateurUsage fourni : aucune exception (port optionnel)", async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([rateLimitEvent(), notification("You're close to your limit."), resultMessageOk()]),
      ),
    });
    await expect(superviseur.demarrer(demande())).resolves.toBeDefined();
    await laisserPasserLesMicrotaches();
  });
});

/**
 * ☠ LE défaut qui coupait des équipes en plein travail (mesuré en prod le 23/07).
 *
 * Un `result` marque la fin d'un TOUR, pas de la session. Le SDK en streaming
 * input rouvre un tour tout seul quand un sous-agent de fond se termine — banc
 * réel : `result` n°1, puis `background_tasks_changed`, `task_notification`,
 * `init`, le lead reprend avec le résultat de son sous-agent, `result` n°2.
 * Le module marquait le worker MORT au premier `result` : les quatre sous-agents
 * d'une vraie mission se sont arrêtés net, deux après cinq lignes.
 */
describe('un `result` pendant des tâches de fond ne tue PAS la session', () => {
  function tachesDeFond(taches: readonly { task_id: string; task_type: string; description: string }[]): SDKMessage {
    return {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: taches,
      uuid: '99999999-2222-3333-4444-555555555555',
      session_id: '11111111-2222-3333-4444-555555555555',
    } as unknown as SDKMessage;
  }

  function resultOk(): SDKMessage {
    return {
      type: 'result',
      subtype: 'success',
      duration_ms: 1,
      duration_api_ms: 1,
      is_error: false,
      num_turns: 1,
      result: 'ok',
      stop_reason: null,
      total_cost_usd: 0.01,
      usage: {} as never,
      modelUsage: {},
      permission_denials: [],
      terminal_reason: 'completed' as never,
      uuid: '11111111-2222-3333-4444-555555555555',
      session_id: '11111111-2222-3333-4444-555555555555',
    } as unknown as SDKMessage;
  }

  test('☠ un sous-agent de fond vit encore : le worker RESTE vivant après le result', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([
          tachesDeFond([{ task_id: 't-1', task_type: 'subagent', description: 'Paragraphe sur la mer' }]),
          resultOk(),
        ]),
      ),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(superviseur.inventaire()[0]?.vivant).toBe(true);
  });

  test('plus aucune tâche de fond : le result vaut bien fin de mission', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([
          tachesDeFond([{ task_id: 't-1', task_type: 'subagent', description: 'en cours' }]),
          // Le sous-agent se termine : le SDK réémet l'ENSEMBLE, désormais vide
          // (sémantique REPLACE — jamais un appariement début/fin).
          tachesDeFond([]),
          resultOk(),
        ]),
      ),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    // ☠ Le sous-agent a fini (ensemble vidé) : le lead a rendu son travail, la
    // mission est FINIE. La laisser ouverte, c'était une équipe « en cours » à
    // vie, synthèse déjà rendue (mesuré sur a122e20c, 23/07).
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('☠ aucune tâche de fond du tout : comportement d’avant INCHANGÉ', async () => {
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() => fakeQuery([resultOk()])),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });

  test('☠ les tâches de fond repartent VIDES à chaque `init` — sinon un worker relancé n’est plus jamais tenu pour fini', async () => {
    const init = {
      type: 'system',
      subtype: 'init',
      uuid: '88888888-2222-3333-4444-555555555555',
      session_id: '11111111-2222-3333-4444-555555555555',
    } as unknown as SDKMessage;
    const superviseur = new SuperviseurWorkers({
      compteurRelances: new CompteurRelances(),
      demarrerWorker: demarrerWorkerFactice(() =>
        fakeQuery([
          tachesDeFond([{ task_id: 't-1', task_type: 'subagent', description: 'héritée' }]),
          init,
          resultOk(),
        ]),
      ),
    });
    await superviseur.demarrer(demande());
    await laisserPasserLesMicrotaches();
    // L'ensemble hérité a bien été purgé : la mission se termine, au lieu de
    // rester indéfiniment « en attente de tâches » qui n'existent plus.
    expect(superviseur.inventaire()[0]?.vivant).toBe(false);
  });
});
