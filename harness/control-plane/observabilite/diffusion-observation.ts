/**
 * Responsabilité : diffusion vers les clients d'observation d'UNE équipe
 * (E.2.3, mission M-50). Contraintes non négociables, reprises de `08-arbre-E` :
 *
 *  - reprise au numéro de séquence (c), jamais un rejeu complet ;
 *  - plusieurs clients simultanés sans interférence ;
 *  - `☠ CASSE` un client lent ne doit JAMAIS exercer de contre-pression
 *    jusqu'au worker (panne #29) : bourrage borné PAR ABONNÉ, abandon des
 *    plus anciens plutôt que blocage — `publier()` est toujours synchrone et
 *    ne peut jamais attendre un lecteur ;
 *  - mode miroir (d) : `AbonnementObservation` n'expose structurellement
 *    aucune méthode mutative (voir `types.ts`) — le mode `'miroir'` n'est
 *    qu'une étiquette pour l'appelant, jamais une bride supplémentaire à
 *    vérifier ici (il n'y a rien à brider).
 */

import { observabiliteLogger as journal } from './logger.ts';
import type { AbonnementObservation, EvenementDiffuse, EvenementFilMission, ModeAbonnement } from './types.ts';

/** Nombre d'événements conservés par abonné avant abandon des plus anciens (panne #29). */
export const CAPACITE_TAMPON_DEFAUT = 500;

interface Abonne {
  readonly id: number;
  readonly mode: ModeAbonnement;
  readonly onEvenement: (evenement: EvenementDiffuse) => void;
}

export class DiffusionObservation {
  #seq = 0;
  readonly #historique: EvenementDiffuse[] = [];
  readonly #abonnes = new Map<number, Abonne>();
  #prochainIdAbonne = 0;
  readonly #capaciteTampon: number;
  readonly #equipeId: string;

  constructor(equipeId: string, capaciteTampon: number = CAPACITE_TAMPON_DEFAUT) {
    this.#equipeId = equipeId;
    this.#capaciteTampon = capaciteTampon;
  }

  hautDeSeq(): number {
    return this.#seq;
  }

  /**
   * Synchrone, jamais bloquante (invariant du module). Un abonné dont le
   * callback lève est isolé — ne doit jamais interrompre la diffusion aux
   * autres ni remonter au worker.
   */
  publier(evenement: EvenementFilMission): EvenementDiffuse {
    this.#seq += 1;
    const diffuse: EvenementDiffuse = { seq: this.#seq, equipeId: this.#equipeId, evenement };
    this.#historique.push(diffuse);
    if (this.#historique.length > this.#capaciteTampon) this.#historique.shift();
    for (const abonne of this.#abonnes.values()) this.#livrer(abonne, diffuse);
    return diffuse;
  }

  /**
   * (c) Reprise au high-water mark : rejoue depuis l'historique borné tout ce
   * qui suit `depuisSeq`, puis abonne pour la suite. `☠` Si `depuisSeq` est
   * antérieur au plus vieux conservé (tampon dépassé, panne #29 déjà
   * appliquée), le rejeu est PARTIEL — jamais silencieux : `troue` le signale.
   */
  sabonner(
    depuisSeq: number,
    mode: ModeAbonnement,
    onEvenement: (evenement: EvenementDiffuse) => void,
  ): { abonnement: AbonnementObservation; rejeu: readonly EvenementDiffuse[]; troue: boolean } {
    const plusAncienConserve = this.#historique[0]?.seq;
    const troue = plusAncienConserve !== undefined && depuisSeq < plusAncienConserve - 1 && depuisSeq >= 0;
    const rejeu = this.#historique.filter((e) => e.seq > depuisSeq);
    const id = this.#prochainIdAbonne++;
    const abonne: Abonne = { id, mode, onEvenement };
    this.#abonnes.set(id, abonne);
    if (troue) journal.warn({ equipeId: this.#equipeId, depuisSeq, plusAncienConserve }, 'reprise_partielle_tampon_depasse');
    return {
      abonnement: { mode, hautDeSeqInitial: this.#seq, fermer: () => this.#abonnes.delete(id) },
      rejeu,
      troue,
    };
  }

  /** (e) Nombre d'abonnés vivants — sert au registre de parc pour borner la mémoire détaillée. */
  nombreAbonnes(): number {
    return this.#abonnes.size;
  }

  #livrer(abonne: Abonne, diffuse: EvenementDiffuse): void {
    try {
      abonne.onEvenement(diffuse);
    } catch (erreur) {
      journal.error({ erreur, equipeId: this.#equipeId, abonneId: abonne.id }, 'livraison_abonne_echouee');
    }
  }
}
