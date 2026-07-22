/**
 * Responsabilité : échantillonner `getContextUsage()` pendant que la session
 * de l'orchestrateur maître vit, et notifier des seuils d'alerte — A.1.4,
 * point 2. Mesure, jamais estimation.
 *
 * `⚠` Fait mesuré le 2026-07-22, à ne jamais re-supposer : `getContextUsage()`
 * doit être appelée PENDANT que la session vit. Après le message `result`, le
 * transport est fermé et tout appel de contrôle échoue avec
 * `ProcessTransport is not ready for writing`. Ce module détecte cette erreur
 * précise et l'interprète comme une fin normale de session, pas comme une
 * panne — voir `#gererEchec`.
 *
 * `⚠` Fait mesuré le 2026-07-22 : `capabilities` (SDKSystemMessage) est revenu
 * VIDE en session réelle. On ne suppose donc jamais la présence de
 * `getContextUsage` — on la constate à chaque tick (`typeof === 'function'`)
 * et on s'arrête proprement si elle manque, sans jamais lever.
 *
 * `⚠` Le champ `percentage` de `SDKControlGetContextUsageResponse` n'a pas de
 * borne documentée (0..1 ou 0..100 ?). Plutôt que de deviner son échelle pour
 * une décision de seuil, ce module recalcule lui-même `totalTokens/maxTokens`
 * — un ratio dont l'échelle est certaine par construction.
 */
import {
  HORLOGE_REELLE,
  type AnnulerMinuterie,
  type Horloge,
} from './horloge.ts'
import { disciplineContexteLogger as journal } from './logger.ts'
import {
  SEUILS_PAR_DEFAUT,
  type EtatEchantillonnage,
  type MesureBrute,
  type MesureContexte,
  type NiveauContexte,
  type SeuilsContexte,
  type SourceContexte,
} from './contrats.ts'

const INTERVALLE_PAR_DEFAUT_MS = 60_000
const ECHECS_CONSECUTIFS_MAX = 3

/** Motif d'erreur exact mesuré en réel — transport fermé après `result`. */
export const MOTIF_TRANSPORT_FERME = 'ProcessTransport is not ready for writing'

export interface OptionsEchantillonneur {
  readonly horloge?: Horloge
  readonly intervalleMs?: number
  readonly seuils?: SeuilsContexte
  /** Appelé à chaque mesure réussie — alimente la jauge live (H-63). */
  readonly surEchantillon?: (mesure: MesureContexte) => void
  /** Appelé seulement au franchissement d'un seuil — évite le bruit de notification. */
  readonly surChangementNiveau?: (mesure: MesureContexte, precedent: NiveauContexte | null) => void
  readonly surArret?: (etat: EtatEchantillonnage, motif: string) => void
}

function niveauDepuisRatio(ratio: number, seuils: SeuilsContexte): NiveauContexte {
  if (ratio >= seuils.alerte) return 'alerte'
  if (ratio >= seuils.attention) return 'attention'
  return 'sain'
}

export class EchantillonneurContexte {
  readonly #source: SourceContexte
  readonly #horloge: Horloge
  readonly #intervalleMs: number
  readonly #seuils: SeuilsContexte
  readonly #surEchantillon: OptionsEchantillonneur['surEchantillon']
  readonly #surChangementNiveau: OptionsEchantillonneur['surChangementNiveau']
  readonly #surArret: OptionsEchantillonneur['surArret']
  #etat: EtatEchantillonnage = 'actif'
  #derniereMesure: MesureContexte | null = null
  #niveauPrecedent: NiveauContexte | null = null
  #echecsConsecutifs = 0
  #annulerProchainTick: AnnulerMinuterie | null = null

