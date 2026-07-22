/**
 * Responsabilité : le superviseur de workers, côté PC (branche B, mission M-13).
 *
 * Implémentation RÉELLE des ports déclarés comme contrats ailleurs — jamais une
 * redéfinition : `InventairePc`/`ReinitialisateurSession` (`control-plane/
 * reconciliation/types.ts`, M-30), `RepertoireCibles`/`ArreteurMission`/
 * `RelanceurMission` (`mcp-controle/types.ts`, A.2).
 *
 * ☠ Frontière A↔B inexistante (03-couche-1.md) : ce module ne connaît rien du
 * registre SQLite du Pi. Tout ce qu'il sait vient de `DemandeDemarrage` (fourni au
 * dispatch) et de ce qu'il observe lui-même sur le `Query` du worker.
 *
 * **`deciderRelance()` (dette M-34)** : seul endroit du harness qui lit les
 * `SDKResultMessage` réels (`#surveillerResultats`) — un `result` ferme tout le
 * process (mesuré), donc chaque issue de tour est un CHOIX : relancer ou remonter.
 *
 * **Idempotence** (D.3.1/D.3.2) : NATURELLE ici (rejouer `arreter`/`relancer`/
 * `tuerSansPreavis` sur un worker déjà dans l'état visé est un no-op, vérifié
 * AVANT tout effet). L'idempotence PAR IDENTIFIANT (dédup d'un rejeu exact) est
 * portée par `canal-controle.ts` au-dessus — les deux se combinent.
 *
 * **Fencing par epoch** (D.2.3, M-11, panne #2) : `demarrer()` est le SEUL point
 * qui revendique un worktree. Même epoch ou inférieur ⇒ REFUSÉ avant tout effet.
 * Epoch strictement supérieur ⇒ accepté, détenteurs périmés du MÊME worktree
 * RÉELLEMENT terminés via `tuerSansPreavis` (même chemin que l'arrêt d'urgence).
 */

import { creerCablageAntiBoucle, type CablageAntiBoucle } from './anti-boucle-workers.ts';
import { arbitrerFencingWorktree } from './fencing-arbitrage-workers.ts';
import { deciderRelance } from '../relance/politique-relance.ts';
import type { CompteurRelances } from '../relance/compteur-relances.ts';
import type { DecisionRelance } from '../relance/types.ts';
import type { ObservateurUsage } from '../budgets/index.ts';
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
import { surveillerMessageUsage, surveillerQuota } from './budgets-workers.ts';
import { ConcurrentsRestaures } from './fencing-restauration.ts';
import { missionLogger, superviseurLogger } from './logger.ts';
import type { PersistanceRegistre } from './persistance-registre.ts';
import { RegistreWorkers } from './registre-workers.ts';
import { extraireDemandesEnAttente } from './reponse-reinitialize.ts';
import {
  construireCibleArretUrgence,
  executerArretUrgenceMission,
  executerArretUrgenceParc,
  type DependancesArretUrgence,
} from './arret-urgence-sequence.ts';
import type {
  DemandeDemarrage,
  ObservateurFlux,
  ObservateurRelance,
  RapportArretUrgence,
  ResultatArretUnitaireUrgence,
} from './types.ts';
import {
  GRACE_ARRET_URGENCE_MS_DEFAUT,
  SuperviseurError,
  type DemarrerWorkerFn,
  type DependancesSuperviseur,
} from './superviseur-workers-types.ts';

// Ré-exportés pour ne rien changer à l'API publique (`superviseur/index.ts` les
// importe depuis ce fichier) — extraction structurelle uniquement (dette n°4a).
export { GRACE_ARRET_URGENCE_MS_DEFAUT, SuperviseurError, type DemarrerWorkerFn, type DependancesSuperviseur };

/**
 * Superviseur de workers du PC (B.1.4, D.3.1). Un worker vivant par mission
 * (H-56) ; un enregistrement mort survit pour permettre la relance (B.3.3).
 */
