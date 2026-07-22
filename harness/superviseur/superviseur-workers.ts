/**
 * Responsabilité : le superviseur de workers, côté PC (branche B, mission M-13).
 *
 * Implémentation RÉELLE des ports déclarés comme contrats ailleurs — jamais une
 * redéfinition :
 *  - `InventairePc`, `ReinitialisateurSession` (`control-plane/reconciliation/types.ts`, M-30)
 *  - `RepertoireCibles`, `ArreteurMission`, `RelanceurMission` (`mcp-controle/types.ts`, A.2)
 *
 * ☠ Frontière A↔B inexistante (03-couche-1.md) : ce module ne connaît rien du
 * registre SQLite du Pi. Tout ce qu'il sait vient de `DemandeDemarrage` (fourni au
 * dispatch) et de ce qu'il observe lui-même sur le `Query` du worker.
 *
 * **Câblage de `deciderRelance()` (dette M-34)** : ce module est le SEUL endroit du
 * harness qui lit les `SDKResultMessage` réels d'un worker — c'est donc ici, et
 * nulle part ailleurs, que la politique de relance s'applique (`#surveillerResultats`).
 * Un `result` ferme tout le process (mesuré : « après le message result, le transport
 * est fermé »), donc CHAQUE issue de tour est un CHOIX : relancer (resume) ou remonter.
 *
 * **Idempotence** (D.3.1/D.3.2) : ce module fournit l'idempotence NATURELLE de
 * chaque opération (rejouer `arreter`/`relancer`/`tuerSansPreavis` sur un worker déjà
 * dans l'état visé est un no-op, vérifié par l'état du registre AVANT tout effet).
 * L'idempotence PAR IDENTIFIANT fourni par le Pi (dédup mécanique d'un rejeu exact)
 * est portée par `canal-controle.ts`, la couche au-dessus — les deux se combinent :
 * même sans dédup par opId, rejouer ces méthodes n'a jamais d'effet double.
 */

import { deciderRelance } from '../relance/politique-relance.ts';
import type { CompteurRelances } from '../relance/compteur-relances.ts';
import type { DecisionRelance } from '../relance/types.ts';
import type {
  ArreteurMission,
  CibleEquipe,
  RelanceurMission,
  RepertoireCibles,
} from '../control-plane/orchestrateur/mcp-controle/types.ts';
import type {
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from '../control-plane/reconciliation/types.ts';
import { GenerateurEntree } from '../control-plane/orchestrateur/entree/index.ts';
import type { StartWorkerDeps, WorkerHandle } from '../workers/index.ts';
import { startWorker as startWorkerReel } from '../workers/index.ts';
import { missionLogger, superviseurLogger } from './logger.ts';
import { RegistreWorkers } from './registre-workers.ts';
import { extraireDemandesEnAttente } from './reponse-reinitialize.ts';
import type { DemandeDemarrage, ObservateurRelance } from './types.ts';

export class SuperviseurError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperviseurError';
  }
}

/** Signature de `startWorker`, isolée pour l'injection en test (jamais de spawn réel en unitaire). */
export type DemarrerWorkerFn = typeof startWorkerReel;

export interface DependancesSuperviseur {
  readonly compteurRelances: CompteurRelances;
  /** Best-effort (H-15) : la remontée réelle vers le Pi passe par E.2, hors périmètre. */
  readonly observateurRelance?: ObservateurRelance;
  /** Injectable pour les tests : jamais de spawn réel en unitaire (règle du dépôt). */
  readonly demarrerWorker?: DemarrerWorkerFn;
  readonly startWorkerDeps?: StartWorkerDeps;
  /** Ordonnancement du délai de backoff avant une relance. Réel = `setTimeout`, synchrone en test. */
  readonly planifier?: (delaiMs: number, tache: () => void) => void;
}

/**
 * Superviseur de workers du PC (B.1.4, D.3.1). Un worker vivant par mission
 * (H-56) ; un enregistrement mort survit pour permettre la relance (B.3.3).
 */
export class SuperviseurWorkers implements InventairePc, ReinitialisateurSession, RepertoireCibles, ArreteurMission, RelanceurMission {
  readonly #registre = new RegistreWorkers();
  readonly #compteurRelances: CompteurRelances;
  readonly #observateurRelance: ObservateurRelance | undefined;
  readonly #demarrerWorker: DemarrerWorkerFn;
  readonly #startWorkerDeps: StartWorkerDeps;
  readonly #planifier: (delaiMs: number, tache: () => void) => void;

