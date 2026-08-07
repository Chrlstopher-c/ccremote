/**
 * Responsabilité : côté Pi, l'ÉTAT COURANT du bloc en cours de frappe des
 * missions réellement regardées. Rien d'autre.
 *
 * `☠` EN MÉMOIRE, JAMAIS EN BASE. Un partiel est un état volatil, pas un
 * évènement : l'écrire dans SQLite serait un contresens (un texte à moitié
 * frappé, relu plus tard, se lit comme une pensée finie) et userait la carte SD
 * du Pi à raison d'une écriture par sondage et par écran ouvert.
 *
 * `☠` Ce module ne tient AUCUNE boucle. C'est la demande — un client qui ouvre
 * une mission — qui déclenche le relevé suivant. Une cadence posée ici tournerait
 * pour personne la nuit, exactement ce qu'on cherche à ne pas livrer.
 */

import { observabiliteLogger } from './logger.ts';
import type { BlocPartielFlux } from './types.ts';

const journal = observabiliteLogger.child({ composant: 'partiels-missions' });

/** Relevé d'UNE mission sur la machine où elle tourne. Ne lève jamais : rend `null`. */
export type SourcePartielMission = (missionId: string) => Promise<BlocPartielFlux | null>;

/**
 * Au-delà, le dernier relevé n'est plus servi.
 *
 * `☠` Un verdict tiré d'une fenêtre de temps ne survit pas à cette fenêtre. « Le
 * lead écrivait ceci il y a une minute » n'est pas « le lead écrit ceci » : sans
 * cette péremption, un PC qui se tait laisserait à l'écran un bloc figé que
 * l'opérateur lirait comme une équipe en train de travailler.
 */
const FRAICHEUR_MAX_MS = 10_000;

/** Une mission que plus personne ne réclame sort de la mémoire du Pi. */
const SILENCE_AVANT_OUBLI_MS = 60_000;

interface EntreePartiel {
  partiel: BlocPartielFlux | null;
  /** Instant du dernier relevé ABOUTI — sert la péremption. */
  releveA: number;
  /** Instant de la dernière demande d'un client — sert l'oubli. */
  demandeA: number;
}

export interface OptionsEtatPartiels {
  readonly source: SourcePartielMission;
  readonly maintenant?: () => number;
}

export class EtatPartielsMissions {
  readonly #entrees = new Map<string, EntreePartiel>();
  /** Missions dont un relevé est déjà en vol — jamais deux en parallèle sur la même. */
  readonly #enVol = new Set<string>();
  readonly #source: SourcePartielMission;
  readonly #maintenant: () => number;

  constructor(options: OptionsEtatPartiels) {
    this.#source = options.source;
    this.#maintenant = options.maintenant ?? ((): number => Date.now());
  }

  /**
   * Lecture pure et SYNCHRONE — c'est ce que sert la route `/missions/:id`.
   * `null` = rien en cours, ou plus rien de frais : les deux se lisent pareil à
   * l'écran, et aucun des deux n'est une erreur.
   */
  lire(missionId: string): BlocPartielFlux | null {
    const entree = this.#entrees.get(missionId);
    if (entree === undefined) return null;
    if (this.#maintenant() - entree.releveA > FRAICHEUR_MAX_MS) return null;
    return entree.partiel;
  }

  /**
   * Ce qu'appelle la route : rend l'état courant TOUT DE SUITE et demande le
   * relevé suivant en tâche de fond.
   *
   * `☠` Ne bloque JAMAIS sur le lien. Attendre le PC ici ferait payer à chaque
   * ouverture de mission un aller-retour réseau — et jusqu'au délai complet quand
   * le PC est éteint, c'est-à-dire précisément quand la page doit rester vive.
   * Le prix : le premier affichage montre l'état d'avant, jamais celui de
   * l'instant. C'est la définition même d'un relevé perdable.
   */
  demander(missionId: string): BlocPartielFlux | null {
    const maintenant = this.#maintenant();
    const entree = this.#entrees.get(missionId);
    if (entree === undefined) this.#entrees.set(missionId, { partiel: null, releveA: 0, demandeA: maintenant });
    else entree.demandeA = maintenant;
    this.#oublierLesSilencieuses(maintenant);
    // Volontairement non attendue : `rafraichir` ne rejette jamais (try/catch interne).
    void this.rafraichir(missionId);
    return this.lire(missionId);
  }

  /**
   * Relevé explicite, attendable — le point d'entrée pour un déclencheur autre
   * que la route (flux poussé, sondage cadencé par le parent).
   *
   * `☠` Un relevé déjà en vol n'est pas doublé : sur une source lente, un écran
   * qui sonde toutes les secondes empilerait sinon des appels que personne
   * n'attend plus. On saute, on ne fait pas la queue.
   */
  async rafraichir(missionId: string): Promise<void> {
    if (this.#enVol.has(missionId)) return;
    this.#enVol.add(missionId);
    try {
      const partiel = await this.#source(missionId);
      const entree = this.#entrees.get(missionId);
      const maintenant = this.#maintenant();
      if (entree === undefined) this.#entrees.set(missionId, { partiel, releveA: maintenant, demandeA: maintenant });
      else {
        entree.partiel = partiel;
        entree.releveA = maintenant;
      }
    } catch (erreur) {
      // La source est censée ne jamais lever ; si elle le fait, l'état reste
      // celui d'avant et se périmera tout seul — jamais une exception qui
      // remonterait dans une route de lecture.
      journal.debug({ err: erreur, missionId }, 'relevé du partiel en échec — état précédent conservé, il se périmera');
    } finally {
      this.#enVol.delete(missionId);
    }
  }

  /** Nombre de missions suivies — borne la mémoire, lu par les tests. */
  taille(): number {
    return this.#entrees.size;
  }

  #oublierLesSilencieuses(maintenant: number): void {
    for (const [missionId, entree] of this.#entrees) {
      if (maintenant - entree.demandeA < SILENCE_AVANT_OUBLI_MS) continue;
      this.#entrees.delete(missionId);
    }
  }
}
