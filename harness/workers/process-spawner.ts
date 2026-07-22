/**
 * Responsabilité : spawner local conforme à `SpawnedProcess` (point d'extension
 * B.2.1, `Options.spawnClaudeCodeProcess`), capturant pid + starttime au moment
 * exact du spawn pour fermer la dette n°1 (persistance du registre PC, H-74) —
 * sans cette capture, `WorkerHandle.pid`/`pidStarttime` (workers/types.ts) ne
 * peuvent jamais être alimentés et `restaurerRegistre()` reste condamné à
 * `indetermine` pour toujours (superviseur/revalidation-process.ts, lu en
 * préparation, jamais importé — la frontière A↔B ne se traverse pas plus dans
 * un sens que dans l'autre, cf. persistance-registre.ts).
 *
 * `⚠` Écart connu avec le spawn local intégré du SDK (B.1.5, sdk.d.ts) : celui-ci
 * ne délivre `'exit'` qu'après fermeture de stderr (~2 s de grâce), pour garantir
 * une trace stderr complète dans l'erreur de sortie. Le `ChildProcess` Node
 * utilisé ici émet un `'exit'` nu, sans cette garantie — volontairement pas
 * reproduit (compliquerait le code pour peu de gain) : le superviseur dispose
 * déjà d'un canal stderr séparé (`Options.stderr`, B.2.3, câblé dans
 * `options-composition.ts`), c'est par là que passe le diagnostic, jamais par
 * l'ordonnancement de `'exit'`.
 */

import { spawn as spawnChildProcess } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { workerLogger } from './logger.ts';

/**
 * `starttime` est le 22e champ de `/proc/<pid>/stat`. `comm` (2e champ) est
 * encadré de parenthèses et peut lui-même contenir espaces et parenthèses —
 * seul un découpage après la DERNIÈRE `)` est sûr. Cohérent avec
 * `superviseur/revalidation-process.ts` (dupliqué ici sans import cross-domaine,
 * même convention que `persistance-registre.ts` sur la frontière A↔B).
 */
const INDEX_STARTTIME_APRES_COMM = 19;

/**
 * Identité process capturée au spawn. `pidStarttime === null` est un FAIT
 * explicite (process déjà mort entre le spawn et la lecture, `/proc`
 * indisponible, plateforme non Linux) — jamais confondu avec une valeur par
 * défaut (mission, point 7). Le pid seul ne prouve rien : c'est le couple
 * (pid, starttime) qui identifie un process, jamais le pid nu (recyclage
 * noyau) — ce module ne fait qu'exposer ce couple, aucune décision de
 * vivant/mort ici, ça reste le rôle exclusif de `superviseur/revalidation-process.ts`.
 */
export interface IdentiteProcessSpawn {
  readonly pid: number;
  readonly pidStarttime: string | null;
}

/**
 * Lit le starttime d'un pid tout juste spawné. `null` = fait, pas une panne :
 * mêmes causes qu'en revalidation (process déjà mort entre le spawn et la
 * lecture, `/proc` absent hors Linux).
 */
export function lireStarttimeAuSpawn(pid: number): string | null {
  try {
    const contenu = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const finComm = contenu.lastIndexOf(')');
    if (finComm === -1) return null;
    const champsApresComm = contenu.slice(finComm + 1).trim().split(/\s+/);
    return champsApresComm[INDEX_STARTTIME_APRES_COMM] ?? null;
  } catch (erreur) {
    workerLogger.debug(
      { err: erreur, pid },
      'starttime illisible juste après spawn (process mort, /proc absent, ou plateforme non Linux)',
    );
    return null;
  }
}

type EcouteurSortie = (code: number | null, signal: NodeJS.Signals | null) => void;
type EcouteurErreur = (erreur: Error) => void;

/** Enveloppe un `ChildProcess` Node pour satisfaire `SpawnedProcess` à la lettre. */
class ProcessLocalSpawne implements SpawnedProcess {
  readonly #enfant: ChildProcess;

