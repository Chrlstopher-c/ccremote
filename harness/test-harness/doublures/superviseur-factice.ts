// Doublure du superviseur de workers (PC). Aucun processus réel n'est lancé :
// un « worker » est un enregistrement. Le fencing par epoch est activable pour
// pouvoir démontrer la panne #2 (deux workers sur un worktree, sans erreur).

import type {
  DemandeSpawn,
  DescripteurWorker,
  IdWorker,
  SuperviseurWorkers,
} from '../contrats/superviseur.ts';
import type { JournalPannes } from '../journal/journal-pannes.ts';

interface EtatWorker {
  id: IdWorker;
  worktree: string;
  sessionId: string;
  epoch: number;
  vivant: boolean;
  exitCode: number | null;
  signalCode: string | null;
  stderrRapatrie: boolean;
  stderr: string[];
}

export interface OptionsSuperviseur {
  /** D.2.3. À `false`, deux workers coexistent silencieusement sur un worktree. */
  readonly fencingEpoch: boolean;
  /** B.1.5. À `false`, une mort brutale produit un exit nu : crash muet. */
  readonly stderrRapatrie: boolean;
}

export const OPTIONS_SUPERVISEUR_SAINES: OptionsSuperviseur = {
  fencingEpoch: true,
  stderrRapatrie: true,
};

export class SuperviseurFactice implements SuperviseurWorkers {
  #prochainId = 1;
  readonly #workers = new Map<IdWorker, EtatWorker>();

  constructor(
    private readonly journal: JournalPannes,
    private options: OptionsSuperviseur = OPTIONS_SUPERVISEUR_SAINES,
  ) {}

  configurer(options: Partial<OptionsSuperviseur>): void {
    this.options = { ...this.options, ...options };
  }

  spawner(demande: DemandeSpawn): DescripteurWorker {
    const etat: EtatWorker = {
      id: `w${this.#prochainId++}`,
      worktree: demande.worktree,
      sessionId: demande.sessionId,
      epoch: demande.epoch,
      vivant: true,
      exitCode: null,
      signalCode: null,
      stderrRapatrie: this.options.stderrRapatrie,
      stderr: [],
    };
    this.#workers.set(etat.id, etat);
    this.journal.enregistrer('worker_spawne', { id: etat.id, ...demande });
    this.#arbitrerWorktree(etat);
    return this.#figer(etat);
  }

  inventaire(): readonly DescripteurWorker[] {
    return [...this.#workers.values()].filter((w) => w.vivant).map((w) => this.#figer(w));
  }

  workersSurWorktree(worktree: string): readonly DescripteurWorker[] {
    return this.inventaire().filter((w) => w.worktree === worktree);
  }

  tuerSansPreavis(id: IdWorker): void {
    const etat = this.#workers.get(id);
    if (etat === undefined || !etat.vivant) return;
    etat.vivant = false;
    etat.exitCode = null;
    etat.signalCode = 'SIGKILL';
    if (!etat.stderrRapatrie) this.journal.enregistrer('exit_nu', { id });
    else etat.stderr.push('worker tué sans préavis (SIGKILL)');
    this.journal.enregistrer('worker_mort', { id, brutal: true, muet: !etat.stderrRapatrie });
  }

  arreterProprement(id: IdWorker): void {
    const etat = this.#workers.get(id);
    if (etat === undefined || !etat.vivant) return;
    etat.vivant = false;
    etat.exitCode = 0;
    etat.signalCode = null;
    this.journal.enregistrer('worker_mort', { id, brutal: false, muet: false });
  }

  stderrDe(id: IdWorker): readonly string[] {
    return this.#workers.get(id)?.stderr ?? [];
  }

  /** Fencing : un worker d'epoch inférieur est rejeté et doit se terminer. */
  #arbitrerWorktree(nouveau: EtatWorker): void {
    const concurrents = [...this.#workers.values()].filter(
      (w) => w.vivant && w.worktree === nouveau.worktree && w.id !== nouveau.id,
    );
    if (concurrents.length === 0) return;
    if (!this.options.fencingEpoch) {
      this.journal.enregistrer('double_worker_worktree', {
        worktree: nouveau.worktree,
        ids: [...concurrents.map((w) => w.id), nouveau.id],
      });
      return;
    }
    const epochCourant = Math.max(nouveau.epoch, ...concurrents.map((w) => w.epoch));
    for (const perime of [...concurrents, nouveau].filter((w) => w.epoch < epochCourant)) {
      this.#rejeter(perime, epochCourant);
    }
    // Égalité d'epoch : le fencing ne tranche pas, deux workers coexisteraient.
    if (concurrents.some((w) => w.vivant && w.epoch === nouveau.epoch)) {
      this.#rejeter(nouveau, epochCourant);
    }
  }

  #rejeter(worker: EtatWorker, epochCourant: number): void {
    worker.vivant = false;
    worker.exitCode = 1;
    worker.signalCode = null;
    this.journal.enregistrer('worker_rejete_epoch_perime', {
      id: worker.id,
      epochPerime: worker.epoch,
      epochCourant,
    });
  }

  #figer(etat: EtatWorker): DescripteurWorker {
    return {
      id: etat.id,
      worktree: etat.worktree,
      sessionId: etat.sessionId,
      epoch: etat.epoch,
      vivant: etat.vivant,
      exitCode: etat.exitCode,
      signalCode: etat.signalCode,
      stderrRapatrie: etat.stderrRapatrie,
    };
  }
}
