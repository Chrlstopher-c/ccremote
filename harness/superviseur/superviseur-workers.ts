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
 *
 * **Fencing par epoch** (D.2.3, mission M-11, panne #2) : `demarrer()` est le SEUL
 * point d'entrée qui revendique un worktree — c'est donc le seul endroit où
 * `arbitrerFencing()` doit être consulté. Un candidat au même epoch qu'un détenteur
 * vivant, ou à un epoch inférieur, est REFUSÉ avant tout effet (aucun spawn). Un
 * candidat au epoch strictement supérieur est accepté et les détenteurs périmés
 * du MÊME worktree sont RÉELLEMENT terminés via `tuerSansPreavis` (le même chemin
 * qu'un arrêt d'urgence — abort de leur `AbortController` propre) : « périmé » ne
 * reste jamais un simple libellé dans le registre, un seul process reste en vie.
 */

import { arbitrerFencing, type DetenteurEpoch } from './fencing-epoch.ts';
import { deciderRelance } from '../relance/politique-relance.ts';
import type { CompteurRelances } from '../relance/compteur-relances.ts';
import type { DecisionRelance } from '../relance/types.ts';
import { classifierMessageUsage, deciderActionUsage } from '../budgets/index.ts';
import type { EvenementQuotaObserve, ObservateurUsage } from '../budgets/index.ts';
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
import {
  executerArretUrgenceMission,
  executerArretUrgenceParc,
  type CibleArretUrgence,
  type DependancesArretUrgence,
} from './arret-urgence-sequence.ts';
import type {
  DemandeDemarrage,
  EnregistrementWorker,
  ObservateurFlux,
  ObservateurRelance,
  RapportArretUrgence,
  ResultatArretUnitaireUrgence,
} from './types.ts';

/**
 * Fenêtre de grâce par défaut avant le forçage (G.4.2, mission M-52). `⚠ HYP`
 * — la valeur exacte de B.1.5 (fenêtre de grâce du superviseur) n'a pas été
 * relue ici (hors du fichier de branche unique imposé à cette mission,
 * `10-arbre-G-gardefous.md`) : ce nombre est un défaut raisonnable et
 * délibérément configurable via `arretUrgence(graceMs)`, pas une valeur
 * réputée alignée sur B.1.5 sans vérification. À confirmer contre `05-arbre-B`
 * si une mission future en a besoin.
 */
export const GRACE_ARRET_URGENCE_MS_DEFAUT = 5000;

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
  /**
   * Best-effort (H-15, mission M-51) : quotas (`rate_limit_event`) et messages d'usage
   * classifiés (G.1.4). Même contrat que `observateurRelance` — aucune connexion ouverte.
   */
  readonly observateurUsage?: ObservateurUsage;
  /**
   * Client d'observabilité temps réel (E.2, mission M-50) — best-effort
   * (H-15), jamais bloquant. Reçoit CHAQUE message déjà lu par l'unique
   * consommateur ci-dessous, avant toute autre interprétation.
   */
  readonly observateurFlux?: ObservateurFlux;
  /** Injectable pour les tests : jamais de spawn réel en unitaire (règle du dépôt). */
  readonly demarrerWorker?: DemarrerWorkerFn;
  readonly startWorkerDeps?: StartWorkerDeps;
  /** Ordonnancement du délai de backoff avant une relance. Réel = `setTimeout`, synchrone en test. */
  readonly planifier?: (delaiMs: number, tache: () => void) => void;
  /**
   * Fenêtre de grâce de l'arrêt d'urgence (G.4.2, mission M-52), attendue entre
   * la fermeture propre et le forçage. Réel = `setTimeout`, contrôlable en test
   * (jamais une vraie attente dans un test unitaire).
   */
  readonly attendreGrace?: (delaiMs: number) => Promise<void>;
}

/**
 * Superviseur de workers du PC (B.1.4, D.3.1). Un worker vivant par mission
 * (H-56) ; un enregistrement mort survit pour permettre la relance (B.3.3).
 */