  constructor(source: SourceContexte, options: OptionsEchantillonneur = {}) {
    if (options.intervalleMs !== undefined && options.intervalleMs <= 0) {
      throw new RangeError('intervalleMs doit être strictement positif')
    }
    this.#source = source
    this.#horloge = options.horloge ?? HORLOGE_REELLE
    this.#intervalleMs = options.intervalleMs ?? INTERVALLE_PAR_DEFAUT_MS
    this.#seuils = options.seuils ?? SEUILS_PAR_DEFAUT
    this.#surEchantillon = options.surEchantillon
    this.#surChangementNiveau = options.surChangementNiveau
    this.#surArret = options.surArret
  }

  get etat(): EtatEchantillonnage {
    return this.#etat
  }

  get derniereMesure(): MesureContexte | null {
    return this.#derniereMesure
  }

  /** Démarre l'échantillonnage périodique. Idempotent si déjà arrêté ou déjà actif avec un tick en vol. */
  demarrer(): void {
    if (this.#etat !== 'actif' || this.#annulerProchainTick !== null) return
    this.#planifierProchain()
  }

  /**
   * Arrêt volontaire — à appeler dès que le harness sait la session terminée
   * (réception du `SDKResultMessage`), idéalement AVANT qu'un tick échoue.
   * Idempotent.
   */
  arreter(): void {
    if (this.#etat === 'actif') this.#etat = 'arrete_volontairement'
    this.#annulerProchainTick?.()
    this.#annulerProchainTick = null
  }

  #planifierProchain(): void {
    this.#annulerProchainTick = this.#horloge.planifier(this.#intervalleMs, () => {
      void this.#tick()
    })
  }

  async #tick(): Promise<void> {
    if (typeof this.#source.getContextUsage !== 'function') {
      this.#arreterDefinitivement(
        'arrete_indisponible',
        "getContextUsage absente de cette session (capacité non annoncée, ou binaire ancien) — comportement sûr : pas de mesure plutôt qu'une supposition",
      )
      return
    }
    try {
      const brute = await this.#source.getContextUsage()
      this.#echecsConsecutifs = 0
      this.#traiter(brute)
      this.#planifierProchain()
    } catch (erreur) {
      this.#gererEchec(erreur)
    }
  }

  #gererEchec(erreur: unknown): void {
    const message = erreur instanceof Error ? erreur.message : String(erreur)
    if (message.includes(MOTIF_TRANSPORT_FERME)) {
      this.#arreterDefinitivement(
        'arrete_session_terminee',
        'transport fermé après le message result — fin de session attendue, pas une panne',
      )
      return
    }
    this.#echecsConsecutifs += 1
    journal.warn(
      { erreur: message, echecsConsecutifs: this.#echecsConsecutifs },
      'echec_echantillonnage_contexte',
    )
    if (this.#echecsConsecutifs >= ECHECS_CONSECUTIFS_MAX) {
      this.#arreterDefinitivement(
        'arrete_echecs',
        `abandon après ${ECHECS_CONSECUTIFS_MAX} échecs consécutifs non identifiés comme fin de session`,
      )
      return
    }
    this.#planifierProchain()
  }

  #traiter(brute: MesureBrute): void {
    const ratio = brute.maxTokens > 0 ? brute.totalTokens / brute.maxTokens : 0
    const niveau = niveauDepuisRatio(ratio, this.#seuils)
    const mesure: MesureContexte = {
      instant: this.#horloge.maintenant(),
      totalTokens: brute.totalTokens,
      maxTokens: brute.maxTokens,
      ratio,
      niveau,
      model: brute.model,
    }
    this.#derniereMesure = mesure
    this.#surEchantillon?.(mesure)
    if (niveau !== this.#niveauPrecedent) {
      journal.info({ niveau, ratio, precedent: this.#niveauPrecedent }, 'changement_niveau_contexte')
      this.#surChangementNiveau?.(mesure, this.#niveauPrecedent)
      this.#niveauPrecedent = niveau
    }
  }

  #arreterDefinitivement(etat: EtatEchantillonnage, motif: string): void {
    this.#etat = etat
    this.arreter()
    journal.info({ etat, motif }, 'echantillonnage_contexte_arrete')
    this.#surArret?.(etat, motif)
  }
}
