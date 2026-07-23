/**
 * Responsabilité : canal de contrôle Pi→PC (branche D, section D.3 — mission M-13).
 *
 * Distinct du canal principal (D.1, `transport/`) : ce qui transite ici ne concerne
 * pas le contenu d'une session (spawn/arrêt d'un worker, inventaire, stderr, santé
 * du PC — D.3.1). Aucun octet de conversation ne passe par ce module.
 *
 * Contrat imposé par D.3.2, tenu MÉCANIQUEMENT ici, pas par convention :
 *  - requête/réponse, idempotent par identifiant d'opération fourni par le Pi ;
 *  - toute opération MUTATIVE portant un `opId` déjà vu retourne le résultat
 *    mémorisé SANS RÉ-EXÉCUTER l'opération sous-jacente — `#executer` n'est
 *    physiquement pas atteint sur un rejeu, voir `traiter()` ;
 *  - `inventaire` (lecture seule) ne passe jamais par le cache : rejouer une
 *    lecture ne produit aucun effet à dédupliquer, et la fraîcheur prime.
 *
 * ☠ « Le PC n'initie jamais » (D.3.2, hors canal d'observation E.2) : `traiter()`
 * est la SEULE méthode publique de cette classe. Elle ne fait que RÉAGIR à un
 * appel entrant — ce module ne détient aucune référence vers un client sortant,
 * aucune méthode d'ici ne peut donc, même par erreur future, ouvrir une connexion
 * vers le Pi de sa propre initiative. C'est la preuve mécanique de l'invariant,
 * pas une discipline d'écriture à vérifier en revue.
 */

import type { DemandeEnAttenteReinitialisation, DescripteurWorkerPc } from '../control-plane/reconciliation/types.ts';
import { superviseurLogger as journal } from './logger.ts';
import type {
  DemandeDemarrage,
  DemandeDemarrageTransportable,
  ParametresSpecTransportables,
  RapportArretUrgence,
  TelemetrieWorker,
} from './types.ts';
import type { WorkerSpec } from '../workers/index.ts';

/**
 * Sous-ensemble de `SuperviseurWorkers` réellement utilisé ici — un port, pas la
 * classe concrète (même esprit que `StartWorkerDeps`, `RepertoireCibles`…) :
 * `SuperviseurWorkers` le satisfait structurellement, une doublure de test aussi,
 * sans dépendre de ses champs privés.
 */
export interface PortSuperviseurControle {
  inventaire(): readonly DescripteurWorkerPc[];
  demarrer(demande: DemandeDemarrage): Promise<{ readonly sessionId: string }>;
  /** Optionnel : une doublure qui ne l'implémente pas rend une liste vide, jamais une panne. */
  telemetrie?(): Promise<readonly TelemetrieWorker[]> | readonly TelemetrieWorker[];
  arreter(missionId: string): Promise<void>;
  tuerSansPreavis(sessionId: string): void | Promise<void>;
  relancer(missionId: string, sessionId: string): Promise<void>;
  reinitialiser(
    sessionId: string,
  ): Promise<{ readonly demandesEnAttente: readonly DemandeEnAttenteReinitialisation[] }>;
  /**
   * G.4, mission M-52 — optionnel : un superviseur qui ne l'implémente pas fait
   * REFUSER l'opération (voir `#executer`) plutôt que de planter sur un appel
   * de méthode absente. `SuperviseurWorkers` réel l'implémente toujours.
   */
  arretUrgence?(graceMs?: number): Promise<RapportArretUrgence>;
  /**
   * Pilotage d'une mission vivante (instruction, pause, reprise). Optionnel au
   * même titre qu'`arretUrgence` et pour la même raison : une doublure de test
   * qui ne l'implémente pas fait REFUSER l'opération, jamais planter sur un
   * appel de méthode absente.
   */
  readonly pilotage?: {
    envoyerInstruction(missionId: string, texte: string): Promise<{ readonly retenue: boolean }>;
    mettreEnPause(missionId: string): Promise<{ readonly enPause: true }>;
    reprendre(missionId: string): Promise<{ readonly enAttenteTransmis: number }>;
  };
}

/** Refus explicite plutôt qu'un plantage sur méthode absente (même règle qu'`arretUrgence`). */
const REFUS_PILOTAGE = {
  ok: false as const,
  effet: 'refuse' as const,
  detail: 'pilotage non câblé sur ce superviseur',
};

const REFUS_DISPATCH = {
  ok: false as const,
  effet: 'refuse' as const,
  detail: "démarrage d'équipe non câblé sur ce superviseur (assembleur de spec absent)",
};