export class SuperviseurWorkers implements InventairePc, ReinitialisateurSession, RepertoireCibles, ArreteurMission, RelanceurMission {
  readonly #registre: RegistreWorkers;
  readonly #compteurRelances: CompteurRelances;
  readonly #observateurRelance: ObservateurRelance | undefined;
  readonly #observateurUsage: ObservateurUsage | undefined;
  readonly #observateurFlux: ObservateurFlux | undefined;
  readonly #demarrerWorker: DemarrerWorkerFn;
  readonly #startWorkerDeps: StartWorkerDeps;
  readonly #planifier: (delaiMs: number, tache: () => void) => void;
  readonly #attendreGrace: (delaiMs: number) => Promise<void>;
  readonly #persistance: PersistanceRegistre | undefined;
  readonly #terminerConcurrentRestaure: (pid: number, signal: NodeJS.Signals) => void;
  /** Concurrents restaurés depuis la persistance (dette n°1) — voir `fencing-restauration.ts`. */
  readonly #concurrentsRestaures = new ConcurrentsRestaures();
  readonly #antiBoucle: CablageAntiBoucle; // juge anti-boucle H-68 — voir anti-boucle-workers.ts

  constructor(deps: DependancesSuperviseur) {
    this.#compteurRelances = deps.compteurRelances;
    this.#observateurRelance = deps.observateurRelance;
    this.#observateurUsage = deps.observateurUsage;
    this.#observateurFlux = deps.observateurFlux;
    this.#demarrerWorker = deps.demarrerWorker ?? startWorkerReel;
    this.#startWorkerDeps = deps.startWorkerDeps ?? {};
    this.#planifier = deps.planifier ?? ((delaiMs, tache) => void setTimeout(tache, delaiMs));
    this.#attendreGrace = deps.attendreGrace ?? ((delaiMs) => new Promise((resolve) => setTimeout(resolve, delaiMs)));
    this.#persistance = deps.persistance;
    this.#terminerConcurrentRestaure = deps.terminerConcurrentRestaure ?? ((pid, signal) => void process.kill(pid, signal));
    this.#registre = new RegistreWorkers(deps.persistance ?? null);
    this.#antiBoucle = creerCablageAntiBoucle(deps);
  }

