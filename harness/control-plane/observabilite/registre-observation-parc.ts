/**
 * Responsabilité : observer PLUSIEURS équipes sans saturer l'écran ni la
 * mémoire (acceptation e, mission M-50).
 *
 * Principe : un résumé léger (`ResumeEquipeObservee`) existe pour TOUTES les
 * équipes, quel que soit leur nombre — c'est ce qui alimente la sidebar
 * arborescente (H-67). Le détail complet (arbre de flux, diffusion, tampon
 * d'historique) n'est instancié QUE pour les équipes réellement observées
 * (un client a ouvert leur fil) et libéré dès que le dernier abonné se
 * retire — la mémoire reste bornée par le nombre de fils REGARDÉS, jamais
 * par le nombre de missions qui tournent.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { observabiliteLogger as journal } from './logger.ts';
import { ArbreFluxTempsReel } from './arbre-flux.ts';
import { DiffusionObservation } from './diffusion-observation.ts';
import {
  RACINE_FLUX,
  type BlocPartielFlux,
  type EvenementDiffuse,
  type EvenementFilMission,
  type ModeAbonnement,
  type ResumeEquipeObservee,
} from './types.ts';

interface DetailEquipe {
  readonly arbre: ArbreFluxTempsReel;
  readonly diffusion: DiffusionObservation;
}

/**
 * Au-delà de ce silence, une équipe que plus personne ne réclame voit son détail
 * libéré. `☠` DOIT rester très au-dessus de la cadence de sondage de l'interface :
 * un TTL plus court que l'intervalle entre deux demandes détruirait l'arbre entre
 * chaque appel, et le partiel repartirait de zéro à chaque fois — un écran qui
 * clignote sans que rien ne soit en panne.
 */
const SILENCE_AVANT_LIBERATION_MS = 30_000;

export class RegistreObservationParc {
  readonly #resumes = new Map<string, ResumeEquipeObservee>();
  readonly #details = new Map<string, DetailEquipe>();
  /** Dernière demande d'observation PAR SONDAGE (sans abonnement) — borne la mémoire. */
  readonly #dernieresDemandes = new Map<string, number>();

  /** Appelé par le superviseur à chaque transition d'état connue (E.1.2) — jamais par sondage. */
  majResume(equipeId: string, etat: ResumeEquipeObservee['etat'], dernierResume: string | null, majA: number): void {
    this.#resumes.set(equipeId, { equipeId, etat, dernierResume, majA });
  }

  /** (e) Vue légère, TOUJOURS complète — jamais tronquée quel que soit le nombre d'équipes. */
  resumeParc(): readonly ResumeEquipeObservee[] {
    return [...this.#resumes.values()];
  }

  /** Nombre d'équipes dont le détail est actuellement matérialisé (borne la mémoire réelle). */
  equipesDetaillees(): number {
    return this.#details.size;
  }

  /**
   * Point d'ingestion — appelé par le superviseur pour CHAQUE message du flux
   * qu'il lit déjà (un seul consommateur du `Query`, jamais celui-ci). N'a
   * d'effet que si l'équipe a un détail matérialisé (un client l'observe) :
   * tant que personne ne regarde, l'ingestion est un no-op — pas de coût pour
   * les équipes non observées. Best-effort : jamais bloquant, jamais levé.
   */
  ingererMessageFlux(equipeId: string, message: SDKMessage): void {
    const detail = this.#details.get(equipeId);
    if (detail === undefined) return;
    try {
      for (const fragment of detail.arbre.ingerer(message)) {
        const evenement: EvenementFilMission = {
          nature: 'activite',
          ligneId: fragment.ligneId,
          granularite: fragment.granularite,
          texte: fragment.texte,
          horodatage: Date.now(),
          estRequiresAction: false,
        };
        detail.diffusion.publier(evenement);
      }
    } catch (erreur) {
      journal.error({ erreur, equipeId }, 'ingestion_parc_echouee');
    }
  }

  /** Publie un événement déjà construit ailleurs (ex. permission, `permissions-fil.ts`). */
  publierEvenement(equipeId: string, evenement: EvenementFilMission): void {
    const detail = this.#details.get(equipeId);
    if (detail === undefined) return;
    try {
      detail.diffusion.publier(evenement);
    } catch (erreur) {
      journal.error({ erreur, equipeId }, 'publication_parc_echouee');
    }
  }

  /** Matérialise (ou récupère) le détail d'une équipe — appelé au premier abonnement (H-72.1). */
  ouvrirDetail(equipeId: string): DetailEquipe {
    const existant = this.#details.get(equipeId);
    if (existant !== undefined) return existant;
    const detail: DetailEquipe = { arbre: new ArbreFluxTempsReel(), diffusion: new DiffusionObservation(equipeId) };
    this.#details.set(equipeId, detail);
    return detail;
  }

  /** Libère le détail si plus aucun abonné (mode miroir OU pilote, symétriquement) ne l'observe. */
  fermerDetailSiInactif(equipeId: string): void {
    const detail = this.#details.get(equipeId);
    if (detail === undefined || detail.diffusion.nombreAbonnes() > 0) return;
    this.#details.delete(equipeId);
  }

  arbreDe(equipeId: string): ArbreFluxTempsReel | undefined {
    return this.#details.get(equipeId)?.arbre;
  }

  /**
   * DEMANDE d'observation par sondage : matérialise le détail de CETTE équipe si
   * besoin, puis rend le bloc que son lead est en train de frapper.
   *
   * C'est le second visage d'un abonnement — `abonner()` sert le fil poussé,
   * ceci sert le sondage. Sans lui, `ingererMessageFlux` reste un no-op pour
   * toute équipe qu'aucun client n'a ouverte : le flux entrerait dans le
   * superviseur et ne ressortirait nulle part.
   *
   * `☠` C'est l'APPEL qui matérialise, pas un balayage : une équipe que personne
   * ne regarde ne coûte toujours rien. Et l'appel libère au passage les détails
   * silencieux depuis `SILENCE_AVANT_LIBERATION_MS` — sans quoi la mémoire
   * grossirait avec le nombre d'équipes REGARDÉES UN JOUR, pas regardées
   * maintenant.
   */
  demanderPartielLead(equipeId: string, maintenant: number = Date.now()): BlocPartielFlux | null {
    this.#dernieresDemandes.set(equipeId, maintenant);
    const detail = this.ouvrirDetail(equipeId);
    this.#libererSilencieuses(maintenant);
    return detail.arbre.partielDe(RACINE_FLUX);
  }

  #libererSilencieuses(maintenant: number): void {
    for (const [equipeId, demandeA] of this.#dernieresDemandes) {
      if (maintenant - demandeA < SILENCE_AVANT_LIBERATION_MS) continue;
      this.#dernieresDemandes.delete(equipeId);
      // `fermerDetailSiInactif` refuse tant qu'un abonné pousse : un fil ouvert
      // en SSE ne doit pas perdre son arbre parce qu'un sondeur s'est tu.
      this.fermerDetailSiInactif(equipeId);
    }
  }

  abonner(
    equipeId: string,
    depuisSeq: number,
    mode: ModeAbonnement,
    onEvenement: (evenement: EvenementDiffuse) => void,
  ): ReturnType<DiffusionObservation['sabonner']> {
    const detail = this.ouvrirDetail(equipeId);
    return detail.diffusion.sabonner(depuisSeq, mode, onEvenement);
  }
}
