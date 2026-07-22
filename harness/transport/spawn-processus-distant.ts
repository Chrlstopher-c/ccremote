/**
 * Responsabilité : adapter un `Lien` (D.1) en `spawnClaudeCodeProcess` (B.2.1)
 * — le point d'extension réel du SDK (Découverte 3 de `01-verification-sdk.md`,
 * `Transport` n'est pas branchable via `Options`).
 *
 * `☠ CASSE` (B.2.2) — `SpawnOptions.signal` est un signal **relayé**, propriété
 * du transport interne du SDK, qui ne se déclenche qu'après stdin-EOF + une
 * fenêtre de grâce (~2 s). Tout ce qui doit s'arrêter immédiatement (kill dur,
 * libération de l'epoch) s'accroche à l'`AbortController` capturé en closure,
 * jamais à ce signal. Le teardown lourd (fermeture propre du lien, libération
 * des ressources côté PC) s'accroche à `options.signal`.
 *
 * `☠ CASSE` (B.1.5, transposé ici) — un spawn distant qui n'expose pas stderr
 * produit un « exit nu » : le SDK ne lit jamais l'OS-stderr d'un process qu'il
 * n'a pas lui-même lancé. `onStderr` (B.2.3) est le seul canal de diagnostic ;
 * l'omettre rend les crashes muets.
 */

import { Readable, Writable } from 'node:stream';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import type { CanalControleProcessus, Lien } from './contrat.ts';
import { transportLogger } from './logger.ts';

export interface DepsSpawnProcessusDistant {
  /** Reçoit le texte de stderr rapatrié — seul canal de diagnostic (B.2.3). */
  readonly onStderr?: (data: string) => void;
}

type EcouteurExit = (code: number | null, signal: NodeJS.Signals | null) => void;
type EcouteurError = (error: Error) => void;

/**
 * Construit la fonction à assigner à `Options.spawnClaudeCodeProcess`.
 * `abortController` doit être **le même objet** que celui posé sur
 * `Options.abortController` — capturé ici en closure pour l'arrêt immédiat.
 */
export function creerSpawnProcessusDistant(
  lien: Lien & CanalControleProcessus,
  abortController: AbortController,
  deps: DepsSpawnProcessusDistant = {},
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess =>
    new ProcessusDistantWs(lien, abortController, options, deps);
}

class ProcessusDistantWs implements SpawnedProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  readonly #ecouteursExit: EcouteurExit[] = [];
  readonly #ecouteursError: EcouteurError[] = [];
  readonly #log = transportLogger.child({ composant: 'spawn-processus-distant' });

  constructor(
    private readonly lien: Lien & CanalControleProcessus,
    abortController: AbortController,
    options: SpawnOptions,
    deps: DepsSpawnProcessusDistant,
  ) {
    this.stdin = this.#construireStdin();
    this.stdout = this.#construireStdout();
    if (deps.onStderr !== undefined) lien.surStderr(deps.onStderr);
    lien.surExit((code, signal) => this.#surExit(code, signal));
    lien.surErreurSpawn((message) => this.#emettreErreur(new Error(`spawn distant en échec : ${message}`)));
    lien.surFermeture((fermeture) => this.#surFermetureTerminale(fermeture.raison));

    // Arrêt immédiat (B.2.2) : capturé en closure, jamais sur `options.signal`.
    abortController.signal.addEventListener('abort', () => this.#arreterImmediatement(), { once: true });
    // Teardown lourd (B.2.2) : sur le signal relayé, après la fenêtre de grâce du SDK.
    options.signal.addEventListener('abort', () => this.#teardownLourd(), { once: true });
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killed = true;
    this.lien.envoyerKill(signal);
    return true;
  }

  on(event: 'exit', listener: EcouteurExit): void;
  on(event: 'error', listener: EcouteurError): void;
  on(event: 'exit' | 'error', listener: EcouteurExit | EcouteurError): void {
    // Cast sûr : le branchement runtime sur `event` respecte exactement la
    // paire (tag, type de listener) garantie par les surcharges ci-dessus.
    if (event === 'exit') this.#ecouteursExit.push(listener as EcouteurExit);
    else this.#ecouteursError.push(listener as EcouteurError);
  }

  once(event: 'exit', listener: EcouteurExit): void;
  once(event: 'error', listener: EcouteurError): void;
  once(event: 'exit' | 'error', listener: EcouteurExit | EcouteurError): void {
    if (event === 'exit') {
      const original = listener as EcouteurExit;
      const enveloppe: EcouteurExit = (code, signal) => {
        this.off('exit', enveloppe);
        original(code, signal);
      };
      this.#ecouteursExit.push(enveloppe);
      return;
    }
    const original = listener as EcouteurError;
    const enveloppe: EcouteurError = (erreur) => {
      this.off('error', enveloppe);
      original(erreur);
    };
    this.#ecouteursError.push(enveloppe);
  }

  off(event: 'exit', listener: EcouteurExit): void;
  off(event: 'error', listener: EcouteurError): void;
  off(event: 'exit' | 'error', listener: EcouteurExit | EcouteurError): void {
    if (event === 'exit') {
      const index = this.#ecouteursExit.indexOf(listener as EcouteurExit);
      if (index >= 0) this.#ecouteursExit.splice(index, 1);
      return;
    }
    const index = this.#ecouteursError.indexOf(listener as EcouteurError);
    if (index >= 0) this.#ecouteursError.splice(index, 1);
  }

  #construireStdin(): Writable {
    return new Writable({
      write: (chunk: unknown, _enc, callback): void => {
        try {
          this.lien.versPc().ecrire(toUint8Array(chunk));
          callback();
        } catch (erreur) {
          callback(erreur instanceof Error ? erreur : new Error(String(erreur)));
        }
      },
    });
  }

  #construireStdout(): Readable {
    const stdout = new Readable({ read: (): void => {} });
    this.lien.versPi().surOctets((octets) => stdout.push(Buffer.from(octets)));
    return stdout;
  }

  #surExit(code: number | null, signal: string | null): void {
    this.exitCode = code;
    // Cast justifié : le PC (hors périmètre M-10) n'envoie que des noms POSIX
    // valides ou `null` dans la trame EXIT ; le contrat n'est pas vérifié ici.
    this.signalCode = signal === null ? null : (signal as NodeJS.Signals);
    this.stdout.push(null);
    for (const a of this.#ecouteursExit) a(this.exitCode, this.signalCode);
  }

  #emettreErreur(erreur: Error): void {
    this.#log.error({ err: erreur }, 'erreur de spawn distant remontée au SDK');
    for (const a of this.#ecouteursError) a(erreur);
  }

  /**
   * Le lien s'est fermé sans notification d'EXIT explicite (ex. 4090, épuisement
   * de retentatives). Sans ceci, l'appelant voit un « exit nu » : le process
   * disparaît sans jamais informer le SDK de la raison.
   */
  #surFermetureTerminale(raison: string): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.#emettreErreur(new Error(`lien fermé sans exit explicite : ${raison}`));
    this.#surExit(null, null);
  }

  #arreterImmediatement(): void {
    if (this.killed) return;
    this.killed = true;
    this.lien.envoyerKill('SIGKILL');
  }

  #teardownLourd(): void {
    this.lien.fermer();
  }
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  throw new TypeError(`chunk stdin non supporté : ${typeof chunk}`);
}
