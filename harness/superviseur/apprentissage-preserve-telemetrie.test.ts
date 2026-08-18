/**
 * `☠` Panne mesurée : `#enfilerApprentissageSiConfigure` (fin de mission, apprentissage
 * actif) lisait `this.#telemetrie.tous()` — DRAINANT, il vide `activitesEnAttente` pour
 * TOUTES les missions du process — alors qu'il n'utilise que `coutUsd` et
 * `contexteTokensUtilises`. Le message final du lead, tout juste ingéré via le `assistant`
 * qui précède le `result`, était donc détruit avant que le balayage périodique du Pi
 * (`SuperviseurWorkers.telemetrie()`, toutes les 5 s côté production) ne vienne l'écrire
 * en base.
 *
 * Ce test reproduit la séquence RÉELLE : un message `assistant` portant du texte (le
 * rapport final du lead), puis un `result` traité avec l'apprentissage actif (E6), puis
 * vérification que l'activité texte est TOUJOURS en attente de drain — c'est-à-dire que
 * le balayage du Pi, qui arrive après, peut encore la trouver.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { SuperviseurWorkers, type DemarrerWorkerFn } from './superviseur-workers.ts';
import type { DemandeDemarrage } from './types.ts';
import type { WorkerCapabilities, WorkerHandle, WorkerSpec } from '../workers/index.ts';

const RAPPORT_FINAL = 'Mission terminée — critère d’arrêt atteint, voir détail ci-dessous.';

function capacites(): WorkerCapabilities {
  return { advertised: [], claudeCodeVersion: '2.1.217', tools: ['Bash'], mcpServers: [], model: 'claude-sonnet-4-6', sessionId: 's' };
}

/** Doublure établie par `superviseur-workers.test.ts` : le flux ne se ferme jamais seul. */
function fakeQuery(messages: readonly SDKMessage[]): Query {
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
    interrupt: async () => ({ still_queued: [] }),
    close: (): void => fermer(),
    reinitialize: async () => ({ commands: [], agents: [], models: [] }),
  }) as unknown as Query;
}

function messageAssistantTexte(sessionId: string, texte: string): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: texte }] },
    uuid: '11111111-2222-3333-4444-555555555555',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function messageResultat(sessionId: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: null,
    total_cost_usd: 0.05,
    usage: {} as never,
    modelUsage: {},
    permission_denials: [],
    terminal_reason: 'completed' as never, // fin normale — pas de relance programmée
    uuid: '22222222-3333-4444-5555-666666666666',
    session_id: sessionId,
  } as unknown as SDKMessage;
}

describe('le message final d’une équipe survit à la passe d’apprentissage', () => {
  test('☠ l’activité texte reste en attente de drain après une fin de mission apprise', async () => {
    const sessionId = 'session-preserve-telemetrie';
    const missionId = 'mission-preserve-telemetrie';
    const dossier = mkdtempSync(join(tmpdir(), 'ccremote-preserve-telemetrie-'));

    // Apprentissage actif (E6), moteur d'inférence injoignable — comme la preuve
    // d'innocuité E6 : ça ne doit rien changer à la propriété testée ici, le chemin de
    // télémétrie s'exécute AVANT tout appel réseau.
    process.env['CCREMOTE_APPRENTISSAGE_ACTIF'] = '1';
    process.env['CCREMOTE_APPRENTISSAGE_DB'] = join(dossier, 'apprentissage.db');
    process.env['CCREMOTE_APPRENTISSAGE_CONFIG_DIR'] = join(dossier, 'compte-vide-inexistant');

    try {
      const demarrerWorker: DemarrerWorkerFn = (async (spec: WorkerSpec) => {
        const handle: WorkerHandle = {
          sessionId: spec.sessionId,
          cwd: spec.cwd,
          capabilities: capacites(),
          model: { requested: 'sonnet', resolved: 'claude-sonnet-4-6', tier: 'sonnet', viaInheritance: false },
          preflight: {
            ok: true,
            cwd: spec.cwd,
            loadedSources: [],
            machineClaudeMdPath: null,
            projectClaudeMdPaths: [],
            effectiveModel: 'sonnet',
            failures: [],
          },
          pid: null,
          pidStarttime: null,
          abortController: new AbortController(),
          query: fakeQuery([messageAssistantTexte(spec.sessionId, RAPPORT_FINAL), messageResultat(spec.sessionId)]),
        };
        return handle;
      }) as unknown as DemarrerWorkerFn;

      const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances(), demarrerWorker });

      const demande: DemandeDemarrage = {
        missionId,
        epoch: 1,
        spec: {
          sessionId,
          cwd: dossier,
          mandate: 'Mission de test — préservation de la télémétrie.',
          deniedToolPatterns: [],
          maxBudgetUsd: 5,
          configDir: join(dossier, 'compte-vide-inexistant'),
          mcpServers: {},
          portAuditPermissions: () => ({}),
        },
        promptInitial: 'go',
      };

      await superviseur.demarrer(demande);

      // Laisse la boucle de surveillance (asynchrone) traiter `assistant` puis `result`,
      // et la passe d'apprentissage (best-effort, ne lève jamais) se dérouler.
      const echeance = Date.now() + 5_000;
      let vivant: boolean | undefined = true;
      while (Date.now() < echeance) {
        vivant = superviseur.inventaire().find((w) => w.sessionId === sessionId)?.vivant;
        if (vivant === false) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(vivant).toBe(false); // la mission doit s'être conclue avant qu'on juge la télémétrie

      // ☠ C'est ICI que la panne se voit : le balayage périodique du Pi passe par
      // `SuperviseurWorkers.telemetrie()`, exactement ce que fait la production toutes
      // les 5 s. Si `#enfilerApprentissageSiConfigure` a drainé la file avec `tous()`,
      // l'activité texte du rapport final a disparu et ne sera JAMAIS écrite en base.
      const releve = await superviseur.telemetrie();
      const mission = releve.find((t) => t.missionId === missionId);
      expect(mission).toBeDefined();
      const activiteTexte = mission?.activitesEnAttente.find((a) => a.type === 'texte' && a.texte === RAPPORT_FINAL);
      expect(activiteTexte).toBeDefined();
    } finally {
      rmSync(dossier, { recursive: true, force: true });
      delete process.env['CCREMOTE_APPRENTISSAGE_ACTIF'];
      delete process.env['CCREMOTE_APPRENTISSAGE_DB'];
      delete process.env['CCREMOTE_APPRENTISSAGE_CONFIG_DIR'];
    }
  });
});