  constructor(deps: DependancesSuperviseur) {
    this.#compteurRelances = deps.compteurRelances;
    this.#observateurRelance = deps.observateurRelance;
    this.#demarrerWorker = deps.demarrerWorker ?? startWorkerReel;
    this.#startWorkerDeps = deps.startWorkerDeps ?? {};
    this.#planifier = deps.planifier ?? ((delaiMs, tache) => void setTimeout(tache, delaiMs));
  }

  /**
   * Démarre un worker neuf (D.3.1, opération `demarrer_worker`). Le premier
   * message est mis en file AVANT le spawn (piège H-60 : un flux silencieux
   * n'émet jamais `init`) ; le flux reste ouvert ensuite pour permettre
   * `envoyer_a_equipe`/`interrompre_equipe` (A.2.2) sur ce worker.
   */
  async demarrer(demande: DemandeDemarrage): Promise<WorkerHandle> {
    const log = missionLogger(demande.missionId);
    const entree = new GenerateurEntree({ sessionId: demande.spec.sessionId });
    await entree.envoyer(demande.promptInitial);

    const handle = await this.#demarrerWorker(demande.spec, entree.flux, this.#startWorkerDeps);
    this.#registre.enregistrer({
      missionId: demande.missionId,
      sessionId: demande.spec.sessionId,
      epoch: demande.epoch,
      worktree: demande.spec.cwd,
      spec: demande.spec,
      handle,
      entree,
      vivant: true,
    });
    log.info({ sessionId: handle.sessionId, epoch: demande.epoch }, 'worker démarré et enregistré (B.1.4)');
    void this.#surveillerResultats(demande.missionId, handle);
    return handle;
  }

  // -- InventairePc (B.1.4 : « inventaire() fait autorité ») -----------------

  inventaire(): readonly DescripteurWorkerPc[] {
    return this.#registre.tous().map((e) => ({
      sessionId: e.sessionId,
      worktree: e.worktree,
      epoch: e.epoch,
      vivant: e.vivant,
    }));
  }

  /**
   * Mort brutale, sans fenêtre de grâce (B.2.2). `☠` Cible l'`AbortController`
   * propre à CE worker — jamais un signal OS par motif générique (incident réel
   * déjà payé sur un hôte partagé). Idempotent par construction : un worker déjà
   * mort ne produit aucun effet supplémentaire.
   */
  tuerSansPreavis(sessionId: string): void {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null || !enregistrement.vivant) return;
    this.#registre.marquerMort(sessionId);
    enregistrement.handle.abortController.abort();
    missionLogger(enregistrement.missionId).warn({ sessionId }, 'worker tué sans préavis (tuerSansPreavis)');
  }

  // -- ReinitialisateurSession (D.2.4, panne #3) -----------------------------

  /**
   * `⚠ HYP à vérifier sur banc réel` — le type public `SDKControlInitializeResponse`
   * (sdk.d.ts) ne déclare PAS de champ `pending_permission_requests`, contrairement
   * au commentaire de `Query.reinitialize()` (« the CLI's response carries any
   * can_use_tool ... requests ... and the SDK redelivers them to canUseTool »). Le
   * champ existe bien sur les types de trame internes (`ControlResponse`,
   * `ControlErrorResponse`) mais pas sur le type de retour exposé. Deux lectures
   * possibles, non tranchées par la seule lecture de `sdk.d.ts` :
   *   (a) le SDK réinjecte lui-même les demandes dans `canUseTool` sans jamais les
   *       exposer à l'appelant — la redélivrance est alors DÉJÀ garantie sans
   *       action de ce module, et `demandesEnAttente` est structurellement vide ;
   *   (b) l'objet réellement résolu porte le champ à l'exécution malgré un type
   *       public plus étroit (les deux déclarations `ControlResponse` internes le
   *       portent). Lecture DÉFENSIVE ci-dessous (`extraireDemandesEnAttente`,
   *       `unknown` + narrowing) : si le champ est présent au runtime, il est
   *       exploité ; s'il est absent, aucune exception, liste vide. Ne PAS
   *       supposer que la redélivrance manuelle via `RedelivranceBusPermissions`
   *       est le seul mécanisme de secours — (a) reste la lecture la plus
   *       probable du commentaire SDK. À confirmer sur banc réel (hors périmètre
   *       de cette mission : interdiction de session Claude Code réelle ici).
   */
  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null || !enregistrement.vivant) {
      superviseurLogger.warn({ sessionId }, 'reinitialiser() demandé sur un worker absent ou mort');
      return { demandesEnAttente: [] };
    }
    const brut = await enregistrement.handle.query.reinitialize();
    const demandesEnAttente = extraireDemandesEnAttente(brut);
    missionLogger(enregistrement.missionId).info(
      { sessionId, demandesEnAttente: demandesEnAttente.length },
      'reinitialize() appelé (D.2.4)',
    );
    return { demandesEnAttente };
  }

  // -- RepertoireCibles (A.2.2) ----------------------------------------------

  cible(missionId: string): CibleEquipe | null {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return null;
    const { entree, handle } = enregistrement;
    return {
      envoyerMessage: (message) => entree.envoyerMessage(message),
      interrupt: () => handle.query.interrupt(),
    };
  }

  // -- ArreteurMission (A.2.2, fin de vie) ------------------------------------

  /**
   * Fin de vie volontaire : ferme légitimement le flux d'entrée (A.1.2, jamais
   * la fermeture NON sollicitée que A.1.3 redoute) puis `query.close()` — voie
   * par défaut, avec fenêtre de grâce (contrairement à `tuerSansPreavis`).
   * Idempotent : une mission déjà arrêtée ne produit aucun effet de plus.
   */
  async arreter(missionId: string): Promise<void> {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return;
    this.#registre.marquerMort(enregistrement.sessionId);
    enregistrement.entree.fermer();
    try {
      enregistrement.handle.query.close();
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "query.close() a levé pendant l'arrêt de la mission");
    }
  }

  // -- RelanceurMission (B.3.3, resume) --------------------------------------

  /**
   * Relance après crash ou après décision automatique de `deciderRelance()`
   * (`#surveillerResultats`). `resume`, jamais `forkSession` (B.3.3 : le contexte
   * est préservé, on continue la même session). Idempotent : si le worker visé
   * est déjà vivant (rejeu, ou double appel), aucun second spawn n'a lieu.
   */
  async relancer(missionId: string, sessionId: string): Promise<void> {
    const existant = this.#registre.parSession(sessionId);
    if (existant !== null && existant.vivant) {
      missionLogger(missionId).debug({ sessionId }, 'relancer() ignoré : worker déjà vivant (idempotence naturelle)');
      return;
    }
    if (existant === null) {
      throw new SuperviseurError(`aucun WorkerSpec connu pour relancer la session ${sessionId} (jamais démarrée ici)`);
    }
    const entree = new GenerateurEntree({ sessionId });
    const handle = await this.#demarrerWorker(existant.spec, entree.flux, { ...this.#startWorkerDeps, resume: true });
    this.#registre.remplacer({
      missionId,
      sessionId,
      epoch: existant.epoch,
      worktree: existant.spec.cwd,
      spec: existant.spec,
      handle,
      entree,
      vivant: true,
    });
    missionLogger(missionId).info({ sessionId }, 'worker relancé (resume, B.3.3)');
    void this.#surveillerResultats(missionId, handle);
  }

  /**
   * Unique lecteur du `Query` d'un worker (H « un seul consommateur par Query »).
   * `☠` C'est ICI, et nulle part ailleurs, que `deciderRelance()` est appelé — ce
   * module est le seul à observer un `SDKResultMessage` réel et son
   * `terminal_reason`. Un `result` clôt tout le process (mesuré) : chaque
   * occurrence est traitée puis la boucle s'arrête (`break`) plutôt que de
   * supposer que le flux continuera de lui-même.
   */
  async #surveillerResultats(missionId: string, handle: WorkerHandle): Promise<void> {
    const log = missionLogger(missionId);
    try {
      for await (const message of handle.query) {
        if (message.type !== 'result') continue;
        this.#registre.marquerMort(handle.sessionId);
        const decision = deciderRelance(handle.sessionId, message.terminal_reason, {
          compteur: this.#compteurRelances,
        });
        log.info({ action: decision.action, motif: decision.motif }, 'terminaison observée, politique de relance appliquée');
        this.#notifierDecision(missionId, decision);
        if (decision.action === 'relancer') {
          this.#planifier(decision.delaiMs, () => {
            this.relancer(missionId, handle.sessionId).catch((erreur: unknown) => {
              log.error({ err: erreur }, 'relance automatique en échec');
            });
          });
        }
        break;
      }
    } catch (erreur) {
      log.error({ err: erreur }, 'boucle de surveillance des résultats interrompue par une exception');
    }
  }

  /**
   * Best-effort (H-15) : notifie un observateur déjà en mémoire, n'ouvre AUCUNE
   * connexion. La remontée réelle vers le Pi passe par le canal d'observation
   * (E.2, hors périmètre) — c'est l'exception documentée de D.3.2 au « le PC
   * n'initie jamais » : ce module lui-même n'initie rien, il se contente
   * d'appeler un callback fourni par l'appelant.
   */
  #notifierDecision(missionId: string, decision: DecisionRelance): void {
    try {
      this.#observateurRelance?.surDecision(missionId, decision);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de relance a levé — ignoré, jamais bloquant");
    }
  }
}