export type OperationControle =
  | { readonly type: 'inventaire' }
  /** Lecture pure : ce que seul le PC observe du flux de ses workers. */
  | { readonly type: 'telemetrie' }
  | { readonly type: 'demarrer_worker'; readonly demande: DemandeDemarrageTransportable }
  | { readonly type: 'arreter_worker'; readonly missionId: string }
  | { readonly type: 'tuer_sans_preavis'; readonly sessionId: string }
  | { readonly type: 'relancer_worker'; readonly missionId: string; readonly sessionId: string }
  | { readonly type: 'reinitialiser'; readonly sessionId: string }
  /**
   * G.4.1/G.4.2, mission M-52 — LE chemin de l'arrêt d'urgence : téléphone →
   * control plane → CE canal (D.3) → superviseur, sans jamais traverser
   * l'orchestrateur (aucune dépendance de ce fichier vers
   * `control-plane/orchestrateur/`, vérifiable statiquement).
   */
  | { readonly type: 'arret_urgence'; readonly graceMs?: number }
  /**
   * A.2.2 — les trois ordres adressés à une mission VIVANTE. `☠` Ils passent
   * tous par `ControleurPause` côté superviseur : une instruction envoyée
   * pendant une pause est retenue, pas injectée dans un agent qu'on croit
   * arrêté (voir `superviseur/pilotage-workers.ts`).
   */
  | { readonly type: 'envoyer_instruction'; readonly missionId: string; readonly texte: string }
  | { readonly type: 'pause_worker'; readonly missionId: string }
  | { readonly type: 'reprendre_worker'; readonly missionId: string };

/** Toute opération mutative — tout sauf `inventaire` (D.3.2). */
type OperationMutative = Exclude<OperationControle, { readonly type: 'inventaire' } | { readonly type: 'telemetrie' }>;

export interface RequeteControle {
  /** Fourni par le Pi. Ignoré pour `inventaire` (lecture seule, jamais mutative). */
  readonly opId: string;
  readonly operation: OperationControle;
}

export type EffetControle = 'applique' | 'rejoue' | 'refuse';

export interface ReponseControle {
  readonly ok: boolean;
  readonly effet: EffetControle;
  readonly detail?: string;
  readonly inventaire?: readonly DescripteurWorkerPc[];
  /** Présent uniquement pour `telemetrie` — lecture pure, hors cache d'idempotence. */
  readonly telemetrie?: readonly TelemetrieWorker[];
  readonly demandesEnAttente?: readonly DemandeEnAttenteReinitialisation[];
  /** Présent uniquement pour `arret_urgence` (G.4, mission M-52). */
  readonly rapportArretUrgence?: RapportArretUrgence;
}

const TAILLE_MAX_CACHE_DEFAUT = 1000;

export interface OptionsCanalControle {
  /** Borne mémoire du cache d'idempotence — un opId très ancien est purgé (FIFO). */
  readonly tailleMaxCache?: number;
  /**
   * Réassemble un `WorkerSpec` complet à partir des données reçues du Pi, en y
   * injectant les ports LOCAUX du PC (audit, bus de permissions). Absent ⇒
   * `demarrer_worker` est refusé explicitement — voir `REFUS_DISPATCH`.
   */
  readonly assemblerSpec?: (parametres: ParametresSpecTransportables) => WorkerSpec;
}

export class CanalControle {
  readonly #superviseur: PortSuperviseurControle;
  readonly #tailleMaxCache: number;
  readonly #assemblerSpec: ((parametres: ParametresSpecTransportables) => WorkerSpec) | undefined;
  /** Cache d'idempotence : opId ⇒ réponse d'une mutation RÉUSSIE (D.3.2). */
  readonly #traitees = new Map<string, ReponseControle>();

  constructor(superviseur: PortSuperviseurControle, options: OptionsCanalControle = {}) {
    this.#superviseur = superviseur;
    this.#tailleMaxCache = options.tailleMaxCache ?? TAILLE_MAX_CACHE_DEFAUT;
    this.#assemblerSpec = options.assemblerSpec;
  }