  /**
   * Restaure le registre depuis la persistance disque (dette n°1, TODO.md) — à
   * appeler UNE FOIS au démarrage, avant tout `demarrer()`. No-op sans persistance.
   * Voir `ConcurrentsRestaures.restaurer()` (`fencing-restauration.ts`).
   */
  restaurer(): void {
    if (this.#persistance === undefined) return;
    this.#concurrentsRestaures.restaurer(this.#persistance);
  }

  /**
   * Démarre un worker neuf (D.3.1, opération `demarrer_worker`). Le premier
   * message est mis en file AVANT le spawn (piège H-60 : un flux silencieux
   * n'émet jamais `init`) ; le flux reste ouvert ensuite pour permettre
   * `envoyer_a_equipe`/`interrompre_equipe` (A.2.2) sur ce worker.
   *
   * `☠` Le fencing (D.2.3) est arbitré ICI, EN PREMIER — avant toute création de
   * `GenerateurEntree` ou tout spawn : un candidat rejeté ne doit produire AUCUN
   * effet de bord. Voir `#arbitrerFencingWorktree`.
   */
  async demarrer(demande: DemandeDemarrage): Promise<WorkerHandle> {
    const log = missionLogger(demande.missionId);
    this.#arbitrerFencingWorktree(demande, log);
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

  /** Inclut les concurrents restaurés (dette n°1) : les taire mentirait sur ce que « le PC fait autorité » (B.1.4) signifie après un redémarrage. */
  inventaire(): readonly DescripteurWorkerPc[] {
    const reels = this.#registre.tous().map((e) => ({
      sessionId: e.sessionId,
      worktree: e.worktree,
      epoch: e.epoch,
      vivant: e.vivant,
    }));
    const fantomes = this.#concurrentsRestaures.tous().map((f) => ({
      sessionId: f.sessionId,
      worktree: f.worktree,
      epoch: f.epoch,
      vivant: f.vivant,
    }));
    return [...reels, ...fantomes];
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
   * `☠` **HYP TRANCHÉE le 2026-07-22 (H-73)** sur le code du SDK : c'est la lecture
   * (a). Le SDK **consomme** lui-même les demandes en attente pour les **rejouer par
   * `canUseTool`** ; il ne les remonte jamais par la valeur de retour. Donc
   * `demandesEnAttente` est **structurellement toujours vide** et ne doit jamais se
   * lire « aucune demande en attente » : elle ne mesure rien. Ce qui garantit
   * réellement la redélivrance est la présence de `canUseTool` dans les options du
   * worker (H-73.1) — sans lui, la demande rejouée est perdue en silence.
   */
  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null || !enregistrement.vivant) {
      superviseurLogger.warn({ sessionId }, 'reinitialiser() demandé sur un worker absent ou mort');
      return { demandesEnAttente: [] };
    }
    const brut = await enregistrement.handle.query.reinitialize();
    const demandesEnAttente = extraireDemandesEnAttente(brut);
    if (demandesEnAttente.length > 0) {
      // Contredirait H-73 : le SDK est censé les avoir consommées lui-même.
      superviseurLogger.warn(
        { sessionId, demandesEnAttente: demandesEnAttente.length },
        'reinitialize() a remonté des demandes en attente — contredit H-73, à investiguer',
      );
    }
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

  /** Fencing par epoch (D.2.3, panne #2) — implémentation extraite dans `fencing-arbitrage-workers.ts` (dette n°4a). */
  #arbitrerFencingWorktree(demande: DemandeDemarrage, log: ReturnType<typeof missionLogger>): void {
    arbitrerFencingWorktree(
      {
        registre: this.#registre,
        concurrentsRestaures: this.#concurrentsRestaures,
        tuerSansPreavis: (sessionId) => this.tuerSansPreavis(sessionId),
        terminerConcurrentRestaure: this.#terminerConcurrentRestaure,
      },
      demande,
      log,
    );
  }

  /**
   * Unique lecteur du `Query` d'un worker (H « un seul consommateur par Query »).
   * `☠` C'est ICI, et nulle part ailleurs, que `deciderRelance()` est appelé — ce
   * module est le seul à observer un `SDKResultMessage` réel et son
   * `terminal_reason`. Un `result` clôt tout le process (mesuré) : chaque
   * occurrence est traitée puis la boucle s'arrête (`break`) plutôt que de
   * supposer que le flux continuera de lui-même.
   *
   * `rate_limit_event` et les bannières `system`/informational|notification
   * (mission M-51, G.1.4/H-54/H-63) sont observés AVANT le `result` — ils
   * arrivent en cours de tour, jamais après — et ne provoquent PAS de `break` :
   * seul un `result` ferme le flux.
   */
  async #surveillerResultats(missionId: string, handle: WorkerHandle): Promise<void> {
    const log = missionLogger(missionId);
    try {
      for await (const message of handle.query) {
        this.#notifierFlux(missionId, message);
        this.#antiBoucle.accumuler(missionId, message);
        if (message.type === 'rate_limit_event') {
          this.#surveillerQuota(missionId, handle.sessionId, message.rate_limit_info);
          continue;
        }
        if (message.type === 'system' && (message.subtype === 'informational' || message.subtype === 'notification')) {
          const texte = message.subtype === 'informational' ? message.content : message.text;
          this.#surveillerMessageUsage(missionId, texte);
          continue;
        }
        if (message.type !== 'result') continue;
        // ☠ H-68 : `marquerMort` est retardé jusqu'ici — un `couper` doit trouver le worker
        // encore `vivant` pour que `arreter()` (appelé PAR le câblage anti-boucle) produise un
        // effet réel (`entree.fermer()` + `query.close()`), pas un no-op sur un mort déjà marqué.
        const actionAntiBoucle = await this.#antiBoucle.evaluerEtAppliquer(missionId, message, (id) => this.arreter(id));
        if (actionAntiBoucle !== 'couper') this.#registre.marquerMort(handle.sessionId);
        const decision = deciderRelance(handle.sessionId, message.terminal_reason, {
          compteur: this.#compteurRelances,
        });
        log.info({ action: decision.action, motif: decision.motif }, 'terminaison observée, politique de relance appliquée');
        this.#notifierDecision(missionId, decision);
        // ☠ H-68 : `couper`/`escalader` priment sur `deciderRelance`, jamais l'inverse (log déjà émis par `#antiBoucle`).
        if (decision.action === 'relancer' && actionAntiBoucle !== 'couper' && actionAntiBoucle !== 'escalader') {
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

  /**
   * Relaie CHAQUE message vu par l'unique consommateur au client
   * d'observabilité (E.2, mission M-50) — avant toute autre interprétation,
   * jamais entrelacé avec un appel de contrôle (piège mesuré H-72.3).
   * Best-effort, jamais bloquant, jamais interrompt la boucle de surveillance.
   */
  #notifierFlux(missionId: string, message: Parameters<ObservateurFlux['ingererMessageFlux']>[1]): void {
    try {
      this.#observateurFlux?.ingererMessageFlux(missionId, message);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de flux a levé — ignoré, jamais bloquant");
    }
  }

  /** Relaie un `rate_limit_event` brut (H-54/H-63, mission M-51). Voir `budgets-workers.ts` (dette n°4a). */
  #surveillerQuota(missionId: string, sessionId: string, info: Parameters<typeof surveillerQuota>[3]): void {
    surveillerQuota(this.#observateurUsage, missionId, sessionId, info);
  }

  /** Classifie une bannière `system` d'usage (G.1.4, mission M-51). Voir `budgets-workers.ts` (dette n°4a). */
  #surveillerMessageUsage(missionId: string, texte: string): void {
    surveillerMessageUsage(this.#observateurUsage, missionId, texte);
  }

  // -- Arrêt d'urgence (G.4, mission M-52) -----------------------------------
  // ☠ (a) Jamais via l'orchestrateur : accessible uniquement via `CanalControle`
  // (D.3), frontière A↔B inexistante (03-couche-1.md). ☠ (b) Aucun worktree
  // détruit : ni ce fichier ni `arret-urgence-sequence.ts` n'importent
  // `projets/cycle-vie-worktree.ts`. Séquence (pause → fermeture → grâce →
  // forçage, c) dans `arret-urgence-sequence.ts` (limite 500 lignes).

  /**
   * Filet de dernier recours (c) — DIFFÉRENT de `tuerSansPreavis()` : celui-ci
   * refuse d'agir dès que `vivant === false` (B.2.2, usage routinier, où un
   * enregistrement mort n'a jamais besoin d'être re-tué). Or `arreter()`
   * marque `vivant = false` de façon OPTIMISTE, avant même que `query.close()`
   * ait fini son cycle de grâce interne (~2 s, 01-verification-sdk.md) — un
   * filet qui se fierait au même drapeau ne se déclencherait donc JAMAIS après
   * une fermeture propre déjà tentée. `AbortController.abort()` est nativement
   * idempotent : c'est ce qui rend sûr d'appeler cette méthode SANS condition
   * sur `vivant`, y compris quand la fermeture propre a déjà réussi.
   */
  forcerArretUrgence(sessionId: string): void {
    const enregistrement = this.#registre.parSession(sessionId);
    if (enregistrement === null) return;
    this.#registre.marquerMort(sessionId);
    enregistrement.handle.abortController.abort();
    missionLogger(enregistrement.missionId).warn(
      { sessionId },
      "arrêt d'urgence : forçage appliqué (filet de dernier recours, idempotent, G.4)",
    );
  }

  /**
   * Arrêt d'urgence ciblé sur UNE mission (G.4). Utilisé par le déclenchement
   * global (`arretUrgence()`) et par le banc de drill récurrent (G.4.3,
   * `arret-urgence/exercice-periodique.ts`) — c'est la même vraie séquence de
   * production qui est exercée à froid, pas une simulation.
   */
  async arreterMissionEnUrgence(
    missionId: string,
    graceMs: number = GRACE_ARRET_URGENCE_MS_DEFAUT,
  ): Promise<ResultatArretUnitaireUrgence | null> {
    const enregistrement = this.#registre.parMission(missionId);
    if (enregistrement === null || !enregistrement.vivant) return null;
    return executerArretUrgenceMission(construireCibleArretUrgence(enregistrement), this.#depsArretUrgence(graceMs));
  }

  /**
   * Point d'entrée du bouton d'arrêt d'urgence (G.4.1/G.4.2) : arrête TOUTES
   * les missions vivantes du PC, en parallèle (isolation). Idempotent : un
   * second appel ne trouve que ce qui reste vivant (snapshot à l'instant de
   * l'appel) et ne relève jamais d'exception sur ce qui est déjà à l'arrêt.
   */
  async arretUrgence(graceMs: number = GRACE_ARRET_URGENCE_MS_DEFAUT): Promise<RapportArretUrgence> {
    const cibles = this.#registre.tous().filter((e) => e.vivant).map(construireCibleArretUrgence);
    return executerArretUrgenceParc(cibles, this.#depsArretUrgence(graceMs));
  }

  #depsArretUrgence(graceMs: number): DependancesArretUrgence {
    return {
      fermerProprement: (missionId: string) => this.arreter(missionId),
      forcer: (sessionId: string) => this.forcerArretUrgence(sessionId),
      attendreGrace: this.#attendreGrace,
      graceMs,
    };
  }
}
