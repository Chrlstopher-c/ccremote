/**
 * Responsabilité : point d'intégration unique de la discipline de contexte
 * (A.1.4 + E.4.1) pour la session orchestrateur — colle `EchantillonneurContexte`
 * et `ObservateurCompaction` sous une seule surface, pour que le futur câblage
 * de session (M-41) n'ait qu'un seul objet à construire et interroger.
 *
 * Ne réimplémente aucune logique : compose les deux primitives déjà testées
 * indépendamment. `resume()` est la forme destinée à la jauge H-63.
 */
import { EchantillonneurContexte, type OptionsEchantillonneur } from './echantillonneur-contexte.ts'
import { ObservateurCompaction, type OptionsObservateurCompaction } from './observateur-compaction.ts'
import type {
  EtatEchantillonnage,
  EvenementCompactionObserve,
  MesureContexte,
  SourceContexte,
} from './contrats.ts'

export interface ResumeDisciplineContexte {
  readonly etatEchantillonnage: EtatEchantillonnage
  readonly derniereMesure: MesureContexte | null
  readonly dernierEvenementCompaction: EvenementCompactionObserve | null
  readonly compactionsPathologiques: number
}

export interface OptionsSentinelleContexte {
  readonly echantillonneur?: OptionsEchantillonneur
  readonly observateurCompaction?: OptionsObservateurCompaction
}

export class SentinelleContexte {
  readonly #echantillonneur: EchantillonneurContexte
  readonly #observateurCompaction: ObservateurCompaction

  constructor(source: SourceContexte, options: OptionsSentinelleContexte = {}) {
    this.#echantillonneur = new EchantillonneurContexte(source, options.echantillonneur)
    this.#observateurCompaction = new ObservateurCompaction(options.observateurCompaction)
  }

  demarrer(): void {
    this.#echantillonneur.demarrer()
  }

  /** À appeler dès réception du `SDKResultMessage` — voir garde de transport fermé. */
  arreter(): void {
    this.#echantillonneur.arreter()
  }

  observerCompactionHook(trigger: 'manual' | 'auto', tokens?: { pre?: number; post?: number }): EvenementCompactionObserve {
    return this.#observateurCompaction.observerHook(trigger, tokens)
  }

  observerCompactionMessage(
    trigger: 'manual' | 'auto',
    tokens?: { pre?: number; post?: number },
  ): EvenementCompactionObserve {
    return this.#observateurCompaction.observerMessage(trigger, tokens)
  }

  resume(): ResumeDisciplineContexte {
    const evenements = this.#observateurCompaction.evenements()
    return {
      etatEchantillonnage: this.#echantillonneur.etat,
      derniereMesure: this.#echantillonneur.derniereMesure,
      dernierEvenementCompaction: evenements.at(-1) ?? null,
      compactionsPathologiques: this.#observateurCompaction.evenementsDefaut().length,
    }
  }
}