  constructor(enfant: ChildProcess) {
    this.#enfant = enfant;
  }

  get stdin(): Writable {
    // ☠ stdio forcé à ['pipe','pipe','pipe'] au spawn (creerSpawnerLocal) :
    // stdin/stdout sont donc garantis définis, jamais `null` en pratique.
    return this.#enfant.stdin as Writable;
  }

  get stdout(): Readable {
    return this.#enfant.stdout as Readable;
  }

  get killed(): boolean {
    return this.#enfant.killed;
  }

  get exitCode(): number | null {
    return this.#enfant.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.#enfant.signalCode;
  }

  kill(signal: NodeJS.Signals): boolean {
    return this.#enfant.kill(signal);
  }

  on(event: 'exit', listener: EcouteurSortie): void;
  on(event: 'error', listener: EcouteurErreur): void;
  on(event: 'exit' | 'error', listener: EcouteurSortie | EcouteurErreur): void {
    // Cast justifié : Node garantit la même signature par événement que celle
    // déclarée par `SpawnedProcess` — l'union n'existe côté type que parce que
    // TS ne corrèle pas le littéral `event` à l'overload appelant.
    if (event === 'exit') this.#enfant.on('exit', listener as EcouteurSortie);
    else this.#enfant.on('error', listener as EcouteurErreur);
  }

  once(event: 'exit', listener: EcouteurSortie): void;
  once(event: 'error', listener: EcouteurErreur): void;
  once(event: 'exit' | 'error', listener: EcouteurSortie | EcouteurErreur): void {
    if (event === 'exit') this.#enfant.once('exit', listener as EcouteurSortie);
    else this.#enfant.once('error', listener as EcouteurErreur);
  }

  off(event: 'exit', listener: EcouteurSortie): void;
  off(event: 'error', listener: EcouteurErreur): void;
  off(event: 'exit' | 'error', listener: EcouteurSortie | EcouteurErreur): void {
    if (event === 'exit') this.#enfant.off('exit', listener as EcouteurSortie);
    else this.#enfant.off('error', listener as EcouteurErreur);
  }
}

/**
 * Fabrique un `spawnClaudeCodeProcess` (B.2.1) qui capture pid + starttime au
 * moment exact du spawn et les livre via `onSpawn`, seule voie qui alimente
 * `WorkerHandle.pid`/`pidStarttime` (câblage dans `start-worker.ts`).
 */
export function creerSpawnerLocal(
  onSpawn?: (identite: IdentiteProcessSpawn) => void,
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    let enfant: ChildProcess;
    try {
      enfant = spawnChildProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (erreur) {
      workerLogger.error({ err: erreur, command: options.command }, 'spawn local en échec');
      throw erreur;
    }

    if (enfant.pid === undefined) {
      workerLogger.error({ command: options.command }, 'spawn local : aucun pid immédiatement après spawn (échec probable)');
    } else {
      const pidStarttime = lireStarttimeAuSpawn(enfant.pid);
      if (pidStarttime === null) {
        workerLogger.warn(
          { pid: enfant.pid },
          'pidStarttime non capturé au spawn — la revalidation restera indeterminee pour ce worker au redémarrage',
        );
      }
      onSpawn?.({ pid: enfant.pid, pidStarttime });
    }

    // Le `signal` de SpawnOptions est forwardé par le SDK : il ne se déclenche
    // qu'APRÈS le chemin d'arrêt gracieux (stdin EOF + grâce ~2 s, B.2.2) — le
    // brancher ici sur kill() est donc sûr, ce n'est jamais l'abort brut de
    // l'appelant (celui-là reste en closure côté composition, B.1.3).
    if (options.signal.aborted) {
      enfant.kill('SIGTERM');
    } else {
      options.signal.addEventListener('abort', () => enfant.kill('SIGTERM'), { once: true });
    }

    return new ProcessLocalSpawne(enfant);
  };
}