  /**
   * Point d'entrée unique (voir l'en-tête). Un `opId` déjà présent dans le
   * cache renvoie la réponse mémorisée SANS appeler `#executer` — c'est la
   * garantie mécanique d'idempotence, pas une vérification a posteriori.
   */
  async traiter(requete: RequeteControle): Promise<ReponseControle> {
    if (requete.operation.type === 'inventaire') {
      return { ok: true, effet: 'applique', inventaire: this.#superviseur.inventaire() };
    }

    // `☠` Hors cache d'idempotence, comme `inventaire` : une lecture doit rendre
    // l'état COURANT. La servir depuis le cache figerait l'affichage sur le
    // premier relevé, ce qui est exactement le bug qu'on corrige.
    if (requete.operation.type === 'telemetrie') {
      return { ok: true, effet: 'applique', telemetrie: (await this.#superviseur.telemetrie?.()) ?? [] };
    }

    const dejaTraitee = this.#traitees.get(requete.opId);
    if (dejaTraitee !== undefined) {
      journal.info(
        { opId: requete.opId, type: requete.operation.type },
        'rejeu détecté — réponse mémorisée retournée, AUCUNE ré-exécution (D.3.2)',
      );
      return { ...dejaTraitee, effet: 'rejoue' };
    }

    const reponse = await this.#executer(requete.operation);
    // Seule une mutation RÉUSSIE est mémorisée : un refus/échec transitoire
    // reste rejouable avec un effet réel, pas figé dans un refus définitif.
    if (reponse.ok) this.#memoriser(requete.opId, reponse);
    return reponse;
  }

  async #executer(operation: OperationMutative): Promise<ReponseControle> {
    try {
      switch (operation.type) {
        case 'demarrer_worker': {
          // `☠` Sans assembleur, on REFUSE : construire un spec sans ports
          // donnerait un worker sans audit ni bus de permissions, qui aurait
          // l'air de marcher. Un refus explicite vaut mieux qu'un agent nu.
          if (this.#assemblerSpec === undefined) return REFUS_DISPATCH;
          const d = operation.demande;
          const handle = await this.#superviseur.demarrer({
            missionId: d.missionId,
            epoch: d.epoch,
            promptInitial: d.promptInitial,
            spec: this.#assemblerSpec(d.parametres),
          });
          return { ok: true, effet: 'applique', detail: `worker démarré : ${handle.sessionId}` };
        }
        case 'arreter_worker':
          await this.#superviseur.arreter(operation.missionId);
          return { ok: true, effet: 'applique', detail: `mission arrêtée : ${operation.missionId}` };
        case 'tuer_sans_preavis':
          this.#superviseur.tuerSansPreavis(operation.sessionId);
          return { ok: true, effet: 'applique', detail: `worker tué sans préavis : ${operation.sessionId}` };
        case 'relancer_worker':
          await this.#superviseur.relancer(operation.missionId, operation.sessionId);
          return { ok: true, effet: 'applique', detail: `worker relancé : ${operation.sessionId}` };
        case 'reinitialiser': {
          const resultat = await this.#superviseur.reinitialiser(operation.sessionId);
          return { ok: true, effet: 'applique', demandesEnAttente: resultat.demandesEnAttente };
        }
        case 'arret_urgence': {
          if (this.#superviseur.arretUrgence === undefined) {
            journal.error({}, "arret_urgence demandé mais le superviseur ne l'implémente pas — REFUSÉ, jamais un faux succès");
            return { ok: false, effet: 'refuse', detail: "arrêt d'urgence non câblé sur ce superviseur" };
          }
          const rapport = await this.#superviseur.arretUrgence(operation.graceMs);
          return {
            ok: true,
            effet: 'applique',
            detail: `arrêt d'urgence appliqué à ${rapport.missions.length} mission(s)`,
            rapportArretUrgence: rapport,
          };
        }
        case 'envoyer_instruction': {
          if (this.#superviseur.pilotage === undefined) return REFUS_PILOTAGE;
          const { retenue } = await this.#superviseur.pilotage.envoyerInstruction(operation.missionId, operation.texte);
          return {
            ok: true,
            effet: 'applique',
            // `☠` Dire QUE le message a été retenu, pas seulement qu'il est
            // parti : l'opérateur doit savoir que son agent en pause ne l'a pas
            // encore lu, sans quoi il attend une réaction qui ne viendra qu'à
            // la reprise.
            detail: retenue ? 'instruction retenue — mission en pause, transmise à la reprise' : 'instruction transmise',
          };
        }
        case 'pause_worker': {
          if (this.#superviseur.pilotage === undefined) return REFUS_PILOTAGE;
          await this.#superviseur.pilotage.mettreEnPause(operation.missionId);
          return { ok: true, effet: 'applique', detail: `mission en pause : ${operation.missionId}` };
        }
        case 'reprendre_worker': {
          if (this.#superviseur.pilotage === undefined) return REFUS_PILOTAGE;
          const { enAttenteTransmis } = await this.#superviseur.pilotage.reprendre(operation.missionId);
          return { ok: true, effet: 'applique', detail: `mission reprise, ${enAttenteTransmis} message(s) retenu(s) transmis` };
        }
        default: {
          const exhaustif: never = operation;
          throw new Error(`opération de contrôle non gérée : ${String(exhaustif)}`);
        }
      }
    } catch (erreur) {
      journal.error({ err: erreur, type: operation.type }, 'opération de contrôle en échec');
      return { ok: false, effet: 'refuse', detail: erreur instanceof Error ? erreur.message : String(erreur) };
    }
  }

  #memoriser(opId: string, reponse: ReponseControle): void {
    this.#traitees.set(opId, reponse);
    if (this.#traitees.size <= this.#tailleMaxCache) return;
    const plusAncien = this.#traitees.keys().next().value;
    if (plusAncien !== undefined) this.#traitees.delete(plusAncien);
  }
}
