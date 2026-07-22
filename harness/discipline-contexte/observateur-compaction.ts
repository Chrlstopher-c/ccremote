/**
 * Responsabilité : observer les compactions de la session orchestrateur et
 * distinguer la compaction NORMALE de la compaction PATHOLOGIQUE — A.1.4
 * point 3 / E.4.1, le cœur de la mission M-42 (critère c).
 *
 * H-62 fait autorité et borne ce module : l'orchestrateur autocompacte par
 * conception, c'est voulu. Ce composant n'empêche RIEN — il classe. Une
 * compaction `trigger: 'manual'` (bouton de compaction manuelle, H-62) n'est
 * JAMAIS un défaut : c'est un geste opérateur volontaire. Seules les
 * compactions `'auto'` entrent dans le calcul de fréquence.
 *
 * Deux sources vérifiées (A.1.4, sdk.d.ts) : le hook `PreCompact`/`PostCompact`
 * et le message `SDKCompactBoundaryMessage` du flux. Rien ne garantit qu'une
 * seule source rapporte un événement donné — `#observer` fusionne les deux
 * signaux d'un même événement physique plutôt que de les compter deux fois
 * (voir `SeuilsPathologie.dedupMs`).
 */
import { HORLOGE_REELLE, type Horloge } from './horloge.ts'
import { disciplineContexteLogger as journal } from './logger.ts'
import {
  SEUILS_PATHOLOGIE_PAR_DEFAUT,
  type EvenementCompactionObserve,
  type OrigineCompaction,
  type SeuilsPathologie,
  type SeveriteCompaction,
  type SignalCompaction,
  type TriggerCompaction,
} from './contrats.ts'

interface DernierEvenement {
  evenement: EvenementCompactionObserve
  readonly origines: Set<OrigineCompaction>
}

export interface OptionsObservateurCompaction {
  readonly horloge?: Horloge
  readonly seuils?: SeuilsPathologie
  /** Appelé pour tout événement — normal ou défaut. */
  readonly surEvenement?: (evenement: EvenementCompactionObserve) => void
  /** Appelé seulement quand `severite === 'defaut'` — c'est le signal qui doit crier. */
  readonly surDefaut?: (evenement: EvenementCompactionObserve) => void
}

export class ObservateurCompaction {
  readonly #horloge: Horloge
  readonly #seuils: SeuilsPathologie
  readonly #surEvenement: OptionsObservateurCompaction['surEvenement']
  readonly #surDefaut: OptionsObservateurCompaction['surDefaut']
  readonly #historiqueAuto: number[] = []
  readonly #evenements: EvenementCompactionObserve[] = []
  #dernier: DernierEvenement | null = null

  constructor(options: OptionsObservateurCompaction = {}) {
    this.#horloge = options.horloge ?? HORLOGE_REELLE
    this.#seuils = options.seuils ?? SEUILS_PATHOLOGIE_PAR_DEFAUT
    this.#surEvenement = options.surEvenement
    this.#surDefaut = options.surDefaut
  }