export class SuperviseurWorkers implements InventairePc, ReinitialisateurSession, RepertoireCibles, ArreteurMission, RelanceurMission {
  readonly #registre = new RegistreWorkers();
  readonly #compteurRelances: CompteurRelances;
  readonly #observateurRelance: ObservateurRelance | undefined;
  readonly #observateurUsage: ObservateurUsage | undefined;
  readonly #observateurFlux: ObservateurFlux | undefined;
  readonly #demarrerWorker: DemarrerWorkerFn;
  readonly #startWorkerDeps: StartWorkerDeps;
  readonly #planifier: (delaiMs: number, tache: () => void) => void;
  readonly #attendreGrace: (delaiMs: number) => Promise<void>;

  constructor(deps: DependancesSuperviseur) {
    this.#compteurRelances = deps.compteurRelances;
    this.#observateurRelance = deps.observateurRelance;
    this.#observateurUsage = deps.observateurUsage;
    this.#observateurFlux = deps.observateurFlux;
    this.#demarrerWorker = deps.demarrerWorker ?? startWorkerReel;
    this.#startWorkerDeps = deps.startWorkerDeps ?? {};
    this.#planifier = deps.planifier ?? ((delaiMs, tache) => void setTimeout(tache, delaiMs));
    this.#attendreGrace = deps.attendreGrace ?? ((delaiMs) => new Promise((resolve) => setTimeout(resolve, delaiMs)));
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
   * Arbitre la revendication du worktree (D.2.3, panne #2). Concurrents = tout
   * enregistrement vivant sur le MÊME `cwd`, hors la session candidate elle-même
   * (un rattachement de la session à elle-même n'est jamais un concurrent).
   *
   * `☠ CASSE` — rejeter n'est PAS suffisant sur une égalité d'epoch : sans le
   * traiter comme un cas de première classe (`fencing-epoch.ts`), deux workers du
   * même epoch coexisteraient silencieusement. Ici, une décision `rejete` lève
   * AVANT tout spawn ; une décision `accepte_evince` termine réellement (pas
   * seulement « marque périmé ») chaque détenteur dépassé via `tuerSansPreavis`,
   * qui aborte l'`AbortController` propre à CE worker — le même mécanisme que
   * l'arrêt d'urgence, pas une nouvelle voie de terminaison à auditer séparément.
   */
  #arbitrerFencingWorktree(demande: DemandeDemarrage, log: ReturnType<typeof missionLogger>): void {
    const concurrents: DetenteurEpoch[] = this.#registre
      .tous()
      .filter((e) => e.vivant && e.worktree === demande.spec.cwd && e.sessionId !== demande.spec.sessionId)
      .map((e) => ({ sessionId: e.sessionId, epoch: e.epoch }));

    const decision = arbitrerFencing(concurrents, { sessionId: demande.spec.sessionId, epoch: demande.epoch });

    if (decision.type === 'rejete') {
      log.warn(
        { worktree: demande.spec.cwd, epochCandidat: demande.epoch, motif: decision.motif, epochCourant: decision.epochCourant },
        'demande de démarrage REJETÉE par le fencing epoch (D.2.3, panne #2) — aucun spawn',
      );
      throw new SuperviseurError(
        `fencing epoch : requête rejetée (${decision.motif}) pour le worktree "${demande.spec.cwd}" ` +
          `— epoch candidat ${demande.epoch}, epoch courant ${decision.epochCourant}`,
      );
    }

    if (decision.type === 'accepte_evince') {
      for (const sessionEvincee of decision.sessionsAEvincer) {
        log.warn(
          { worktree: demande.spec.cwd, sessionEvincee, nouvelEpoch: demande.epoch },
          'epoch strictement supérieur revendiqué — TERMINAISON RÉELLE du worker périmé (D.2.3)',
        );
        this.tuerSansPreavis(sessionEvincee);
      }
    }
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

  /**
   * Relaie un `rate_limit_event` brut (H-54/H-63, mission M-51). Best-effort,
   * jamais bloquant : la persistance (registre du Pi) et l'agrégation par compte
   * sont hors périmètre de ce module (frontière A↔B).
   */
  #surveillerQuota(
    missionId: string,
    sessionId: string,
    info: { status: string; rateLimitType?: string; utilization?: number; resetsAt?: number },
  ): void {
    const evenement: EvenementQuotaObserve = {
      missionId,
      sessionId,
      statut: info.status as EvenementQuotaObserve['statut'],
      rateLimitType: info.rateLimitType ?? null,
      utilisation: info.utilization ?? null,
      resetsAt: info.resetsAt ?? null,
    };
    missionLogger(missionId).info({ evenement }, 'rate_limit_event observé (H-54/H-63)');
    try {
      this.#observateurUsage?.surQuota?.(evenement);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de quota a levé — ignoré, jamais bloquant");
    }
  }

  /**
   * Classifie une bannière `system` (G.1.4, panne #16, mission M-51) et relaie la
   * décision. `☠` Ne fait AUCUN effet lui-même (pas de suspension réelle des
   * créations ici) — ce module ignore le registre (frontière A↔B) ; il ne fait
   * que rendre le signal observable, exactement comme `#notifierDecision`.
   */
  #surveillerMessageUsage(missionId: string, texte: string): void {
    const classification = classifierMessageUsage(texte);
    if (classification.categorie === 'aucune') return;
    const decision = deciderActionUsage(classification);
    missionLogger(missionId).info(
      { categorie: decision.classification.categorie, suspendreCreations: decision.suspendreCreations, notifier: decision.notifier },
      'message d’usage classifié (G.1.4)',
    );
    try {
      this.#observateurUsage?.surMessageUsage?.(missionId, decision);
    } catch (erreur) {
      missionLogger(missionId).error({ err: erreur }, "l'observateur de message d'usage a levé — ignoré, jamais bloquant");
    }
  }

  // -- Arrêt d'urgence (G.4, mission M-52) -----------------------------------
  //
  // ☠ Ne passe jamais par l'orchestrateur (a) : accessible uniquement via
  // `CanalControle` (D.3) → ces méthodes. La frontière A↔B inexistante
  // (03-couche-1.md) garantit ce point mécaniquement.
  // ☠ Ne détruit jamais de travail non commité (b) : ni ce fichier ni
  // `arret-urgence-sequence.ts` n'importent `projets/cycle-vie-worktree.ts` —
  // aucun chemin de code vers la suppression d'un worktree n'existe ici.
  // La séquence elle-même (pause → fermeture → grâce → forçage, c) vit dans
  // `arret-urgence-sequence.ts` (limite de 500 lignes de ce fichier).

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
    return executerArretUrgenceMission(this.#cibleArretUrgence(enregistrement), this.#depsArretUrgence(graceMs));
  }

  /**
   * Point d'entrée du bouton d'arrêt d'urgence (G.4.1/G.4.2) : arrête TOUTES
   * les missions vivantes du PC, en parallèle (isolation). Idempotent : un
   * second appel ne trouve que ce qui reste vivant (snapshot à l'instant de
   * l'appel) et ne relève jamais d'exception sur ce qui est déjà à l'arrêt.
   */
  async arretUrgence(graceMs: number = GRACE_ARRET_URGENCE_MS_DEFAUT): Promise<RapportArretUrgence> {
    const cibles = this.#registre.tous().filter((e) => e.vivant).map((e) => this.#cibleArretUrgence(e));
    return executerArretUrgenceParc(cibles, this.#depsArretUrgence(graceMs));
  }

  #cibleArretUrgence(e: EnregistrementWorker): CibleArretUrgence {
    return {
      missionId: e.missionId,
      sessionId: e.sessionId,
      interrupt: () => e.handle.query.interrupt(),
      cible: e.entree,
      capacites: e.handle.capabilities,
    };
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