  /** Hook `PreCompact`/`PostCompact` — `PostCompactHookInput` porte `trigger`. */
  observerHook(trigger: TriggerCompaction, tokens?: { pre?: number; post?: number }): EvenementCompactionObserve {
    return this.#observer({
      trigger,
      origine: 'hook',
      preTokens: tokens?.pre,
      postTokens: tokens?.post,
    })
  }

  /** `SDKCompactBoundaryMessage` — `compact_metadata.trigger`, `pre_tokens`, `post_tokens`. */
  observerMessage(trigger: TriggerCompaction, tokens?: { pre?: number; post?: number }): EvenementCompactionObserve {
    return this.#observer({
      trigger,
      origine: 'message_flux',
      preTokens: tokens?.pre,
      postTokens: tokens?.post,
    })
  }

  /** Tous les événements observés, dans l'ordre. */
  evenements(): readonly EvenementCompactionObserve[] {
    return this.#evenements
  }

  /** Seulement ceux classés `defaut` — la vue qui doit rester rare (H-64, même philosophie). */
  evenementsDefaut(): readonly EvenementCompactionObserve[] {
    return this.#evenements.filter((e) => e.severite === 'defaut')
  }

  #observer(signal: SignalCompaction): EvenementCompactionObserve {
    const instant = this.#horloge.maintenant()
    if (this.#estFusionDuDernier(signal, instant)) {
      return this.#fusionner(signal)
    }
    return this.#nouvelEvenement(signal, instant)
  }

  #estFusionDuDernier(signal: SignalCompaction, instant: number): boolean {
    const dernier = this.#dernier
    if (dernier === null) return false
    if (dernier.evenement.trigger !== signal.trigger) return false
    // Même origine deux fois : ce n'est pas un doublon cross-canal, c'est une
    // deuxième compaction réelle rapportée par le même canal.
    if (dernier.origines.has(signal.origine)) return false
    return instant - dernier.evenement.instant <= this.#seuils.dedupMs
  }

  #fusionner(signal: SignalCompaction): EvenementCompactionObserve {
    const dernier = this.#dernier
    // Non-atteignable : #estFusionDuDernier garantit dernier non-nul avant l'appel.
    if (dernier === null) return this.#nouvelEvenement(signal, this.#horloge.maintenant())
    dernier.origines.add(signal.origine)
    const fusionne: EvenementCompactionObserve = {
      ...dernier.evenement,
      origines: [...dernier.origines],
    }
    this.#evenements[this.#evenements.length - 1] = fusionne
    dernier.evenement = fusionne
    journal.debug(
      { trigger: signal.trigger, origines: fusionne.origines },
      'signal_compaction_fusionne_meme_evenement',
    )
    return fusionne
  }

  #nouvelEvenement(signal: SignalCompaction, instant: number): EvenementCompactionObserve {
    const classement =
      signal.trigger === 'manual' ? this.#classerManuelle() : this.#classerAuto(instant)

    const evenement: EvenementCompactionObserve = {
      instant,
      trigger: signal.trigger,
      origines: [signal.origine],
      severite: classement.severite,
      motif: classement.motif,
      intervalleDepuisPrecedenteAutoMs: classement.intervalle,
      compteAutoDansFenetre: classement.compte,
    }
    this.#evenements.push(evenement)
    this.#dernier = { evenement, origines: new Set([signal.origine]) }

    if (classement.severite === 'defaut') {
      journal.warn({ ...evenement }, 'compaction_pathologique_detectee')
      this.#surDefaut?.(evenement)
    } else {
      journal.debug({ ...evenement }, 'compaction_observee')
    }
    this.#surEvenement?.(evenement)
    return evenement
  }

  #classerManuelle(): { severite: SeveriteCompaction; motif: string; intervalle: null; compte: 0 } {
    return {
      severite: 'normal',
      motif: "compaction manuelle — déclenchée par l'opérateur (H-62), jamais classée en défaut",
      intervalle: null,
      compte: 0,
    }
  }

  #classerAuto(instant: number): {
    severite: SeveriteCompaction
    motif: string
    intervalle: number | null
    compte: number
  } {
    const derniereAuto = this.#historiqueAuto.at(-1) ?? null
    const intervalle = derniereAuto === null ? null : instant - derniereAuto
    this.#historiqueAuto.push(instant)
    this.#purgerHistoriqueAuto(instant)
    const compte = this.#historiqueAuto.length

    const intervalleTropCourt = intervalle !== null && intervalle < this.#seuils.intervalleMinMs
    const repetitionExcessive = compte >= this.#seuils.compteMax

    if (!intervalleTropCourt && !repetitionExcessive) {
      return { severite: 'normal', motif: 'compaction auto isolée, dans les bornes attendues', intervalle, compte }
    }

    const motif = intervalleTropCourt
      ? `compaction auto ${Math.round((intervalle ?? 0) / 1000)}s après la précédente ` +
        `(seuil ${this.#seuils.intervalleMinMs / 60_000} min) — signe de fuite de contexte, pas de saturation normale`
      : `${compte} compactions auto en ${this.#seuils.fenetreMs / 60_000} min ` +
        `(seuil ${this.#seuils.compteMax}) — fréquence anormale, le contexte se recharge trop vite`
    return { severite: 'defaut', motif, intervalle, compte }
  }

  #purgerHistoriqueAuto(instant: number): void {
    const borne = instant - this.#seuils.fenetreMs
    while (this.#historiqueAuto.length > 0 && (this.#historiqueAuto[0] ?? Infinity) < borne) {
      this.#historiqueAuto.shift()
    }
  }
}
